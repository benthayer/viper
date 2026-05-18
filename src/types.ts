import type { Db } from "mongodb";

export type PopulateConfig = Record<
  string,
  Record<string, { collection: string }>
>;

// How to resolve a single Query that has had both `.castIds()` and
// `.skipCastIds()` called on it. Multiple calls of the same method
// are NOT a conflict — only the mixed case is.
//
//   throw        — throw CastIdsConflictError at exec time (default)
//   firstWins    — the first of the two methods called wins
//   lastWins     — the last of the two methods called wins
//   defaultWins  — fall back to the constructor's `autoCastIds` value
export type CastIdsConflictPolicy =
  | "throw"
  | "firstWins"
  | "lastWins"
  | "defaultWins";

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
};

export type GetModel = (name: string) => any;
