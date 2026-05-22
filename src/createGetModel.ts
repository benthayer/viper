import { Model } from "./Model.js";
import type { CreateGetModelOpts, GetModel } from "./types.js";

// Build a registry of Model instances keyed by name. The returned
// getModel is the only thing call sites see; they never touch Model
// directly.
export const createGetModel = (opts: CreateGetModelOpts): GetModel => {
  const registry = new Map<string, Model>();

  // collection name -> model name, so populate can resolve refs by
  // collection (matches how the test fixtures express them).
  const collectionToModelName = new Map<string, string>();
  for (const [name, collection] of Object.entries(opts.models)) {
    collectionToModelName.set(collection, name);
  }

  const getModelByName = (name: string): Model => {
    const m = registry.get(name);
    if (!m) throw new Error(`Unknown model: ${name}`);
    return m;
  };

  // Resolve defaults once, here, so each Model gets a frozen copy.
  // autoCastIds / autoCastDates default to ON for Mongoose-parity —
  // Mongoose silently coerces 24-char hex strings to ObjectId and
  // ISO/RFC 1123 strings to Date via schema, and viper is a drop-in
  // replacement. Set to false to opt out.
  const autoCastIds = opts.autoCastIds !== false;
  const autoCastDates = opts.autoCastDates !== false;
  // Conflict resolution defaults to "throw" so .castX() and .skipCastX()
  // colliding on the same query surfaces the bug instead of silently
  // picking one.
  const castIdsConflictPolicy = opts.castIdsConflictPolicy ?? "throw";
  const castDatesConflictPolicy = opts.castDatesConflictPolicy ?? "throw";

  for (const [name, collection] of Object.entries(opts.models)) {
    const populates = opts.populates?.[name];
    const model = new Model({
      name,
      collection: opts.db.collection(collection),
      db: opts.db,
      populates: populates ?? {},
      collectionToModelName,
      getModelByName,
      autoCastIds,
      castIdsConflictPolicy,
      autoCastDates,
      castDatesConflictPolicy,
    });
    registry.set(name, model);
  }

  return (name: string) => getModelByName(name);
};
