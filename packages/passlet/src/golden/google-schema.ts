/**
 * Google Wallet REST schema — the allowed top-level keys of every class and
 * object resource passlet emits.
 *
 * WHY THIS FILE EXISTS
 * This is a transcription of the vendor contract, not of passlet's behaviour.
 * Google's Wallet Objects API rejects (or silently drops) request bodies that
 * carry keys the target resource does not define, and the failure only shows up
 * against the live API — long after a refactor moved a field onto the wrong
 * resource. The whitelists below let the golden tests catch that structurally.
 *
 * PROVENANCE
 * Generated from Google's machine-readable discovery document:
 *   https://walletobjects.googleapis.com/$discovery/rest?version=v1
 * which is the same source that backs the human-readable reference pages at
 *   https://developers.google.com/wallet/reference/rest/v1/<resource>
 *
 * HOW TO UPDATE
 * ONLY by re-reading the discovery document or the reference page for the
 * resource, and ONLY with the doc reference recorded in the commit message.
 * Never widen a whitelist to make a test pass.
 */

export type GoogleResource =
	| "loyaltyClass"
	| "loyaltyObject"
	| "offerClass"
	| "offerObject"
	| "eventTicketClass"
	| "eventTicketObject"
	| "flightClass"
	| "flightObject"
	| "giftCardClass"
	| "giftCardObject"
	| "genericClass"
	| "genericObject"
	| "transitClass"
	| "transitObject";

const RESOURCE_KEYS: Record<GoogleResource, readonly string[]> = {
	loyaltyClass: [
		"accountIdLabel",
		"accountNameLabel",
		"allowMultipleUsersPerObject",
		"appLinkData",
		"callbackOptions",
		"classTemplateInfo",
		"countryCode",
		"discoverableProgram",
		"enableSmartTap",
		"heroImage",
		"hexBackgroundColor",
		"homepageUri",
		"id",
		"imageModulesData",
		"infoModuleData",
		"issuerName",
		"kind",
		"linksModuleData",
		"localizedAccountIdLabel",
		"localizedAccountNameLabel",
		"localizedIssuerName",
		"localizedProgramName",
		"localizedRewardsTier",
		"localizedRewardsTierLabel",
		"localizedSecondaryRewardsTier",
		"localizedSecondaryRewardsTierLabel",
		"locations",
		"merchantLocations",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"notifyPreference",
		"programLogo",
		"programName",
		"redemptionIssuers",
		"review",
		"reviewStatus",
		"rewardsTier",
		"rewardsTierLabel",
		"secondaryRewardsTier",
		"secondaryRewardsTierLabel",
		"securityAnimation",
		"textModulesData",
		"valueAddedModuleData",
		"version",
		"viewUnlockRequirement",
		"wideProgramLogo",
		"wordMark",
	],
	loyaltyObject: [
		"accountId",
		"accountName",
		"appLinkData",
		"barcode",
		"classId",
		"classReference",
		"disableExpirationNotification",
		"groupingInfo",
		"hasLinkedDevice",
		"hasUsers",
		"heroImage",
		"id",
		"imageModulesData",
		"infoModuleData",
		"kind",
		"linkedObjectIds",
		"linkedOfferIds",
		"linksModuleData",
		"locations",
		"loyaltyPoints",
		"merchantLocations",
		"messages",
		"notifyPreference",
		"passConstraints",
		"rotatingBarcode",
		"saveRestrictions",
		"secondaryLoyaltyPoints",
		"smartTapRedemptionValue",
		"state",
		"textModulesData",
		"validTimeInterval",
		"valueAddedModuleData",
		"version",
	],
	offerClass: [
		"allowMultipleUsersPerObject",
		"appLinkData",
		"callbackOptions",
		"classTemplateInfo",
		"countryCode",
		"details",
		"enableSmartTap",
		"finePrint",
		"helpUri",
		"heroImage",
		"hexBackgroundColor",
		"homepageUri",
		"id",
		"imageModulesData",
		"infoModuleData",
		"issuerName",
		"kind",
		"linksModuleData",
		"localizedDetails",
		"localizedFinePrint",
		"localizedIssuerName",
		"localizedProvider",
		"localizedShortTitle",
		"localizedTitle",
		"locations",
		"merchantLocations",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"notifyPreference",
		"provider",
		"redemptionChannel",
		"redemptionIssuers",
		"review",
		"reviewStatus",
		"securityAnimation",
		"shortTitle",
		"textModulesData",
		"title",
		"titleImage",
		"valueAddedModuleData",
		"version",
		"viewUnlockRequirement",
		"wideTitleImage",
		"wordMark",
	],
	offerObject: [
		"appLinkData",
		"barcode",
		"classId",
		"classReference",
		"disableExpirationNotification",
		"groupingInfo",
		"hasLinkedDevice",
		"hasUsers",
		"heroImage",
		"id",
		"imageModulesData",
		"infoModuleData",
		"kind",
		"linkedObjectIds",
		"linksModuleData",
		"locations",
		"merchantLocations",
		"messages",
		"notifyPreference",
		"passConstraints",
		"rotatingBarcode",
		"saveRestrictions",
		"smartTapRedemptionValue",
		"state",
		"textModulesData",
		"validTimeInterval",
		"valueAddedModuleData",
		"version",
	],
	eventTicketClass: [
		"allowMultipleUsersPerObject",
		"appLinkData",
		"callbackOptions",
		"classTemplateInfo",
		"confirmationCodeLabel",
		"countryCode",
		"customConfirmationCodeLabel",
		"customGateLabel",
		"customRowLabel",
		"customSeatLabel",
		"customSectionLabel",
		"dateTime",
		"enableSmartTap",
		"eventId",
		"eventName",
		"finePrint",
		"gateLabel",
		"heroImage",
		"hexBackgroundColor",
		"homepageUri",
		"id",
		"imageModulesData",
		"infoModuleData",
		"issuerName",
		"kind",
		"linksModuleData",
		"localizedIssuerName",
		"locations",
		"logo",
		"merchantLocations",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"notifyPreference",
		"redemptionIssuers",
		"review",
		"reviewStatus",
		"rowLabel",
		"seatLabel",
		"sectionLabel",
		"securityAnimation",
		"textModulesData",
		"valueAddedModuleData",
		"venue",
		"version",
		"viewUnlockRequirement",
		"wideLogo",
		"wordMark",
	],
	eventTicketObject: [
		"appLinkData",
		"barcode",
		"classId",
		"classReference",
		"disableExpirationNotification",
		"faceValue",
		"groupingInfo",
		"hasLinkedDevice",
		"hasUsers",
		"heroImage",
		"hexBackgroundColor",
		"id",
		"imageModulesData",
		"infoModuleData",
		"kind",
		"linkedObjectIds",
		"linkedOfferIds",
		"linksModuleData",
		"locations",
		"merchantLocations",
		"messages",
		"notifyPreference",
		"passConstraints",
		"reservationInfo",
		"rotatingBarcode",
		"saveRestrictions",
		"seatInfo",
		"smartTapRedemptionValue",
		"state",
		"textModulesData",
		"ticketHolderName",
		"ticketNumber",
		"ticketType",
		"validTimeInterval",
		"valueAddedModuleData",
		"version",
	],
	flightClass: [
		"allowMultipleUsersPerObject",
		"appLinkData",
		"boardingAndSeatingPolicy",
		"callbackOptions",
		"classTemplateInfo",
		"countryCode",
		"destination",
		"enableSmartTap",
		"flightHeader",
		"flightStatus",
		"heroImage",
		"hexBackgroundColor",
		"homepageUri",
		"id",
		"imageModulesData",
		"infoModuleData",
		"issuerName",
		"kind",
		"languageOverride",
		"linksModuleData",
		"localBoardingDateTime",
		"localEstimatedOrActualArrivalDateTime",
		"localEstimatedOrActualDepartureDateTime",
		"localGateClosingDateTime",
		"localScheduledArrivalDateTime",
		"localScheduledDepartureDateTime",
		"localizedIssuerName",
		"locations",
		"merchantLocations",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"notifyPreference",
		"origin",
		"redemptionIssuers",
		"review",
		"reviewStatus",
		"securityAnimation",
		"textModulesData",
		"valueAddedModuleData",
		"version",
		"viewUnlockRequirement",
		"wordMark",
	],
	flightObject: [
		"appLinkData",
		"barcode",
		"boardingAndSeatingInfo",
		"classId",
		"classReference",
		"disableExpirationNotification",
		"groupingInfo",
		"hasLinkedDevice",
		"hasUsers",
		"heroImage",
		"hexBackgroundColor",
		"id",
		"imageModulesData",
		"infoModuleData",
		"kind",
		"linkedObjectIds",
		"linksModuleData",
		"locations",
		"merchantLocations",
		"messages",
		"notifyPreference",
		"passConstraints",
		"passengerName",
		"reservationInfo",
		"rotatingBarcode",
		"saveRestrictions",
		"securityProgramLogo",
		"smartTapRedemptionValue",
		"state",
		"textModulesData",
		"validTimeInterval",
		"valueAddedModuleData",
		"version",
	],
	giftCardClass: [
		"allowBarcodeRedemption",
		"allowMultipleUsersPerObject",
		"appLinkData",
		"callbackOptions",
		"cardNumberLabel",
		"classTemplateInfo",
		"countryCode",
		"enableSmartTap",
		"eventNumberLabel",
		"heroImage",
		"hexBackgroundColor",
		"homepageUri",
		"id",
		"imageModulesData",
		"infoModuleData",
		"issuerName",
		"kind",
		"linksModuleData",
		"localizedCardNumberLabel",
		"localizedEventNumberLabel",
		"localizedIssuerName",
		"localizedMerchantName",
		"localizedPinLabel",
		"locations",
		"merchantLocations",
		"merchantName",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"notifyPreference",
		"pinLabel",
		"programLogo",
		"redemptionIssuers",
		"review",
		"reviewStatus",
		"securityAnimation",
		"textModulesData",
		"valueAddedModuleData",
		"version",
		"viewUnlockRequirement",
		"wideProgramLogo",
		"wordMark",
	],
	giftCardObject: [
		"appLinkData",
		"balance",
		"balanceUpdateTime",
		"barcode",
		"cardNumber",
		"classId",
		"classReference",
		"disableExpirationNotification",
		"eventNumber",
		"groupingInfo",
		"hasLinkedDevice",
		"hasUsers",
		"heroImage",
		"id",
		"imageModulesData",
		"infoModuleData",
		"kind",
		"linkedObjectIds",
		"linksModuleData",
		"locations",
		"merchantLocations",
		"messages",
		"notifyPreference",
		"passConstraints",
		"pin",
		"rotatingBarcode",
		"saveRestrictions",
		"smartTapRedemptionValue",
		"state",
		"textModulesData",
		"validTimeInterval",
		"valueAddedModuleData",
		"version",
	],
	genericClass: [
		"appLinkData",
		"callbackOptions",
		"classTemplateInfo",
		"enableSmartTap",
		"id",
		"imageModulesData",
		"linksModuleData",
		"merchantLocations",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"redemptionIssuers",
		"securityAnimation",
		"textModulesData",
		"valueAddedModuleData",
		"viewUnlockRequirement",
	],
	genericObject: [
		"appLinkData",
		"barcode",
		"cardTitle",
		"classId",
		"genericType",
		"groupingInfo",
		"hasUsers",
		"header",
		"heroImage",
		"hexBackgroundColor",
		"id",
		"imageModulesData",
		"linkedObjectIds",
		"linksModuleData",
		"logo",
		"merchantLocations",
		"messages",
		"notifications",
		"passConstraints",
		"rotatingBarcode",
		"saveRestrictions",
		"smartTapRedemptionValue",
		"state",
		"subheader",
		"textModulesData",
		"validTimeInterval",
		"valueAddedModuleData",
		"wideLogo",
	],
	transitClass: [
		"activationOptions",
		"allowMultipleUsersPerObject",
		"appLinkData",
		"callbackOptions",
		"classTemplateInfo",
		"countryCode",
		"customCarriageLabel",
		"customCoachLabel",
		"customConcessionCategoryLabel",
		"customConfirmationCodeLabel",
		"customDiscountMessageLabel",
		"customFareClassLabel",
		"customFareNameLabel",
		"customOtherRestrictionsLabel",
		"customPlatformLabel",
		"customPurchaseFaceValueLabel",
		"customPurchasePriceLabel",
		"customPurchaseReceiptNumberLabel",
		"customRouteRestrictionsDetailsLabel",
		"customRouteRestrictionsLabel",
		"customSeatLabel",
		"customTicketNumberLabel",
		"customTimeRestrictionsLabel",
		"customTransitTerminusNameLabel",
		"customZoneLabel",
		"enableSingleLegItinerary",
		"enableSmartTap",
		"heroImage",
		"hexBackgroundColor",
		"homepageUri",
		"id",
		"imageModulesData",
		"infoModuleData",
		"issuerName",
		"languageOverride",
		"linksModuleData",
		"localizedIssuerName",
		"locations",
		"logo",
		"merchantLocations",
		"messages",
		"multipleDevicesAndHoldersAllowedStatus",
		"notifyPreference",
		"redemptionIssuers",
		"review",
		"reviewStatus",
		"securityAnimation",
		"textModulesData",
		"transitOperatorName",
		"transitType",
		"valueAddedModuleData",
		"version",
		"viewUnlockRequirement",
		"watermark",
		"wideLogo",
		"wordMark",
	],
	transitObject: [
		"activationStatus",
		"appLinkData",
		"barcode",
		"classId",
		"classReference",
		"concessionCategory",
		"customConcessionCategory",
		"customTicketStatus",
		"deviceContext",
		"disableExpirationNotification",
		"groupingInfo",
		"hasLinkedDevice",
		"hasUsers",
		"heroImage",
		"hexBackgroundColor",
		"id",
		"imageModulesData",
		"infoModuleData",
		"linkedObjectIds",
		"linksModuleData",
		"locations",
		"merchantLocations",
		"messages",
		"notifyPreference",
		"passConstraints",
		"passengerNames",
		"passengerType",
		"purchaseDetails",
		"rotatingBarcode",
		"saveRestrictions",
		"smartTapRedemptionValue",
		"state",
		"textModulesData",
		"ticketLeg",
		"ticketLegs",
		"ticketNumber",
		"ticketRestrictions",
		"ticketStatus",
		"tripId",
		"tripType",
		"validTimeInterval",
		"valueAddedModuleData",
		"version",
	],
};

/** Human-readable reference page for each resource, quoted in failure messages. */
const DOC_BASE = "https://developers.google.com/wallet/reference/rest/v1";

function docUrl(resource: GoogleResource): string {
	return `${DOC_BASE}/${resource.toLowerCase()}`;
}

/** Top-level keys the resource actually defines, per Google's schema. */
export function allowedKeys(resource: GoogleResource): readonly string[] {
	return RESOURCE_KEYS[resource];
}

/**
 * Top-level keys present in `body` that the resource does not define.
 *
 * Undefined-valued keys are ignored: passlet builds bodies with `key: undefined`
 * placeholders that `JSON.stringify` drops before the request is sent, so they
 * never reach Google.
 */
export function unknownTopLevelKeys(
	resource: GoogleResource,
	body: Record<string, unknown>
): string[] {
	const allowed = new Set(RESOURCE_KEYS[resource]);
	return Object.keys(body)
		.filter((key) => body[key] !== undefined)
		.filter((key) => !allowed.has(key))
		.sort();
}

/**
 * Asserts that `body` only carries top-level keys the Google resource defines.
 *
 * `knownDeviations` records keys passlet emits today that the schema does NOT
 * define. Listing one is an explicit, reviewable acknowledgement of a bug — not
 * a licence to add more. The assertion is exact in both directions: a new
 * off-schema key fails, and so does a deviation that has since been fixed, so
 * the list can never silently rot.
 */
export function assertGoogleSchema(
	resource: GoogleResource,
	body: Record<string, unknown>,
	knownDeviations: readonly string[] = []
): void {
	const unknown = unknownTopLevelKeys(resource, body);
	const unexpected = unknown.filter((key) => !knownDeviations.includes(key));
	if (unexpected.length > 0) {
		throw new Error(
			`${resource} carries ${unexpected.length} key(s) Google's schema does not define: ${unexpected
				.map((key) => `"${key}"`)
				.join(
					", "
				)}.\nAllowed top-level keys are documented at ${docUrl(resource)}\nRemove the key, move it to the resource that defines it, or — if the docs disagree with this whitelist — update src/golden/google-schema.ts citing the doc.`
		);
	}

	const fixed = knownDeviations.filter((key) => !unknown.includes(key));
	if (fixed.length > 0) {
		throw new Error(
			`${resource} no longer emits the known-deviation key(s) ${fixed
				.map((key) => `"${key}"`)
				.join(
					", "
				)}. The underlying bug looks fixed — delete them from KNOWN_DEVIATIONS so the whitelist stays exact.\nSee ${docUrl(resource)}`
		);
	}
}

/**
 * Asserts that `body` carries every key Google documents as required for the
 * resource. Complements the whitelist: one catches keys that should not be
 * there, the other catches keys that must be.
 */
export function assertRequiredKeys(
	resource: GoogleResource,
	body: Record<string, unknown>,
	required: readonly string[]
): void {
	const missing = required.filter((key) => body[key] === undefined);
	if (missing.length > 0) {
		throw new Error(
			`${resource} is missing required key(s): ${missing
				.map((key) => `"${key}"`)
				.join(", ")}.\nSee ${docUrl(resource)}`
		);
	}
}
