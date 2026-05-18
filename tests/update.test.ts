// updateOne / updateMany / findOneAndUpdate / findByIdAndUpdate chains
// Verifies operator pass-through.

import { ObjectId } from "bson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model update chains (${BACKEND})`, () => {
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

  // --- updateOne ---

  it("updateOne(filter, update) — bare", async () => {
    await User.create({ username: "alice", balance: 0 });
    await User.updateOne(
      { username: "alice" },
      { $set: { balance: 50 } },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.balance).toBe(50);
  });

  it("updateOne($inc) — operator pass-through", async () => {
    await User.create({ username: "alice", balance: 10 });
    await User.updateOne(
      { username: "alice" },
      { $inc: { balance: 5 } },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.balance).toBe(15);
  });

  it("updateOne($inc with negative delta)", async () => {
    await User.create({ username: "alice", balance: 10 });
    await User.updateOne(
      { username: "alice" },
      { $inc: { balance: -3 } },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.balance).toBe(7);
  });

  it("updateOne($push)", async () => {
    await User.create({ username: "alice", tags: [] });
    await User.updateOne({ username: "alice" }, { $push: { tags: "vip" } });
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.tags).toEqual(["vip"]);
  });

  it("updateOne($pull)", async () => {
    await User.create({ username: "alice", tags: ["a", "b", "c"] });
    await User.updateOne({ username: "alice" }, { $pull: { tags: "b" } });
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.tags).toEqual(["a", "c"]);
  });

  it("updateOne with upsert", async () => {
    await User.updateOne(
      { username: "newuser" },
      { $set: { balance: 100 } },
      { upsert: true },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "newuser" });
    expect(doc?.balance).toBe(100);
  });

  it("updateOne with $setOnInsert + upsert", async () => {
    await User.updateOne(
      { username: "newuser" },
      {
        $set: { balance: 1 },
        $setOnInsert: { createdMarker: true },
      },
      { upsert: true },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "newuser" });
    expect(doc?.balance).toBe(1);
    expect(doc?.createdMarker).toBe(true);
  });

  it("updateOne().comment() — chain terminator", async () => {
    await User.create({ username: "alice", balance: 0 });
    await User.updateOne(
      { username: "alice" },
      { $set: { balance: 5 } },
    ).comment("inv:updateOneComment");
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.balance).toBe(5);
  });

  it("updateOne with { hint } option", async () => {
    await User.create({ username: "alice", balance: 0 });
    await User.updateOne(
      { _id: (await User.findOne({ username: "alice" }).lean())._id },
      { $set: { balance: 7 } },
      { hint: "_id_" },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.balance).toBe(7);
  });

  it("updateOne with $expr filter (operator pass-through)", async () => {
    await User.create({
      username: "alice",
      a: 100,
      b: 20,
      c: 10,
    });
    await User.updateOne(
      {
        username: "alice",
        $expr: {
          $gte: [
            {
              $add: [
                {
                  $subtract: [
                    { $ifNull: ["$a", 0] },
                    { $ifNull: ["$b", 0] },
                  ],
                },
                { $ifNull: ["$c", 0] },
              ],
            },
            0,
          ],
        },
      },
      { $inc: { b: -5 } },
    );
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ username: "alice" });
    expect(doc?.b).toBe(15);
  });

  // --- updateMany ---

  it("updateMany().comment()", async () => {
    await Post.create({ ownerID: "u1", cancelled: false });
    await Post.create({ ownerID: "u1", cancelled: false });
    await Post.create({ ownerID: "u2", cancelled: false });
    await Post.updateMany(
      { ownerID: "u1" },
      { $set: { cancelled: true } },
    ).comment("inv:updateManyComment");
    const docs = await setup.ctx.db
      .collection("posts")
      .find({ cancelled: true })
      .toArray();
    expect(docs).toHaveLength(2);
  });

  it("updateMany with $unset", async () => {
    await Post.create({ ownerID: "u1", flag: 1 });
    await Post.create({ ownerID: "u1", flag: 1 });
    await Post.updateMany({ ownerID: "u1" }, { $unset: { flag: true } });
    const docs = await setup.ctx.db
      .collection("posts")
      .find({ ownerID: "u1" })
      .toArray();
    for (const d of docs) expect(d.flag).toBeUndefined();
  });

  it("updateMany with $in filter", async () => {
    const ids: ObjectId[] = [];
    for (let i = 0; i < 3; i++) {
      const oid = new ObjectId();
      ids.push(oid);
      await Post.create({ _id: oid, cancelled: false });
    }
    await Post.updateMany(
      { _id: { $in: ids.slice(0, 2) } },
      { $set: { cancelled: true } },
    );
    const cancelled = await setup.ctx.db
      .collection("posts")
      .countDocuments({ cancelled: true });
    expect(cancelled).toBe(2);
  });

  // --- findOneAndUpdate ---

  it("findOneAndUpdate(filter, update, { new: true })", async () => {
    await Post.create({ ownerID: "u1", cancelled: false });
    const updated = await Post.findOneAndUpdate(
      { ownerID: "u1" },
      { $set: { cancelled: true } },
      { new: true },
    );
    expect(updated?.cancelled).toBe(true);
  });

  it("findOneAndUpdate with $push + options", async () => {
    await Post.create({ ownerID: "u1", history: [] });
    const updated = await Post.findOneAndUpdate(
      { ownerID: "u1" },
      { $push: { history: "a" } },
      { new: true },
    );
    expect(updated?.history).toEqual(["a"]);
  });

  it("findOneAndUpdate with upsert", async () => {
    const updated = await Post.findOneAndUpdate(
      { ownerID: "brand-new" },
      { $set: { cancelled: false } },
      { upsert: true, new: true },
    );
    expect(updated?.ownerID).toBe("brand-new");
  });

  it("findOneAndUpdate().comment()", async () => {
    await Post.create({ ownerID: "u1" });
    await Post.findOneAndUpdate(
      { ownerID: "u1" },
      { $set: { flag: true } },
      { upsert: true },
    ).comment("inv:findOneAndUpdateComment");
    const doc = await setup.ctx.db
      .collection("posts")
      .findOne({ ownerID: "u1" });
    expect(doc?.flag).toBe(true);
  });

  it("findOneAndUpdate().lean()", async () => {
    await Post.create({ ownerID: "u1", balance: 0 });
    const updated = await Post.findOneAndUpdate(
      { ownerID: "u1" },
      { $set: { balance: 100 } },
      { new: true },
    ).lean();
    expect(updated?.balance).toBe(100);
  });

  // --- findByIdAndUpdate ---

  it("findByIdAndUpdate(oid, update).select().lean()", async () => {
    const oid = new ObjectId();
    await User.create({
      _id: oid,
      username: "alice",
      closed: false,
      quota: 100,
    });
    const updated = await User.findByIdAndUpdate(oid, {
      closed: true,
      quota: 0,
    })
      .select({ _id: 1, username: 1 })
      .lean();
    // Default mongoose behavior is to return pre-update doc, so check
    // the persisted state instead of relying on return value shape.
    const doc = await setup.ctx.db
      .collection("users")
      .findOne({ _id: oid });
    expect(doc?.closed).toBe(true);
    expect(doc?.quota).toBe(0);
    // Selection should at least include _id + username if returned.
    if (updated) {
      expect(updated.username).toBe("alice");
    }
  });
});
