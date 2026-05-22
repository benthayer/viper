import mongoose, { Schema } from "mongoose";

// Real-mongoose harness. Builds a getModel using schemaless
// strict:false schemas so the test suite doesn't need to know anything
// about real domain schemas.
//
// Architecture:
// - Single shared mongoose connection across the whole test run,
//   pointed at the shared test DB (dbName from db.ts).
// - Models are registered once per (name, schemaShape) cache key on
//   that root connection. Re-using the same shape returns the cached
//   model; new shapes (different populate configs) get registered
//   under a unique synthetic name but still expose the canonical name
//   via getModel.
// - Per-test isolation comes from collection drops in db.ts, NOT from
//   tearing down connections or model registries.
//
// Why no useDb: useDb-derived connections share the underlying
// MongoClient with the root and have flaky "connection not ready"
// behavior when re-created across tests after collection drops. One
// flat registry on the root connection is simpler and rock-solid.

export type GetModel = (name: string) => any;

export type PopulateConfig = Record<
  string,
  Record<string, { collection: string }>
>;

export type CreateGetModelOpts = {
  uri: string;
  dbName: string;
  models: Record<string, string>;
  populates?: PopulateConfig;
  // fake-only — real-mongoose ignores these (mongoose's own
  // schema-driven cast applies wherever a Schema.Types.ObjectId / Date
  // field is declared in the test harness's synthetic schemas).
  autoCastIds?: boolean;
  castIdsConflictPolicy?: "throw" | "firstWins" | "lastWins" | "defaultWins";
  autoCastDates?: boolean;
  castDatesConflictPolicy?: "throw" | "firstWins" | "lastWins" | "defaultWins";
};

let sharedConn: mongoose.Mongoose | null = null;

const getSharedConn = async (
  uri: string,
  dbName: string,
): Promise<mongoose.Mongoose> => {
  if (!sharedConn) {
    sharedConn = new mongoose.Mongoose();
    await sharedConn.connect(uri, {
      dbName,
      monitorCommands: true,
    } as any);
  }
  return sharedConn;
};

// Global registry: canonical model name → registered model. Survives
// across tests. We register each model exactly once on the shared root
// connection under its real name so populate ref strings resolve
// correctly. The schema is the union of every populate config we've
// seen for that name (strict:false makes extra ref fields harmless for
// tests that don't populate them).
const modelRegistry = new Map<string, any>();
// Track what populate paths each registered model already covers, so
// re-registering with the same set is a no-op and a superset would
// be an explicit error (signals a test fixture conflict).
const modelPopulatePaths = new Map<string, Set<string>>();

export const createGetModelMongoose = async (
  opts: CreateGetModelOpts,
): Promise<{
  getModel: GetModel;
  teardown: () => Promise<void>;
  mongooseInstance: mongoose.Mongoose;
}> => {
  const root = await getSharedConn(opts.uri, opts.dbName);

  const collectionToModel = new Map<string, string>();
  for (const [name, collection] of Object.entries(opts.models)) {
    collectionToModel.set(collection, name);
  }

  const perCallModels = new Map<string, any>();
  for (const [name, collection] of Object.entries(opts.models)) {
    const populates = opts.populates?.[name];
    const requestedPaths = new Set(populates ? Object.keys(populates) : []);

    const existing = modelRegistry.get(name);
    if (existing) {
      const known = modelPopulatePaths.get(name) ?? new Set();
      for (const p of requestedPaths) {
        if (!known.has(p)) {
          throw new Error(
            `Model "${name}" already registered without populate path "${p}". ` +
              `Tests must agree on the populate config for a given model name across the run, ` +
              `or use a different model name. (Test harness limitation: see getModelMongoose.ts)`,
          );
        }
      }
      perCallModels.set(name, existing);
      continue;
    }

    const definition: Record<string, any> = {};
    if (populates) {
      const entries = Object.entries(populates).sort(
        ([a], [b]) => Number(b.includes(".")) - Number(a.includes(".")),
      );
      for (const [path, cfg] of entries) {
        const refModel = collectionToModel.get(cfg.collection);
        if (!refModel) continue;
        if (path.includes(".")) {
          const [parent, child] = path.split(".");
          if (definition[parent]) continue;
          definition[parent] = [
            { [child]: { type: Schema.Types.ObjectId, ref: refModel } },
          ];
        } else {
          if (definition[path]) continue;
          definition[path] = { type: Schema.Types.ObjectId, ref: refModel };
        }
      }
    }
    const schema = new Schema(definition, {
      strict: false,
      collection,
      _id: true,
    });
    const model = root.model(name, schema);
    modelRegistry.set(name, model);
    modelPopulatePaths.set(name, requestedPaths);
    perCallModels.set(name, model);
  }

  const getModel: GetModel = (name) => {
    const m = perCallModels.get(name);
    if (!m) throw new Error(`Unknown model: ${name}`);
    return m;
  };

  const teardown = async () => {
    // No-op. Connection + model registry persist across the whole run.
    // Per-test isolation is collection drops in db.ts.
  };

  return { getModel, teardown, mongooseInstance: root };
};
