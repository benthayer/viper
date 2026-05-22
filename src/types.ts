import type { Db } from "mongodb";

export type PopulateConfig = Record<
  string,
  Record<string, { collection: string }>
>;

// How to resolve a single Query that has had both `.castIds()` and
// `.skipCastIds()` (or `.castDates()` and `.skipCastDates()`) called on
// it. Multiple calls of the same method are NOT a conflict — only the
// mixed case is.
//
//   throw        — throw the corresponding ConflictError at exec time (default)
//   firstWins    — the first of the two methods called wins
//   lastWins     — the last of the two methods called wins
//   defaultWins  — fall back to the constructor's autoCast* value
export type CastIdsConflictPolicy =
  | "throw"
  | "firstWins"
  | "lastWins"
  | "defaultWins";

// Same shape as CastIdsConflictPolicy. Aliased so the option names read
// naturally and so we can diverge later if needed without breaking
// callers.
export type CastDatesConflictPolicy = CastIdsConflictPolicy;

export type CreateGetModelOpts = {
  db: Db;
  models: Record<string, string>;
  populates?: PopulateConfig;

  // Auto-cast 24-char hex strings in filter positions to ObjectId
  // before sending to the driver. ON by default — Mongoose does this
  // silently from the schema, and viper is a drop-in replacement.
  //
  // Pass `false` to disable globally, or call `.skipCastIds()` on
  // individual queries where the filter value happens to look like a
  // hex id but isn't one. See SECURITY.md for the trade-offs.
  autoCastIds?: boolean;

  // Default: "throw". See type docs.
  castIdsConflictPolicy?: CastIdsConflictPolicy;

  // Auto-cast ISO 8601 / RFC 1123 date strings in filter positions to
  // Date before sending to the driver. ON by default — Mongoose does
  // this silently from the schema (`Schema.Types.Date` casting), and
  // queries like `{ createdAt: { $gt: new Date().toISOString() } }`
  // would otherwise silently match nothing against a Date field.
  //
  // Only the two structurally-unambiguous shapes are matched:
  // `Date.prototype.toISOString()` and `Date.prototype.toUTCString()`
  // output. Loose `Date.parse()`-style detection is not used.
  //
  // Pass `false` to disable globally, or call `.skipCastDates()` on
  // individual queries.
  autoCastDates?: boolean;

  // Default: "throw". See type docs.
  castDatesConflictPolicy?: CastDatesConflictPolicy;
};

export type GetModel = (name: string) => any;
