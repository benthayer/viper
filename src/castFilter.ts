/**
 * Auto-cast filter values whose shape is unambiguous in our domain.
 *
 * Mongoose does this via schema knowledge ("this field is an ObjectId
 * ref / a Date, so cast the string"). We don't have schemas, so we use
 * structurally atomic rules — only cast strings whose shape couldn't
 * plausibly be anything else:
 *
 *   - 24-character hex string                    → ObjectId
 *   - ISO 8601 datetime (Date.prototype.toISOString)  → Date
 *   - RFC 1123 datetime (Date.prototype.toUTCString)  → Date
 *
 * These are the boundaries where call sites stop having to remember to
 * wrap with `new ObjectId(...)` / `new Date(...)`. Without them, queries
 * like `{ authorID: user.id }` or
 * `{ createdAt: { $gt: new Date().toISOString() } }` silently match
 * nothing because the stored value is an ObjectId/Date but the filter
 * is a string.
 *
 * We deliberately do NOT use `Date.parse()` as the date detector — too
 * lossy. `Date.parse("5")` succeeds, and most "loose" date strings would
 * collide with legitimate string values. Restricting to the two shapes
 * `Date.prototype` produces keeps the false-positive surface effectively
 * empty: no human writes `"Fri, 22 May 2026 14:48:00 GMT"` as a username.
 *
 * Scope:
 *   - Only the filter argument. Updates ($set/$push/$inc payloads) are
 *     left alone — the user controls what gets written.
 *   - Recursive into nested objects so $and/$or/$nor work, as do
 *     positional operators like `{ items.0.ownerID: "..." }`.
 *   - $in arrays: each element is cast individually.
 *   - $regex / $text / $expr / $where / $jsonSchema / $where are
 *     skipped — those operators take strings, not values.
 *
 * Each cast is independently gated. Callers pass `{ castIds, castDates }`
 * resolved from the model defaults + per-query overrides; if both are
 * off, this function is a no-op.
 */

import { ObjectId } from "bson";

const HEX_24 = /^[a-f0-9]{24}$/i;

// `Date.prototype.toISOString()` output shape:
//   "2026-05-22T14:48:00.000Z"      (the only thing toISOString() ever produces)
// Also accept the slightly looser ISO 8601 forms a human might write:
//   "2026-05-22T14:48:00Z"          (no millis)
//   "2026-05-22T14:48:00+00:00"     (explicit offset)
//   "2026-05-22T14:48:00-05:00"
// Always requires the `T` separator + a timezone marker so bare dates
// like "2026" or "2026-05-22" don't match.
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:?\d{2})$/;

// `Date.prototype.toUTCString()` output shape:
//   "Fri, 22 May 2026 14:48:00 GMT"
// Day-of-week prefix + " GMT" suffix is unambiguous.
const RFC_1123 =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

// Operators whose values are intentional strings/expressions; never
// cast their contents.
const STRING_OPERATORS = new Set<string>([
  "$regex",
  "$options",
  "$text",
  "$where",
  "$expr",
  "$jsonSchema",
  "$comment",
  "$search",
  "$language",
  "$caseSensitive",
  "$diacriticSensitive",
]);

// Operators whose values MUST be arrays at the wire level. Mongoose
// silently wraps a scalar in a one-element array here; the native driver
// rejects with "$in needs an array" etc. We mirror Mongoose so call
// sites like `{ field: { $nin: 'X' } }` keep working.
const ARRAY_OPERATORS = new Set<string>([
  "$in",
  "$nin",
  "$all",
]);

const ensureArray = (v: any): any[] => (Array.isArray(v) ? v : [v]);

const isHex24 = (v: unknown): v is string =>
  typeof v === "string" && HEX_24.test(v);

const isDateString = (v: unknown): v is string =>
  typeof v === "string" && (ISO_8601.test(v) || RFC_1123.test(v));

export type CastOptions = {
  castIds: boolean;
  castDates: boolean;
};

export const castFilter = (filter: any, opts: CastOptions): any => {
  if (filter == null) return filter;
  if (!opts.castIds && !opts.castDates) return filter;
  if (Array.isArray(filter)) return filter.map((f) => castFilter(f, opts));
  if (typeof filter !== "object") return filter;
  // Leave ObjectId / Date / RegExp / etc. untouched.
  if (isBsonLike(filter)) return filter;

  const out: any = {};
  for (const [key, value] of Object.entries(filter)) {
    if (STRING_OPERATORS.has(key)) {
      out[key] = value;
      continue;
    }
    if (ARRAY_OPERATORS.has(key)) {
      out[key] = ensureArray(value).map((v) => castValue(v, opts));
      continue;
    }
    out[key] = castValue(value, opts);
  }
  return out;
};

const castValue = (value: any, opts: CastOptions): any => {
  if (opts.castIds && isHex24(value)) return new ObjectId(value);
  if (opts.castDates && isDateString(value)) return new Date(value);
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => castValue(v, opts));
  if (typeof value !== "object") return value;
  if (isBsonLike(value)) return value;

  // Object — could be an operator spec ({ $in: [...] }) or a nested
  // subdocument. Either way, recurse with the same rules.
  const out: any = {};
  for (const [k, v] of Object.entries(value)) {
    if (STRING_OPERATORS.has(k)) {
      out[k] = v;
      continue;
    }
    if (ARRAY_OPERATORS.has(k)) {
      out[k] = ensureArray(v).map((x) => castValue(x, opts));
      continue;
    }
    out[k] = castValue(v, opts);
  }
  return out;
};

// True for values we should pass through untouched (ObjectId, Date,
// Decimal128, Buffer, RegExp, etc.). Heuristic: non-plain objects.
const isBsonLike = (v: any): boolean => {
  if (v instanceof Date) return true;
  if (v instanceof RegExp) return true;
  // bson types and similar — anything whose prototype isn't plain Object
  const proto = Object.getPrototypeOf(v);
  return proto !== Object.prototype && proto !== null;
};
