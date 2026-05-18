// Model.create — only entry verb in inventory with zero chain
// signatures other than the bare call. Arg shapes covered:
//   create(object)            — single doc
//   create(array)             — multiple docs
//   create(array, object)     — multiple docs + options

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model.create (${BACKEND})`, () => {
  let setup: TestSetup;
  let User: any;

  beforeEach(async () => {
    setup = await createTestSetup({ User: "users" });
    User = setup.getModel("User");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("create(object) — single doc", async () => {
    const created = await User.create({ username: "alice", balance: 1 });
    expect(created.username).toBe("alice");
    expect(created._id).toBeTruthy();
    const count = await setup.ctx.db.collection("users").countDocuments();
    expect(count).toBe(1);
  });

  it("create(array) — multiple docs", async () => {
    const created = await User.create([
      { username: "alice" },
      { username: "bob" },
    ]);
    expect(created).toHaveLength(2);
    const count = await setup.ctx.db.collection("users").countDocuments();
    expect(count).toBe(2);
  });

  it("create(array, options) — ordered:true", async () => {
    await User.create(
      [{ username: "alice" }, { username: "bob" }],
      { ordered: true },
    );
    const count = await setup.ctx.db.collection("users").countDocuments();
    expect(count).toBe(2);
  });

  it("created docs come back with _id assigned", async () => {
    const created = await User.create({ username: "alice" });
    expect(created._id).toBeTruthy();
    const found = await setup.ctx.db
      .collection("users")
      .findOne({ _id: created._id });
    expect(found).toBeTruthy();
  });
});
