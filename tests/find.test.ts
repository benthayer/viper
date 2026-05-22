// Covers every chain signature for `Model.find` in inventory-chains.md.
// Each `it` is one signature. Inline fixtures.

import { ObjectId } from "bson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model.find chains (${BACKEND})`, () => {
  let setup: TestSetup;
  let Post: any;
  let Article: any;
  let User: any;

  beforeEach(async () => {
    setup = await createTestSetup({
      Post: "posts",
      Article: "articles",
      User: "users",
    });
    Post = setup.getModel("Post");
    Article = setup.getModel("Article");
    User = setup.getModel("User");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("find(query)", async () => {
    await Post.create({ ownerID: "u1", views: 100 });
    await Post.create({ ownerID: "u1", views: 200 });
    await Post.create({ ownerID: "u2", views: 300 });
    const docs = await Post.find({ ownerID: "u1" });
    expect(docs).toHaveLength(2);
  });

  it("find().lean()", async () => {
    await Post.create({ ownerID: "u1", views: 100 });
    const docs = await Post.find({ ownerID: "u1" }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].ownerID).toBe("u1");
  });

  it("find().comment().lean()", async () => {
    await Post.create({ ownerID: "u1" });
    const docs = await Post.find({ ownerID: "u1" })
      .comment("getPostsByOwner")
      .lean();
    expect(docs).toHaveLength(1);
  });

  it("find().sort().lean()", async () => {
    await Post.create({ views: 200 });
    await Post.create({ views: 100 });
    await Post.create({ views: 300 });
    const docs = await Post.find({}).sort({ views: 1 }).lean();
    expect(docs.map((d: any) => d.views)).toEqual([100, 200, 300]);
  });

  it("find().sort().limit().lean() — sort + skip + limit", async () => {
    for (let i = 0; i < 10; i++) await Post.create({ idx: i });
    const docs = await Post.find({})
      .sort({ idx: 1 })
      .skip(3)
      .limit(2)
      .lean();
    expect(docs.map((d: any) => d.idx)).toEqual([3, 4]);
  });

  it("find().select(string).lean()", async () => {
    await User.create({ username: "alice", balance: 100, secret: "x" });
    const docs = await User.find({ username: "alice" })
      .select("username balance")
      .lean();
    expect(docs[0].username).toBe("alice");
    expect(docs[0].balance).toBe(100);
    expect(docs[0].secret).toBeUndefined();
  });

  it("find().select(object).lean()", async () => {
    await User.create({ username: "alice", balance: 100, secret: "x" });
    const docs = await User.find({ username: "alice" })
      .select({ username: 1, balance: 1 })
      .lean();
    expect(docs[0].username).toBe("alice");
    expect(docs[0].secret).toBeUndefined();
  });

  it("find().hint(string).lean()", async () => {
    await User.create({ username: "alice" });
    // No index named explicitly, but `_id_` always exists; use it as
    // a sentinel that the hint is being threaded.
    const docs = await User.find({}).hint("_id_").lean();
    expect(docs).toHaveLength(1);
  });

  it("find().hint().comment().lean()", async () => {
    await User.create({ username: "alice" });
    const docs = await User.find({})
      .hint("_id_")
      .comment("inv:findHintComment")
      .lean();
    expect(docs).toHaveLength(1);
  });

  it("find().comment().hint().lean() — same options, different order", async () => {
    await User.create({ username: "alice" });
    const docs = await User.find({})
      .comment("inv:findCommentHint")
      .hint("_id_")
      .lean();
    expect(docs).toHaveLength(1);
  });

  it("find().sort().hint().lean()", async () => {
    await User.create({ username: "a" });
    await User.create({ username: "b" });
    const docs = await User.find({})
      .sort({ _id: 1 })
      .hint("_id_")
      .lean();
    expect(docs).toHaveLength(2);
  });

  it("find().sort().skip().limit().lean() — no comment/hint/populate", async () => {
    for (let i = 0; i < 5; i++) await Post.create({ idx: i });
    const docs = await Post.find({})
      .sort({ idx: 1 })
      .skip(1)
      .limit(2)
      .lean();
    expect(docs.map((d: any) => d.idx)).toEqual([1, 2]);
  });

  it("find with $in filter (operator pass-through)", async () => {
    await Post.create({ ownerID: "u1" });
    await Post.create({ ownerID: "u2" });
    await Post.create({ ownerID: "u3" });
    const docs = await Post.find({ ownerID: { $in: ["u1", "u3"] } }).lean();
    expect(docs.map((d: any) => d.ownerID).sort()).toEqual(["u1", "u3"]);
  });

  it("find with $gte / $lt filter (operator pass-through)", async () => {
    await Post.create({ views: 100 });
    await Post.create({ views: 200 });
    await Post.create({ views: 300 });
    const docs = await Post.find({
      views: { $gte: 150, $lt: 300 },
    }).lean();
    expect(docs).toHaveLength(1);
    expect(docs[0].views).toBe(200);
  });

  it("find with $or filter (operator pass-through)", async () => {
    await Post.create({ ownerID: "u1" });
    await Post.create({ ownerID: "u2" });
    await Post.create({ ownerID: "u3" });
    const docs = await Post.find({
      $or: [{ ownerID: "u1" }, { ownerID: "u2" }],
    }).lean();
    expect(docs).toHaveLength(2);
  });

  it("find with ObjectId in filter", async () => {
    const oid = new ObjectId();
    await Post.create({ ownerID: oid });
    const docs = await Post.find({ ownerID: oid }).lean();
    expect(docs).toHaveLength(1);
  });

  it("find returns [] when nothing matches (no throw)", async () => {
    const docs = await Post.find({ ownerID: "nobody" }).lean();
    expect(docs).toEqual([]);
  });

  it("find() chain is thenable via .then", async () => {
    await User.create({ username: "alice" });
    const docs = await new Promise<any>((resolve, reject) => {
      User.find({}).lean().then(resolve, reject);
    });
    expect(docs).toHaveLength(1);
  });

  // Mongoose silently wraps a scalar passed to $in/$nin/$all in a
  // one-element array. The native driver rejects with "$nin needs an
  // array". We match Mongoose so existing call sites keep working.
  it("$nin with a scalar value is coerced to a single-element array", async () => {
    await Post.create({ ownerID: "u1", category: "blog" });
    await Post.create({ ownerID: "u2", category: "news" });
    const docs = await Post.find({ category: { $nin: "news" } });
    expect(docs).toHaveLength(1);
    expect(docs[0].ownerID).toBe("u1");
  });

  it("$in with a scalar value is coerced to a single-element array", async () => {
    await Post.create({ ownerID: "u1", category: "blog" });
    await Post.create({ ownerID: "u2", category: "news" });
    const docs = await Post.find({ category: { $in: "blog" } });
    expect(docs).toHaveLength(1);
    expect(docs[0].ownerID).toBe("u1");
  });
});
