import { WalletError, type WalletErrorCode } from "../errors";

/** One failed rule: where it failed, relative to the checked value, and why. */
export interface Issue {
	message: string;
	path: (string | number)[];
}

type Result<T> = { ok: true; value: T } | { ok: false; issues: Issue[] };

/**
 * Validates an unknown input into a `T`, collecting every issue. A failing
 * child reports a path relative to itself and each parent prefixes its own
 * key on the way up, so a valid input allocates no paths at all.
 *
 * Invariant in `T`, so a check typed for `string` cannot stand in for an
 * optional `string | undefined` member, or the reverse. Invariance holds only
 * for values typed `Check<T>`: a bare `(input: unknown) => Result<string>`
 * arrow is compared structurally and fits an optional member too, so every
 * schema check is annotated or built by the functions below.
 */
export type Check<in out T> = (input: unknown) => Result<T>;

/** A check for every member of `T`, optional members included. */
export type Shape<T> = { readonly [K in keyof T]-?: Check<T[K]> };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });

const fail = (message: string): { ok: false; issues: Issue[] } => ({
	ok: false,
	issues: [{ message, path: [] }],
});

// Absent optional members are the common case; they share one result.
const ABSENT: Result<undefined> = Object.freeze({ ok: true, value: undefined });

function typeError(input: unknown, expected: string) {
	return fail(input === undefined ? "is required" : `must be ${expected}`);
}

function prefix(issues: Issue[], key: string | number): Issue[] {
	for (const issue of issues) {
		issue.path.unshift(key);
	}
	return issues;
}

function isObject(input: unknown): input is Record<string, unknown> {
	return typeof input === "object" && input !== null && !Array.isArray(input);
}

export const string: Check<string> = (input) =>
	typeof input === "string" ? ok(input) : typeError(input, "a string");

/** A string with surrounding whitespace removed. */
export const trimmed: Check<string> = (input) =>
	typeof input === "string" ? ok(input.trim()) : typeError(input, "a string");

export const number: Check<number> = (input) =>
	typeof input === "number" && Number.isFinite(input)
		? ok(input)
		: typeError(input, "a number");

export const integer: Check<number> = (input) =>
	typeof input === "number" && Number.isSafeInteger(input)
		? ok(input)
		: typeError(input, "an integer");

export const boolean: Check<boolean> = (input) =>
	typeof input === "boolean" ? ok(input) : typeError(input, "true or false");

/** Any value, unchecked: the open dictionaries Apple passes through. */
export const unknown: Check<unknown> = ok;

export function instance<T>(
	type: abstract new (...args: never[]) => T,
	expected: string
): Check<T> {
	return (input) =>
		input instanceof type ? ok(input) : typeError(input, expected);
}

/** One of `values`; the message lists them all. */
export function picklist<const T extends readonly (string | number)[]>(
	values: T
): Check<T[number]> {
	const allowed = new Set<unknown>(values);
	const expected = `one of ${values.map((v) => JSON.stringify(v)).join(", ")}`;
	return (input) =>
		allowed.has(input)
			? // Membership in `values` is the runtime check this narrows on.
				ok(input as T[number])
			: typeError(input, expected);
}

/** `undefined` passes as is; anything else must pass `check`. */
export function optional<T>(check: Check<T>): Check<T | undefined> {
	return (input) => (input === undefined ? ABSENT : check(input));
}

/** `undefined` becomes `fallback()`; anything else must pass `check`. */
export function withDefault<T>(check: Check<T>, fallback: () => T): Check<T> {
	return (input) => (input === undefined ? ok(fallback()) : check(input));
}

export function nullable<T>(check: Check<T>): Check<T | null> {
	return (input) => (input === null ? ok(null) : check(input));
}

/** A refinement of `check`: `rule` returns a message when the value breaks it. */
export function refine<T>(
	check: Check<T>,
	rule: (value: T) => string | undefined
): Check<T> {
	return (input) => {
		const result = check(input);
		if (!result.ok) {
			return result;
		}
		const message = rule(result.value);
		return message === undefined ? result : fail(message);
	};
}

/**
 * A rule across the members of an object `check` accepted, reporting issues
 * at member paths.
 */
export function crossCheck<T>(
	check: Check<T>,
	rule: (value: T) => Issue[]
): Check<T> {
	return (input) => {
		const result = check(input);
		if (!result.ok) {
			return result;
		}
		const issues = rule(result.value);
		return issues.length === 0 ? result : { ok: false, issues };
	};
}

export const nonEmpty = refine(string, (value) =>
	value.length === 0 ? "must not be empty" : undefined
);

export function pattern(regex: RegExp, message: string): Check<string> {
	return refine(string, (value) => (regex.test(value) ? undefined : message));
}

export function array<T>(item: Check<T>, maxItems?: number): Check<T[]> {
	return (input) => {
		if (!Array.isArray(input)) {
			return typeError(input, "a list");
		}
		if (maxItems !== undefined && input.length > maxItems) {
			return fail(`accepts at most ${maxItems} entries`);
		}
		const value: T[] = [];
		const issues: Issue[] = [];
		for (const [index, entry] of input.entries()) {
			const result = item(entry);
			if (result.ok) {
				value.push(result.value);
			} else {
				issues.push(...prefix(result.issues, index));
			}
		}
		return issues.length === 0 ? ok(value) : { ok: false, issues };
	};
}

/** A dictionary whose keys pass `key` and whose values pass `item`. */
export function record<T>(
	item: Check<T>,
	key: Check<string> = string
): Check<Record<string, T>> {
	return (input) => {
		if (!isObject(input)) {
			return typeError(input, "an object");
		}
		const entries: [string, T][] = [];
		const issues: Issue[] = [];
		for (const [name, entry] of Object.entries(input)) {
			const keyResult = key(name);
			if (!keyResult.ok) {
				issues.push(...prefix(keyResult.issues, name));
				continue;
			}
			const result = item(entry);
			if (result.ok) {
				entries.push([name, result.value]);
			} else {
				issues.push(...prefix(result.issues, name));
			}
		}
		// fromEntries defines keys, so a "__proto__" key stays a plain key.
		return issues.length === 0
			? ok(Object.fromEntries(entries))
			: { ok: false, issues };
	};
}

/**
 * An object with exactly the members `shape` declares. Unknown keys are
 * dropped and absent optional members stay absent, so the result carries
 * nothing the types do not name.
 */
export function object<T>(shape: Shape<T>): Check<T> {
	const members: [string, Check<unknown>][] = Object.entries(shape);
	return (input) => {
		if (!isObject(input)) {
			return typeError(input, "an object");
		}
		const value: Record<string, unknown> = {};
		const issues: Issue[] = [];
		for (const [key, check] of members) {
			const result = check(input[key]);
			if (!result.ok) {
				issues.push(...prefix(result.issues, key));
			} else if (result.value !== undefined) {
				value[key] = result.value;
			}
		}
		return issues.length === 0
			? // Every member of `shape` passed its own check of `T[K]`.
				ok(value as T)
			: { ok: false, issues };
	};
}

/**
 * One of several object checks, chosen by the input's `type` member. A
 * `type` outside the options is reported at `type`, listing them.
 */
export function variant<T extends { type: string }>(
	options: {
		readonly [K in T["type"]]: Check<Extract<T, { type: K }>>;
	}
): Check<T> {
	const types = Object.keys(options);
	const expected = `one of ${types.map((t) => JSON.stringify(t)).join(", ")}`;
	return (input) => {
		if (!isObject(input)) {
			return typeError(input, "an object");
		}
		const { type } = input;
		if (typeof type !== "string" || !Object.hasOwn(options, type)) {
			return {
				ok: false,
				issues: prefix(typeError(type, expected).issues, "type"),
			};
		}
		// `type` is one of `options`' own keys, checked just above.
		return options[type as T["type"]](input);
	};
}

/**
 * The value `check` accepts, or a {@link WalletError} with `code` listing
 * every issue. The message names the first issue's path, or `label` for the
 * value as a whole.
 */
export function validate<T>(
	check: Check<T>,
	input: unknown,
	code: Extract<
		WalletErrorCode,
		"PASS_CONFIG_INVALID" | "CREATE_CONFIG_INVALID"
	>,
	label: string
): T {
	const result = check(input);
	if (result.ok) {
		return result.value;
	}
	const [first] = result.issues;
	throw new WalletError(
		code,
		first && `${first.path.join(".") || label}: ${first.message}`,
		{ issues: result.issues }
	);
}
