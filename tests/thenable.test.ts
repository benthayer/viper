// Query objects must be thenable. await, .then, .catch, .exec
// all behave the same as mongoose.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Query is thenable (${BACKEND})`, () => {
  let setup: TestSetup;
  let User: any;

  beforeEach(async () => {
    setup = await createTestSetup({ User: "users" });
    User = setup.getModel("User");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("await query resolves to the result", async () => {
    await User.create({ username: "alice" });
    const docs = await User.find({}).lean();
    expect(docs).toHaveLength(1);
  });

  it("query.then(onFulfilled) fires with the result", async () => {
    await User.create({ username: "alice" });
    const docs = await new Promise<any>((resolve, reject) => {
      User.find({}).lean().then(resolve, reject);
    });
    expect(docs).toHaveLength(1);
  });

  it("query.exec() returns a real Promise", async () => {
    await User.create({ username: "alice" });
    const p = User.find({}).lean().exec();
    expect(typeof p.then).toBe("function");
    const docs = await p;
    expect(docs).toHaveLength(1);
  });

  it("query rejection is catchable via .catch", async () => {
    // Force a server-side failure via aggregate with an unknown
    // operator — guaranteed to error at execute time.
    let caught: any = null;
    await User.aggregate([{ $bogusStage: {} }] as any).catch((err: any) => {
      caught = err;
    });
    expect(caught).toBeTruthy();
  });

  it("re-awaiting an already-executed query throws (matches mongoose)", async () => {
    // corner: mongoose rejects re-execution of the same Query
    // with "Query was already executed". viper must match for
    // drop-in compatibility — call sites that wanted to re-run a query
    // would have to .clone() (we don't support that here unless the
    // inventory demands it).
    await User.create({ username: "alice" });
    const q = User.find({}).lean();
    await q;
    let secondErr: any = null;
    try {
      await q;
    } catch (e) {
      secondErr = e;
    }
    expect(secondErr).toBeTruthy();
    expect(String(secondErr.message)).toMatch(/already executed/i);
  });
});
