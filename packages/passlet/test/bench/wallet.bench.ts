// Run with `pnpm -F passlet bench`. Timings on shared machines are noisy, so
// compare runs locally with `--outputJson` / `--compare`, never in CI.
import { randomBytes } from "node:crypto";
import { bench, describe } from "vitest";
import { type PassContent, Wallet } from "../../src";
import { appleCredentials } from "../support/apple";
import { FIXTURES, walletTemplate } from "../support/fixtures";
import {
	existingClasses,
	googleCredentials,
	stubGoogleFetch,
} from "../support/google";

const { loyalty } = FIXTURES;

// Incompressible stand-ins sized like real PNG exports at @1x/@2x/@3x
// (icon 29 pt, logo 160×50 pt, strip 375×123 pt): about 230 KB per pass.
function imageSet(base: number, retina: number, superRetina: number) {
	return {
		base: randomBytes(base),
		retina: randomBytes(retina),
		superRetina: randomBytes(superRetina),
	};
}

const apple = appleCredentials();
const google = googleCredentials();

const appleWallet = new Wallet({ apple });
const card = walletTemplate(appleWallet, {
	...loyalty.pass,
	apple: {
		...loyalty.pass.apple,
		icon: imageSet(2000, 5000, 9000),
		logo: imageSet(6000, 15_000, 30_000),
		strip: imageSet(20_000, 50_000, 95_000),
	},
});

const content = (serialNumber: string): PassContent => ({
	...loyalty.create,
	serialNumber,
});
const tenPasses = Array.from({ length: 10 }, (_, i) => ({
	template: card,
	content: content(`bench-${i}`),
}));

describe("Apple", () => {
	bench("create() with ~230 KB of images", async () => {
		await card.create(content("bench"));
	});

	bench("createBundle() of 10 passes", async () => {
		await appleWallet.createBundle(tenPasses);
	});
});

describe("Google", () => {
	const googleWallet = new Wallet({ google });
	const googleCard = walletTemplate(googleWallet, loyalty.pass);

	bench(
		"create() against a stubbed Wallet API",
		async () => {
			await googleCard.create(content("bench"));
		},
		{
			setup: () => {
				stubGoogleFetch(existingClasses);
			},
		}
	);
});

describe("Wallet", () => {
	bench("new Wallet() with Apple and Google credentials", () => {
		new Wallet({ apple, google });
	});
});
