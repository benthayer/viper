// Standard per-test setup. Builds a TestDbContext, plus a getModel for
// the requested model set + populates. Returns a teardown that cleans
// both up. Use in beforeEach / afterEach.

import {
  connectTestDb,
  teardownTestDb,
  type TestDbContext,
} from "./db.js";
import type { MongoClient } from "mongodb";
import {
  setupGetModel,
  type Backend,
  BACKEND,
} from "./getModel.js";
import type { CreateGetModelOpts, GetModel } from "./getModelMongoose.js";

const URI =
  process.env.MONGO_URI ??
  "mongodb://localhost:27017/?directConnection=true";

export type TestSetup = {
  ctx: TestDbContext;
  getModel: GetModel;
  backend: Backend;
  queryClient: MongoClient;
  teardown: () => Promise<void>;
};

export type CreateTestSetupExtras = {
  populates?: CreateGetModelOpts["populates"];
  autoCastIds?: CreateGetModelOpts["autoCastIds"];
  castIdsConflictPolicy?: CreateGetModelOpts["castIdsConflictPolicy"];
  autoCastDates?: CreateGetModelOpts["autoCastDates"];
  castDatesConflictPolicy?: CreateGetModelOpts["castDatesConflictPolicy"];
};

export const createTestSetup = async (
  models: CreateGetModelOpts["models"],
  populatesOrExtras?:
    | CreateGetModelOpts["populates"]
    | CreateTestSetupExtras,
): Promise<TestSetup> => {
  // Back-compat: existing tests call createTestSetup(models, populates).
  // New tests can pass an extras bag to opt into auto-cast settings.
  const extras: CreateTestSetupExtras = isExtrasBag(populatesOrExtras)
    ? populatesOrExtras
    : { populates: populatesOrExtras };
  const ctx = await connectTestDb();
  const {
    getModel,
    teardown: teardownGetModel,
    queryClient,
  } = await setupGetModel({
    uri: URI,
    dbName: ctx.dbName,
    db: ctx.db,
    client: ctx.client,
    models,
    populates: extras.populates,
    autoCastIds: extras.autoCastIds,
    castIdsConflictPolicy: extras.castIdsConflictPolicy,
    autoCastDates: extras.autoCastDates,
    castDatesConflictPolicy: extras.castDatesConflictPolicy,
  });
  const teardown = async () => {
    await teardownGetModel();
    await teardownTestDb(ctx);
  };
  return { ctx, getModel, backend: BACKEND, queryClient, teardown };
};

// Heuristic: the extras bag has at least one of these keys, none of
// which would ever appear in a populates config (which is keyed by
// model name).
const isExtrasBag = (
  v: any,
): v is CreateTestSetupExtras => {
  if (!v || typeof v !== "object") return false;
  return (
    "autoCastIds" in v ||
    "castIdsConflictPolicy" in v ||
    "autoCastDates" in v ||
    "castDatesConflictPolicy" in v ||
    "populates" in v
  );
};
