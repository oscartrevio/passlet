import type { KeyObject } from "node:crypto";
import { WalletError, type WalletValidationIssue } from "../errors";
import type { PassItem, Provider } from "../providers";
import type { ParsedContent } from "../schema/content";
import type { GoogleCredentials } from "../schema/settings";
import type { ParsedTemplate, TemplateType } from "../schema/template";
import { buildClassBody } from "./class-body";
import type { GoogleObjectType } from "./client";
import {
	ensureClass,
	importGoogleKey,
	insertObject,
	patchObject,
	publishClass,
	upsertObject,
} from "./client";
import { signJwt } from "./jwt";
import { buildObjectBody } from "./object-body";
import { transitOptions } from "./utils";

const CLASS_TYPE = {
	loyalty: "loyaltyClass",
	eventTicket: "eventTicketClass",
	boardingPass: "flightClass",
	coupon: "offerClass",
	giftCard: "giftCardClass",
	generic: "genericClass",
} as const satisfies Record<TemplateType, string>;

const OBJECT_TYPE = {
	loyalty: "loyaltyObject",
	eventTicket: "eventTicketObject",
	boardingPass: "flightObject",
	coupon: "offerObject",
	giftCard: "giftCardObject",
	generic: "genericObject",
} as const satisfies Record<TemplateType, string>;

// Google object IDs are `issuerId.serialNumber`, and the identifier "can only
// include alphanumeric characters, ., _, or -".
// https://developers.google.com/wallet/reference/rest/v1/genericobject
const SERIAL_RE = /^[A-Za-z0-9._-]+$/;

function objectType(template: ParsedTemplate): GoogleObjectType {
	return transitOptions(template)
		? "transitObject"
		: OBJECT_TYPE[template.type];
}

export function validateGoogleRequirements(template: ParsedTemplate): void {
	// Google loyalty classes require a programLogo URL — the API returns 400 without it
	if (template.type === "loyalty" && !template.google?.logo) {
		throw new WalletError(
			"GOOGLE_MISSING_LOGO",
			"Google Wallet loyalty passes require a logo URL (programLogo) in google.logo"
		);
	}
	if (template.type === "boardingPass") {
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
}

/** One object to write: its ids, its class's template, and its body. */
interface ObjectWrite {
	body: Record<string, unknown>;
	classId: string;
	objectId: string;
	objectType: GoogleObjectType;
	template: ParsedTemplate;
}

/**
 * Google Wallet: classes and objects written through the Wallet REST API, and
 * save links signed as JWTs that point at those objects.
 */
export class GoogleProvider implements Provider<string, "updated" | "created"> {
	private readonly credentials: GoogleCredentials;

	constructor(credentials: GoogleCredentials) {
		this.credentials = credentials;
	}

	/**
	 * Template requirements that need no flight data, so configuration errors
	 * surface before the first request. The rest are checked at issue time.
	 */
	checkTemplate(template: ParsedTemplate): void {
		// Google loyalty classes require a programLogo URL — the API returns 400 without it.
		if (template.type === "loyalty" && !template.google?.logo) {
			throw new WalletError("GOOGLE_MISSING_LOGO");
		}
		// transitClass requires a logo. The air flightClass vertical does not, so
		// only the transit opt-in is checked here.
		if (
			template.type === "boardingPass" &&
			template.google?.transit &&
			!template.google.logo
		) {
			throw new WalletError("GOOGLE_MISSING_LOGO");
		}
	}

	checkContent(content: ParsedContent): void {
		if (SERIAL_RE.test(content.serialNumber)) {
			return;
		}
		const issue: WalletValidationIssue = {
			path: ["serialNumber"],
			message:
				"Google Wallet allows only letters, digits, '.', '_' and '-' in serial numbers",
		};
		throw new WalletError(
			"CREATE_CONFIG_INVALID",
			`serialNumber: ${issue.message}`,
			{ issues: [issue] }
		);
	}

	/** Write the item's object, then sign a save link that adds it. */
	async issue(item: PassItem): Promise<string> {
		return await this.issueBundle([item]);
	}

	/**
	 * Write every item's object, checking each distinct class once, then sign
	 * one save link that adds them all.
	 */
	async issueBundle(items: readonly PassItem[]): Promise<string> {
		// Google's documented flow creates objects in advance through the API and
		// issues them by ID; a JWT only links the holder to that object. Writing it
		// here keeps the save link showing current content and lets update() reach
		// the pass before anyone saves it. Referencing pre-created objects also
		// keeps the link short; Google suggests it past 1,800 characters.
		// https://developers.google.com/wallet/retail/loyalty-cards/overview/add-to-google-wallet-flow
		// https://developers.google.com/wallet/tickets/events/use-cases/save-multiple-passes
		const privateKey = importGoogleKey(this.credentials);
		const writes = items.map((item) => this.prepare(item));
		await this.ensureClasses(writes, privateKey);
		for (const { objectType: type, objectId, body } of writes) {
			await insertObject(type, objectId, body, this.credentials, privateKey);
		}

		// One array of `{ id, classId }` refs per object type.
		// https://developers.google.com/wallet/reference/rest/v1/Jwt
		const objects: Record<string, { id: string; classId: string }[]> = {};
		for (const { objectType: type, objectId, classId } of writes) {
			const key = `${type}s`;
			objects[key] ??= [];
			objects[key].push({ id: objectId, classId });
		}
		const { clientEmail, origins } = this.credentials;
		const payload = {
			iss: clientEmail,
			aud: "google",
			typ: "savetowallet",
			iat: Math.floor(Date.now() / 1000),
			// Approved domains for the embeddable "Add to Google Wallet" button.
			// The web button does not render unless origins is present.
			...(origins?.length && { origins }),
			payload: objects,
		};

		try {
			return signJwt(payload, privateKey);
		} catch (cause) {
			throw new WalletError("GOOGLE_SIGNING_FAILED", undefined, {
				cause: cause instanceof Error ? cause : undefined,
			});
		}
	}

	/**
	 * Write a pass's object, creating its class first if Google has none, so an
	 * update never fails just because nothing was issued from the template yet.
	 */
	async update(
		item: PassItem,
		options: { notify?: boolean }
	): Promise<"updated" | "created"> {
		const privateKey = importGoogleKey(this.credentials);
		const write = this.prepare(item);
		await this.ensureClasses([write], privateKey);
		return await upsertObject(
			write.objectType,
			write.objectId,
			write.body,
			this.credentials,
			privateKey,
			options
		);
	}

	// Built before any request, so invalid recipient data never half-writes.
	private prepare({ template, content }: PassItem): ObjectWrite {
		validateGoogleRequirements(template);
		const classId = `${this.credentials.issuerId}.${template.id}`;
		const objectId = `${this.credentials.issuerId}.${content.serialNumber}`;
		return {
			template,
			classId,
			objectId,
			objectType: objectType(template),
			body: buildObjectBody(template, content, classId, objectId),
		};
	}

	/** Create each missing class once, however many objects share it. */
	private async ensureClasses(
		writes: readonly ObjectWrite[],
		privateKey: KeyObject
	): Promise<void> {
		const classes = new Map<string, ParsedTemplate>();
		for (const { classId, template } of writes) {
			if (!classes.has(classId)) {
				classes.set(classId, template);
			}
		}
		for (const [classId, template] of classes) {
			await ensureClass(
				transitOptions(template) ? "transitClass" : CLASS_TYPE[template.type],
				classId,
				buildClassBody(template),
				this.credentials,
				privateKey
			);
		}
	}

	/** Overwrite the template's class with its current content. */
	async publish(template: ParsedTemplate): Promise<void> {
		validateGoogleRequirements(template);
		const privateKey = importGoogleKey(this.credentials);
		await publishClass(
			transitOptions(template) ? "transitClass" : CLASS_TYPE[template.type],
			`${this.credentials.issuerId}.${template.id}`,
			buildClassBody(template),
			this.credentials,
			privateKey
		);
	}

	/** Move a pass's object to the `EXPIRED` state. */
	async expire(template: ParsedTemplate, serialNumber: string): Promise<void> {
		const privateKey = importGoogleKey(this.credentials);
		await patchObject(
			objectType(template),
			`${this.credentials.issuerId}.${serialNumber}`,
			{ state: "EXPIRED" },
			this.credentials,
			privateKey
		);
	}
}
