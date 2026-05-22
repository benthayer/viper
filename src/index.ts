// Public surface. Just createGetModel — no Schema, no Types, no
// connection management, no Model export. The caller wires up the
// MongoClient + Db themselves and hands us the Db.
//
// See README.md for the full design rationale.

export { createGetModel } from "./createGetModel.js";
export { CastIdsConflictError } from "./CastIdsConflictError.js";
export { CastDatesConflictError } from "./CastDatesConflictError.js";
export type {
  CreateGetModelOpts,
  GetModel,
  PopulateConfig,
  CastIdsConflictPolicy,
  CastDatesConflictPolicy,
} from "./types.js";
