// { session } option must thread through reads and writes to
// the native driver. We prove this by running ops inside a transaction,
// aborting, and verifying the writes were rolled back via the native
// client (bypassing the model layer).
//
// Note: requires a replica-set-enabled local mongo (our docker-compose
// runs a single-node RS, so this works locally per
// local-infrastructure.mdc).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`session / transaction threading (${BACKEND})`, () => {
  let setup: TestSetup;
  let User: any;
  let Post: any;

  beforeEach(async () => {
    setup = await createTestSetup({
      User: "users",
      Post: "posts",
    });
    User = setup.getModel("User");
    Post = setup.getModel("Post");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("aborted txn rolls back writes when { session } is threaded", async () => {
    // Pre-seed one user the txn will increment.
    await User.create({ username: "alice", balance: 100 });

    const sessionForTxn = setup.queryClient.startSession();
    sessionForTxn.startTransaction();
    try {
      await User.updateOne(
        { username: "alice" },
        { $inc: { balance: 50 } },
        { session: sessionForTxn },
      );
      await Post.create(
        [{ ownerID: "alice", flag: true }],
        { session: sessionForTxn },
      );
      // Sanity: inside the txn, the modified value is visible to the
      // same session.
      const midTxn = await User.findOne({ username: "alice" })
        .session(sessionForTxn)
        .lean();
      expect(midTxn?.balance).toBe(150);
      // Abort.
      await sessionForTxn.abortTransaction();
    } finally {
      await sessionForTxn.endSession();
    }

    // After abort, the increment must be gone and the insert must
    // never have landed.
    const after = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(after?.balance).toBe(100);
    const postCount = await setup.ctx.db
      .collection("posts")
      .countDocuments({ ownerID: "alice" });
    expect(postCount).toBe(0);
  });

  it("committed txn persists writes when { session } is threaded", async () => {
    await User.create({ username: "alice", balance: 100 });
    const sessionForTxn = setup.queryClient.startSession();
    sessionForTxn.startTransaction();
    try {
      await User.updateOne(
        { username: "alice" },
        { $inc: { balance: 50 } },
        { session: sessionForTxn },
      );
      await sessionForTxn.commitTransaction();
    } finally {
      await sessionForTxn.endSession();
    }
    const after = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(after?.balance).toBe(150);
  });

  it("findOne().session(s).lean() reads through the session", async () => {
    await User.create({ username: "alice", balance: 100 });
    const sessionForTxn = setup.queryClient.startSession();
    sessionForTxn.startTransaction();
    try {
      await User.updateOne(
        { username: "alice" },
        { $set: { balance: 999 } },
        { session: sessionForTxn },
      );
      const inside = await User.findOne({ username: "alice" })
        .session(sessionForTxn)
        .lean();
      expect(inside?.balance).toBe(999);
      await sessionForTxn.abortTransaction();
    } finally {
      await sessionForTxn.endSession();
    }
    const after = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(after?.balance).toBe(100);
  });

  it("countDocuments().session(s) participates in txn", async () => {
    const sessionForTxn = setup.queryClient.startSession();
    sessionForTxn.startTransaction();
    try {
      await User.create([{ username: "u1" }, { username: "u2" }], {
        session: sessionForTxn,
        ordered: true,
      });
      const n = await User.countDocuments({}).session(sessionForTxn);
      expect(n).toBe(2);
      await sessionForTxn.abortTransaction();
    } finally {
      await sessionForTxn.endSession();
    }
    const after = await setup.ctx.db.collection("users").countDocuments();
    expect(after).toBe(0);
  });
});
