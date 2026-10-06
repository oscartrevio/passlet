import { describe, expectTypeOf, it } from "vitest";
import type * as z from "zod/mini";
import type {
	AppLinkData,
	Barcode,
	BarcodeFormat,
	BoardingPassTemplateConfig,
	CouponTemplateConfig,
	DataDetectorType,
	DateStyle,
	EventTicketTemplateConfig,
	FieldDef,
	GenericTemplateConfig,
	GiftCardTemplateConfig,
	GoogleImageModule,
	GoogleLink,
	GoogleModules,
	GooglePassMessage,
	GoogleTransitOptions,
	GoogleValueAddedModule,
	ImageSet,
	Locales,
	Location,
	LoyaltyTemplateConfig,
	NumberStyle,
	PassContent,
	RotatingBarcode,
	SemanticTags,
	TemplateConfig,
	TemplateType,
	TextAlignment,
} from "../../../src/index";
import type {
	ParsedContent,
	passContentSchema,
} from "../../../src/schema/content";
import type {
	barcodeFormatSchema,
	barcodeSchema,
	dataDetectorTypeSchema,
	dateStyleSchema,
	fieldDefSchema,
	googleAppLinkDataSchema,
	googleMessageSchema,
	googleModulesSchema,
	imageSet,
	locationSchema,
	numberStyleSchema,
	semanticTagsSchema,
	textAlignmentSchema,
} from "../../../src/schema/parts";
import type {
	boardingPassTemplateSchema,
	couponTemplateSchema,
	eventTicketTemplateSchema,
	genericTemplateSchema,
	giftCardTemplateSchema,
	loyaltyTemplateSchema,
	ParsedTemplate,
	templateConfigSchema,
} from "../../../src/schema/template";

// The public types are written by hand so the published declarations never
// reference zod. These checks fail type checking when one drifts from what
// its schema accepts.

// Template configs suggest per-type field keys; the schema takes any string.
type PlainFields<T> = T extends unknown
	? Omit<T, "fields"> & { fields?: FieldDef[] }
	: never;

type Modules = z.input<typeof googleModulesSchema>;
type ContentGoogle = NonNullable<z.input<typeof passContentSchema>["google"]>;
type BoardingPassGoogle = NonNullable<
	z.input<typeof boardingPassTemplateSchema>["google"]
>;

describe("public types match the schema input", () => {
	it("parts", () => {
		expectTypeOf<AppLinkData>().toEqualTypeOf<
			z.input<typeof googleAppLinkDataSchema>
		>();
		expectTypeOf<Barcode>().toEqualTypeOf<z.input<typeof barcodeSchema>>();
		expectTypeOf<BarcodeFormat>().toEqualTypeOf<
			z.input<typeof barcodeFormatSchema>
		>();
		expectTypeOf<DataDetectorType>().toEqualTypeOf<
			z.input<typeof dataDetectorTypeSchema>
		>();
		expectTypeOf<DateStyle>().toEqualTypeOf<z.input<typeof dateStyleSchema>>();
		expectTypeOf<FieldDef>().toEqualTypeOf<z.input<typeof fieldDefSchema>>();
		expectTypeOf<GoogleImageModule>().toEqualTypeOf<
			NonNullable<Modules["images"]>[number]
		>();
		expectTypeOf<GoogleLink>().toEqualTypeOf<
			NonNullable<Modules["links"]>[number]
		>();
		expectTypeOf<GoogleModules>().toEqualTypeOf<Modules>();
		expectTypeOf<GooglePassMessage>().toEqualTypeOf<
			z.input<typeof googleMessageSchema>
		>();
		expectTypeOf<GoogleValueAddedModule>().toEqualTypeOf<
			NonNullable<Modules["valueAdded"]>[number]
		>();
		expectTypeOf<ImageSet>().toEqualTypeOf<
			NonNullable<z.input<typeof imageSet>>
		>();
		expectTypeOf<Locales>().toEqualTypeOf<
			NonNullable<z.input<typeof loyaltyTemplateSchema>["locales"]>
		>();
		expectTypeOf<Location>().toEqualTypeOf<z.input<typeof locationSchema>>();
		expectTypeOf<NumberStyle>().toEqualTypeOf<
			z.input<typeof numberStyleSchema>
		>();
		expectTypeOf<SemanticTags>().toEqualTypeOf<
			z.input<typeof semanticTagsSchema>
		>();
		expectTypeOf<TextAlignment>().toEqualTypeOf<
			z.input<typeof textAlignmentSchema>
		>();
	});

	it("content", () => {
		expectTypeOf<PassContent>().toEqualTypeOf<
			z.input<typeof passContentSchema>
		>();
		expectTypeOf<RotatingBarcode>().toEqualTypeOf<
			NonNullable<ContentGoogle["rotatingBarcode"]>
		>();
	});

	it("templates", () => {
		expectTypeOf<PlainFields<LoyaltyTemplateConfig>>().branded.toEqualTypeOf<
			z.input<typeof loyaltyTemplateSchema>
		>();
		expectTypeOf<
			PlainFields<EventTicketTemplateConfig>
		>().branded.toEqualTypeOf<z.input<typeof eventTicketTemplateSchema>>();
		expectTypeOf<
			PlainFields<BoardingPassTemplateConfig>
		>().branded.toEqualTypeOf<z.input<typeof boardingPassTemplateSchema>>();
		expectTypeOf<PlainFields<CouponTemplateConfig>>().branded.toEqualTypeOf<
			z.input<typeof couponTemplateSchema>
		>();
		expectTypeOf<PlainFields<GiftCardTemplateConfig>>().branded.toEqualTypeOf<
			z.input<typeof giftCardTemplateSchema>
		>();
		expectTypeOf<PlainFields<GenericTemplateConfig>>().branded.toEqualTypeOf<
			z.input<typeof genericTemplateSchema>
		>();
		expectTypeOf<PlainFields<TemplateConfig>>().branded.toEqualTypeOf<
			z.input<typeof templateConfigSchema>
		>();
		expectTypeOf<TemplateType>().toEqualTypeOf<
			z.input<typeof templateConfigSchema>["type"]
		>();
		expectTypeOf<GoogleTransitOptions>().toEqualTypeOf<
			NonNullable<BoardingPassGoogle["transit"]>
		>();
	});
});

describe("parsed types match the schema output", () => {
	it("content", () => {
		expectTypeOf<ParsedContent>().branded.toEqualTypeOf<
			z.output<typeof passContentSchema>
		>();
	});

	it("templates", () => {
		expectTypeOf<ParsedTemplate>().branded.toEqualTypeOf<
			z.output<typeof templateConfigSchema>
		>();
	});
});
