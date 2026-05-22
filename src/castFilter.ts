/**
 * Auto-cast filter values that look like ObjectIds.
 *
 * Mongoose does this via schema knowledge ("this field is an ObjectId
 * ref, so cast the string"). We don't have schemas, so we use the
 * structurally atomic rule:
 *
 *   A 24-character hex string in a filter position is an ObjectId.
 *
 * This is the boundary where call sites stop having to remember to
 * wrap with `new ObjectId(...)`. Without it, queries like
 * `{ authorID: user.id }` silently match nothing because the stored
 * value is an ObjectId but the filter is a string.
 *
 * Scope:
 *   - Only the filter argument. Updates ($set/$push/$inc payloads) are
 *     left alone — the user controls what gets written.
 *   - Recursive into nested objects so $and/$or/$nor work, as do
 *     positional operators like `{ items.0.ownerID: "..." }`.
 *   - $in arrays: each element is cast individually.
 *   - $regex / $text / $expr / $where / $jsonSchema / $where are
 *     skipped — those operators take strings, not ObjectIds.
 */

import { ObjectId } from "bson";

const HEX_24 = /^[a-f0-9]{24}$/i;

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

const toOidIfHex = (v: any): any => (isHex24(v) ? new ObjectId(v) : v);

export const castFilter = (filter: any): any => {
  if (filter == null) return filter;
  if (Array.isArray(filter)) return filter.map(castFilter);
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
      out[key] = ensureArray(value).map(castValue);
      continue;
    }
    out[key] = castValue(value);
  }
  return out;
};

const castValue = (value: any): any => {
  if (isHex24(value)) return new ObjectId(value);
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(castValue);
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
      out[k] = ensureArray(v).map(castValue);
      continue;
    }
    out[k] = castValue(v);
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
