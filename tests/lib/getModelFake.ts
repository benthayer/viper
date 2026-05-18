// Fake-mongoose harness adapter. Once src/createGetModel.ts exists this
// will delegate; until then it throws so tests with MONGOOSE_BACKEND=fake
// fail loudly rather than silently doing nothing.

import type { Db } from "mongodb";
import type { GetModel, CreateGetModelOpts } from "./getModelMongoose.js";

// @ts-ignore — src/ resolves at runtime; tsc may complain about ESM specifier.
import { createGetModel as createGetModelFake } from "../../src/index.js";

export type FakeOpts = {
  db: Db;
  models: CreateGetModelOpts["models"];
  populates?: CreateGetModelOpts["populates"];
  autoCastIds?: CreateGetModelOpts["autoCastIds"];
  castIdsConflictPolicy?: CreateGetModelOpts["castIdsConflictPolicy"];
};

export const createGetModelFakeAdapter = async (
  opts: FakeOpts,
): Promise<{ getModel: GetModel; teardown: () => Promise<void> }> => {
  const getModel = createGetModelFake({
    db: opts.db,
    models: opts.models,
    populates: opts.populates,
    autoCastIds: opts.autoCastIds,
    castIdsConflictPolicy: opts.castIdsConflictPolicy,
  });
  return { getModel, teardown: async () => {} };
};
