import type { GoogleCredentials } from "../config";
import { WalletError, type WalletValidationIssue } from "../errors";
import type { PassItem, Provider } from "../providers";
import type { ParsedContent } from "../schema/content";
import type { ParsedGooglePassMessage } from "../schema/google";
import type { ParsedTemplate } from "../schema/template";
import { buildClassBody } from "./class-body";
import { GoogleClient } from "./client";
import { signJwt } from "./jwt";
import { buildObjectBody } from "./object-body";
import { type GoogleVertical, vertical } from "./utils";

// Class and object IDs are `issuerId.identifier`, where the identifier
// "should only include alphanumeric characters, '.', '_', or '-'". It is the
// template ID for a class and the serial number for an object.
// https://developers.google.com/wallet/reference/rest/v1/loyaltyclass/update
// https://developers.google.com/wallet/reference/rest/v1/genericobject
const GOOGLE_ID_RE = /^[A-Za-z0-9._-]+$/;

function checkIdentifier(
	code: "PASS_CONFIG_INVALID" | "CREATE_CONFIG_INVALID",
	key: "id" | "serialNumber",
	value: string
): void {
	if (GOOGLE_ID_RE.test(value)) {
		return;
	}
	const issue: WalletValidationIssue = {
		path: [key],
		message: `Google Wallet allows only letters, digits, '.', '_' and '-' in ${key === "id" ? "template IDs" : "serial numbers"}`,
	};
	throw new WalletError(code, `${key}: ${issue.message}`, { issues: [issue] });
}

/** One object to write: its ids, its class's template, and its body. */
interface ObjectWrite {
	body: Record<string, unknown>;
	classId: string;
	objectId: string;
	template: ParsedTemplate;
	vertical: GoogleVertical;
}

/**
 * Google Wallet: classes and objects written through the Wallet REST API, and
 * save links signed as JWTs that point at those objects.
 */
export class GoogleProvider implements Provider<string, "updated" | "created"> {
	readonly #client: GoogleClient;
	readonly #issuerId: string;
	readonly #origins: readonly string[] | undefined;
	/**
	 * Classes known to exist, by class ID. The Wallet API cannot delete a
	 * class, so once ensured or published it stays for the provider's life.
	 * A pending entry is shared by concurrent writes and dropped on failure.
	 * https://developers.google.com/wallet/reference/rest/v1/loyaltyclass
	 */
	readonly #classes = new Map<string, Promise<void>>();

	/**
	 * @throws {WalletError} `GOOGLE_INVALID_PRIVATE_KEY` if the service account
	 * key is not an RSA PEM private key.
	 */
	constructor(credentials: GoogleCredentials) {
		this.#client = new GoogleClient(credentials);
		this.#issuerId = credentials.issuerId;
		this.#origins = credentials.origins;
	}

	/**
	 * Every Google requirement a template alone decides, so configuration
	 * errors surface at construction rather than on the first request.
	 * Requirements on recipient content are checked when a pass is written.
	 */
	checkTemplate(template: ParsedTemplate): void {
		checkIdentifier("PASS_CONFIG_INVALID", "id", template.id);
		// Google loyalty classes require a programLogo URL — the API returns 400 without it
		if (template.type === "loyalty" && !template.google?.logo) {
			throw new WalletError(
				"GOOGLE_MISSING_LOGO",
				"Google Wallet loyalty passes require a logo URL (programLogo) in google.logo"
			);
		}
		if (template.type !== "boardingPass") {
			return;
		}
		if (template.google?.transit) {
			// transitClass requires logo, transitType, issuerName, and reviewStatus.
			// transitType is always derived, the other two are always emitted — only
			// the logo can be missing. The IATA flightClass fields do not apply.
			if (!template.google.logo) {
				throw new WalletError(
					"GOOGLE_MISSING_LOGO",
					"Google Wallet transit passes require a logo URL in google.logo"
				);
			}
			return;
		}
		const { carrier, flightNumber, origin, destination, departure } = template;
		// Google flightClass requires all of these — localScheduledDepartureDateTime
		// (departure) is a required scalar the API rejects the class without.
		if (!(carrier && flightNumber && origin && destination && departure)) {
			throw new WalletError(
				"GOOGLE_FLIGHT_MISSING_CLASS_FIELDS",
				"Flight passes require carrier, flightNumber, origin, destination, and departure"
			);
		}
	}

	checkContent(content: ParsedContent): void {
		checkIdentifier(
			"CREATE_CONFIG_INVALID",
			"serialNumber",
			content.serialNumber
		);
	}

	/** Write the item's object, then sign a save link that adds it. */
	async issue(item: PassItem): Promise<string> {
		return await this.issueBundle([item]);
	}

	/**
	 * Write every item's object, each right after its class is ensured, then
	 * sign one save link that adds them all.
	 */
	async issueBundle(items: readonly PassItem[]): Promise<string> {
		// Google's documented flow creates objects in advance through the API and
		// issues them by ID; a JWT only links the holder to that object. Writing it
		// here keeps the save link showing current content and lets update() reach
		// the pass before anyone saves it. Referencing pre-created objects also
		// keeps the link short; Google suggests it past 1,800 characters.
		// https://developers.google.com/wallet/retail/loyalty-cards/overview/add-to-google-wallet-flow
		// https://developers.google.com/wallet/tickets/events/use-cases/save-multiple-passes
		const writes = items.map((item) => this.#prepare(item));
		// Every write settles before the first failure is thrown, so nothing is
		// still landing on Google once createBundle() has rejected.
		const settled = await Promise.allSettled(
			writes.map(async (write) => {
				await this.#ensureClass(write);
				await this.#client.insertObject(
					write.vertical,
					write.objectId,
					write.body
				);
			})
		);
		const failure = settled.find((result) => result.status === "rejected");
		if (failure) {
			throw failure.reason;
		}

		// One array of `{ id, classId }` refs per object type.
		// https://developers.google.com/wallet/reference/rest/v1/Jwt
		const objects: Partial<
			Record<`${GoogleVertical}Objects`, { id: string; classId: string }[]>
		> = {};
		for (const { vertical: v, objectId, classId } of writes) {
			const refs = objects[`${v}Objects`] ?? [];
			refs.push({ id: objectId, classId });
			objects[`${v}Objects`] = refs;
		}
		return signJwt(
			{
				iss: this.#client.clientEmail,
				aud: "google",
				typ: "savetowallet",
				iat: Math.floor(Date.now() / 1000),
				// Approved domains for the embeddable "Add to Google Wallet" button.
				// The web button does not render unless origins is present.
				...(this.#origins?.length && { origins: this.#origins }),
				payload: objects,
			},
			this.#client.privateKey
		);
	}

	/**
	 * Write a pass's object. An existing object proves its class exists, so
	 * the class is ensured only when Google has no object yet; that way an
	 * update works before anything was issued from the template.
	 */
	async update(
		item: PassItem,
		{ notify = false }: { notify?: boolean }
	): Promise<"updated" | "created"> {
		const write = this.#prepare(item);
		// genericObject has no notifyPreference; Google notifies generic holders
		// only through AddMessage (PassTemplate.sendMessage).
		// https://developers.google.com/wallet/reference/rest/v1/genericobject
		const notifies = notify && write.vertical !== "generic";
		if (
			await this.#client.updateObject(
				write.vertical,
				write.objectId,
				write.body,
				notifies
			)
		) {
			return "updated";
		}
		// A new object has no holder to notify, so the flag is not sent.
		await this.#ensureClass(write);
		await this.#client.insertObject(write.vertical, write.objectId, write.body);
		return "created";
	}

	/** Write the template's class as it stands, creating it if missing. */
	async publish(template: ParsedTemplate): Promise<void> {
		const classId = this.#id(template.id);
		await this.#client.publishClass(
			vertical(template),
			classId,
			buildClassBody(template)
		);
		this.#classes.set(classId, Promise.resolve());
	}

	/** Move a pass's object to the `EXPIRED` state. */
	async expire(template: ParsedTemplate, serialNumber: string): Promise<void> {
		checkIdentifier("CREATE_CONFIG_INVALID", "serialNumber", serialNumber);
		await this.#client.patchObject(vertical(template), this.#id(serialNumber), {
			state: "EXPIRED",
		});
	}

	/** Add a message to a pass's object; TEXT_AND_NOTIFY also pushes it. */
	async sendMessage(
		template: ParsedTemplate,
		serialNumber: string,
		message: ParsedGooglePassMessage
	): Promise<void> {
		checkIdentifier("CREATE_CONFIG_INVALID", "serialNumber", serialNumber);
		await this.#client.addObjectMessage(
			vertical(template),
			this.#id(serialNumber),
			message
		);
	}

	/** A Wallet resource ID: the issuer ID, then the template ID or serial. */
	#id(suffix: string): string {
		return `${this.#issuerId}.${suffix}`;
	}

	// Built before any request, so invalid recipient data never half-writes.
	#prepare({ template, content }: PassItem): ObjectWrite {
		const classId = this.#id(template.id);
		const objectId = this.#id(content.serialNumber);
		return {
			template,
			classId,
			objectId,
			vertical: vertical(template),
			body: buildObjectBody(template, content, classId, objectId),
		};
	}

	/** Create the write's class once per provider, however many objects share it. */
	#ensureClass({ template, vertical: v, classId }: ObjectWrite): Promise<void> {
		const known = this.#classes.get(classId);
		if (known) {
			return known;
		}
		const ensured = this.#client.ensureClass(v, classId, () =>
			buildClassBody(template)
		);
		this.#classes.set(classId, ensured);
		ensured.catch(() => {
			if (this.#classes.get(classId) === ensured) {
				this.#classes.delete(classId);
			}
		});
		return ensured;
	}
}
