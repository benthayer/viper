import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectTestDb,
  teardownTestDb,
  type TestDbContext,
} from "./lib/db.js";
import { setupGetModel, BACKEND } from "./lib/getModel.js";

// baseline smoke: prove the harness can spin up a DB,
// resolve a model through whichever backend is selected, insert + read
// one document, and clean up.

describe(`harness smoke (${BACKEND})`, () => {
  let ctx: TestDbContext;
  let teardownModel: () => Promise<void>;
  let User: any;

  beforeEach(async () => {
    ctx = await connectTestDb();
    const setup = await setupGetModel({
      uri:
        process.env.MONGO_URI ??
        "mongodb://localhost:27017/?directConnection=true",
      dbName: ctx.dbName,
      db: ctx.db,
      client: ctx.client,
      models: { User: "users" },
    });
    teardownModel = setup.teardown;
    User = setup.getModel("User");
  });

  afterEach(async () => {
    if (teardownModel) await teardownModel();
    await teardownTestDb(ctx);
  });

  it("inserts and reads back one doc", async () => {
    await User.create({ username: "smoke", balance: 1 });
    const found = await User.findOne({ username: "smoke" }).lean();
    expect(found).toBeTruthy();
    expect(found.username).toBe("smoke");
    expect(found.balance).toBe(1);
  });

  it("Model.db.db is the native Db (matches mongoose shape)", async () => {
    // Some libraries reach `Model.db.db` to bypass the ODM and
    // query with the native driver directly. We mimic that shape so
    // that drop-in works.
    expect(User.db).toBeDefined();
    expect(User.db.db).toBeDefined();
    // The native Db exposes a .collection(name) function.
    expect(typeof User.db.db.collection).toBe("function");
    const coll = User.db.db.collection("users");
    expect(typeof coll.findOne).toBe("function");
  });
});
