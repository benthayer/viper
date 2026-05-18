import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model.deleteOne / deleteMany (${BACKEND})`, () => {
  let setup: TestSetup;
  let Token: any;
  let InboxNotification: any;

  beforeEach(async () => {
    setup = await createTestSetup({
      Token: "tokens",
      InboxNotification: "inboxnotifications",
    });
    Token = setup.getModel("Token");
    InboxNotification = setup.getModel("InboxNotification");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("deleteOne(filter) — bare", async () => {
    await Token.create({ owner: "u1" });
    await Token.create({ owner: "u2" });
    await Token.deleteMany({ owner: "u1" });
    const count = await setup.ctx.db.collection("tokens").countDocuments();
    expect(count).toBe(1);
  });

  it("deleteOne().comment()", async () => {
    await Token.create({ owner: "u1" });
    await Token.create({ owner: "u1" });
    await Token.deleteOne({ owner: "u1" }).comment("inv:deleteOneComment");
    const count = await setup.ctx.db
      .collection("tokens")
      .countDocuments({ owner: "u1" });
    expect(count).toBe(1);
  });

  it("deleteMany().comment().hint()", async () => {
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const recent = new Date();
    await InboxNotification.create({ read: true, createdAt: old });
    await InboxNotification.create({ read: true, createdAt: old });
    await InboxNotification.create({ read: true, createdAt: recent });
    await InboxNotification.deleteMany({
      read: true,
      createdAt: { $lt: new Date(Date.now() - 12 * 60 * 60 * 1000) },
    })
      .comment("inv:deleteManyCommentHint")
      .hint("_id_");
    const remaining = await setup.ctx.db
      .collection("inboxnotifications")
      .countDocuments();
    expect(remaining).toBe(1);
  });
});
