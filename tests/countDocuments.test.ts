import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model.countDocuments + .exists (${BACKEND})`, () => {
  let setup: TestSetup;
  let User: any;

  beforeEach(async () => {
    setup = await createTestSetup({ User: "users" });
    User = setup.getModel("User");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("countDocuments(filter) — bare", async () => {
    await User.create({ username: "alice" });
    await User.create({ username: "bob" });
    const n = await User.countDocuments({ username: "alice" });
    expect(n).toBe(1);
  });

  it("countDocuments().comment()", async () => {
    await User.create({ username: "alice" });
    await User.create({ username: "alice" });
    const n = await User.countDocuments({ username: "alice" }).comment(
      "inv:countDocumentsComment",
    );
    expect(n).toBe(2);
  });

  it("countDocuments().or().comment()", async () => {
    await User.create({ username: "alice", email: "a@x" });
    await User.create({ username: "bob", email: "b@x" });
    await User.create({ username: "carol", email: "c@x" });
    const n = await User.countDocuments()
      .or([{ username: "alice" }, { email: "b@x" }])
      .comment("inv:countOrComment");
    expect(n).toBe(2);
  });

  it("exists(filter) returns truthy when present", async () => {
    await User.create({ username: "alice" });
    const result = await User.exists({ username: "alice" });
    expect(result).toBeTruthy();
  });

  it("exists(filter) returns null when absent", async () => {
    const result = await User.exists({ username: "nobody" });
    expect(result).toBeNull();
  });
});
