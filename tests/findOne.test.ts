import { ObjectId } from "bson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model.findOne / findById chains (${BACKEND})`, () => {
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

  it("findOne(query).lean()", async () => {
    await User.create({ username: "alice", balance: 1 });
    const doc = await User.findOne({ username: "alice" }).lean();
    expect(doc?.username).toBe("alice");
  });

  it("findOne returns null when not found (no throw)", async () => {
    const doc = await User.findOne({ username: "nobody" }).lean();
    expect(doc).toBeNull();
  });

  it("findOne().comment().lean()", async () => {
    await User.create({ username: "alice" });
    const doc = await User.findOne({ username: "alice" })
      .comment("inv:findOneCommentLean")
      .lean();
    expect(doc?.username).toBe("alice");
  });

  it("findOne().select(string).lean()", async () => {
    await User.create({ username: "alice", secret: "x", balance: 5 });
    const doc = await User.findOne({ username: "alice" })
      .select("username balance")
      .lean();
    expect(doc?.username).toBe("alice");
    expect(doc?.balance).toBe(5);
    expect(doc?.secret).toBeUndefined();
  });

  it("findOne().select(array).lean()", async () => {
    await User.create({ username: "alice", balance: 5, secret: "x" });
    const doc = await User.findOne({ username: "alice" })
      .select(["username", "balance"])
      .lean();
    expect(doc?.username).toBe("alice");
    expect(doc?.secret).toBeUndefined();
  });

  it("findOne().select(object).lean()", async () => {
    await User.create({ username: "alice", balance: 5, secret: "x" });
    const doc = await User.findOne({ username: "alice" })
      .select({ username: 1, balance: 1 })
      .lean();
    expect(doc?.username).toBe("alice");
    expect(doc?.secret).toBeUndefined();
  });

  it("findOne().sort().lean()", async () => {
    await User.create({ tier: 1 });
    await User.create({ tier: 3 });
    await User.create({ tier: 2 });
    const doc = await User.findOne({}).sort({ tier: -1 }).lean();
    expect(doc?.tier).toBe(3);
  });

  it("findOne().comment().hint().lean()", async () => {
    await User.create({ username: "alice" });
    const doc = await User.findOne({ username: "alice" })
      .comment("inv:findOneCommentHint")
      .hint("_id_")
      .lean();
    expect(doc?.username).toBe("alice");
  });

  it("findOne().or().comment().lean()", async () => {
    await User.create({ username: "alice", email: "a@x" });
    await User.create({ username: "bob", email: "b@x" });
    const doc = await User.findOne()
      .or([{ username: "bob" }, { email: "bob@x" }])
      .comment("inv:findOneOr")
      .lean();
    expect(doc?.username).toBe("bob");
  });

  it("findById(oid).lean()", async () => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    const doc = await User.findById(oid).lean();
    expect(doc?.username).toBe("alice");
  });

  it("findById(oid).select(object).lean()", async () => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice", secret: "x" });
    const doc = await User.findById(oid).select({ username: 1 }).lean();
    expect(doc?.username).toBe("alice");
    expect(doc?.secret).toBeUndefined();
  });

  it("findById returns null when not found", async () => {
    const doc = await User.findById(new ObjectId()).lean();
    expect(doc).toBeNull();
  });

  it("non-lean doc exposes `.id` as the stringified _id", async () => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    const doc = await User.findById(oid);
    expect(doc?._id?.toString()).toBe(oid.toString());
    // The whole point: call sites like ctx.state.user.id need this to
    // be the string form of _id without thinking about it.
    expect(doc?.id).toBe(oid.toString());
  });

  it("lean doc does NOT expose `.id` (matches mongoose lean behavior)", async () => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    const doc = await User.findById(oid).lean();
    expect(doc?._id?.toString()).toBe(oid.toString());
    expect(doc?.id).toBeUndefined();
  });

  it("non-lean find() returns docs that each have `.id`", async () => {
    await User.create([
      { username: "a" },
      { username: "b" },
    ]);
    const docs = await User.find();
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(typeof d.id).toBe("string");
      expect(d.id).toBe(d._id.toString());
    }
  });

  it("`.id` is non-enumerable so JSON / spread don't see it", async () => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    const doc = await User.findById(oid);
    expect(Object.keys(doc!)).not.toContain("id");
    const spread = { ...doc };
    expect("id" in spread).toBe(false);
    const json = JSON.parse(JSON.stringify(doc));
    expect(json.id).toBeUndefined();
  });

});
