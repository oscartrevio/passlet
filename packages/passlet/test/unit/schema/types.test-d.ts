// Compile-time only: `pnpm check-types` checks this file and vitest never
// runs it. The checks themselves are typed against the parsed interfaces in
// src/schema, so what remains to pin is how those types relate.
import { expectTypeOf } from "vitest";
import type {
	BarcodeFormat,
	GooglePassMessage,
	PassContent,
	TemplateConfig,
} from "../../../src/index";
import { number, object, optional, string } from "../../../src/schema/check";
import type { ParsedContent } from "../../../src/schema/content";
import type { ParsedGooglePassMessage } from "../../../src/schema/google";
import type { ParsedTemplate } from "../../../src/schema/template";

// A parsed value is a valid input again: `template.config` rebuilds the
// template, and parsed content can be issued as is.
expectTypeOf<ParsedTemplate>().toExtend<TemplateConfig>();
expectTypeOf<ParsedContent>().toExtend<PassContent>();
expectTypeOf<ParsedGooglePassMessage>().toExtend<GooglePassMessage>();

// Defaults are applied, so their members are no longer optional.
expectTypeOf<ParsedTemplate["fields"]>().not.toBeNullable();
expectTypeOf<
	Extract<ParsedTemplate, { type: "coupon" }>["redemptionChannel"]
>().toEqualTypeOf<"online" | "instore" | "both">();
expectTypeOf<
	NonNullable<ParsedContent["barcode"]>["format"]
>().toEqualTypeOf<BarcodeFormat>();
expectTypeOf<ParsedGooglePassMessage["messageType"]>().toEqualTypeOf<
	"TEXT" | "TEXT_AND_NOTIFY"
>();

// A check out of step with its interface does not compile.
// @ts-expect-error -- a missing member
object<{ a: string; b: string }>({ a: string });
// @ts-expect-error -- a member the interface does not have
object<{ a: string }>({ a: string, b: string });
// @ts-expect-error -- a check of another type
object<{ a: string }>({ a: number });
// @ts-expect-error -- a required check for an optional member
object<{ a?: string }>({ a: string });
// @ts-expect-error -- an optional check for a required member
object<{ a: string }>({ a: optional(string) });
