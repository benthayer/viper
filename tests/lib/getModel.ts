// single backend-selection seam. All tests import getModel from
// here. Env var MONGOOSE_BACKEND picks the implementation.
//   real → real mongoose, via getModelMongoose.ts
//   fake → viper (src/), via getModelFake.ts
// Default is "fake" so CI catches regressions without ceremony.

import type { Db, MongoClient } from "mongodb";
import {
  createGetModelMongoose,
  type CreateGetModelOpts,
  type GetModel,
} from "./getModelMongoose.js";
import { createGetModelFakeAdapter } from "./getModelFake.js";

export type Backend = "real" | "fake";

export const BACKEND: Backend =
  (process.env.MONGOOSE_BACKEND as Backend) ?? "fake";

export type SetupArgs = {
  uri: string;
  dbName: string;
  db: Db;
  // Native test client. viper uses this directly. real-mongoose
  // ignores it and owns its own client (whose handle we re-expose as
  // `queryClient` for the query counter).
  client: MongoClient;
  models: CreateGetModelOpts["models"];
  populates?: CreateGetModelOpts["populates"];
  autoCastIds?: CreateGetModelOpts["autoCastIds"];
  castIdsConflictPolicy?: CreateGetModelOpts["castIdsConflictPolicy"];
  autoCastDates?: CreateGetModelOpts["autoCastDates"];
  castDatesConflictPolicy?: CreateGetModelOpts["castDatesConflictPolicy"];
};

export type SetupResult = {
  getModel: GetModel;
  teardown: () => Promise<void>;
  backend: Backend;
  // The client through which the model layer issues commands. For real
  // mongoose this is mongoose's internal client; for viper
  // it's the same client passed in via args. Tests that need
  // command-level introspection should attach to this one.
  queryClient: MongoClient;
};

export const setupGetModel = async (args: SetupArgs): Promise<SetupResult> => {
  if (BACKEND === "real") {
    const { getModel, teardown, mongooseInstance } =
      await createGetModelMongoose({
        uri: args.uri,
        dbName: args.dbName,
        models: args.models,
        populates: args.populates,
      });
    // Mongoose bundles its own mongodb driver internally — the
    // MongoClient class it returns is structurally identical but
    // nominally distinct from the one in our top-level mongodb dep.
    // Tests only use this client's command-monitoring API, which is on
    // both, so the cast is safe.
    const queryClient = mongooseInstance.connection.getClient() as unknown as MongoClient;
    return { getModel, teardown, backend: "real", queryClient };
  }
  const { getModel, teardown } = await createGetModelFakeAdapter({
    db: args.db,
    models: args.models,
    populates: args.populates,
    autoCastIds: args.autoCastIds,
    castIdsConflictPolicy: args.castIdsConflictPolicy,
    autoCastDates: args.autoCastDates,
    castDatesConflictPolicy: args.castDatesConflictPolicy,
  });
  return { getModel, teardown, backend: "fake", queryClient: args.client };
};
