// 24-hex strings should be auto-cast to ObjectId in filter positions
// when the cast is enabled. The cast is ON by default (Mongoose
// parity) — see autoCastIds.test.ts for the gating semantics and
// SECURITY.md for the trade-offs. This file just tests the cast
// itself (operators, $in arrays, nested $and/$or, etc.) given
// that it's been enabled.
//
// Note: this is fake-only behavior. Real mongoose does an equivalent
// cast but only when a schema declares the field as ObjectId-typed.
// Our test harness builds schemas only from the populates map, so
// the "real" backend doesn't have type info for fields like
// `authorID` and would correctly fail these tests.

import { ObjectId } from "bson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe.skipIf(BACKEND === "real")(`hex-string → ObjectId auto-cast (${BACKEND})`, () => {
  let setup: TestSetup;
  let User: any;
  let Post: any;

  beforeEach(async () => {
    setup = await createTestSetup(
      { User: "users", Post: "posts" },
      { autoCastIds: true },
    );
    User = setup.getModel("User");
    Post = setup.getModel("Post");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("findOne by _id passes a hex string", async () => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    const doc = await User.findOne({ _id: oid.toString() }).lean();
    expect(doc?.username).toBe("alice");
  });

  it("find by ObjectId-typed field passes a hex string", async () => {
    const userOid = new ObjectId();
    const postOid = new ObjectId();
    await Post.create({
      _id: postOid,
      authorID: userOid,
      articleID: new ObjectId(),
      cancelled: false,
    });
    const docs = await Post.find({ authorID: userOid.toString() }).lean();
    expect(docs.length).toBe(1);
    expect(docs[0]._id.toString()).toBe(postOid.toString());
  });

  it("updateMany with hex-string filter actually updates", async () => {
    const userOid = new ObjectId();
    await Post.create({ authorID: userOid, cancelled: false });
    await Post.create({ authorID: userOid, cancelled: false });
    await Post.create({ authorID: new ObjectId(), cancelled: false });

    const res: any = await Post.updateMany(
      { authorID: userOid.toString(), cancelled: false },
      { $set: { cancelled: true } },
    );
    expect(res.matchedCount).toBe(2);
    expect(res.modifiedCount).toBe(2);
  });

  it("$in: [hexStrings] matches ObjectId values", async () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    await User.create({ _id: a, username: "a" });
    await User.create({ _id: b, username: "b" });
    await User.create({ _id: c, username: "c" });

    const docs = await User.find({
      _id: { $in: [a.toString(), b.toString()] },
    }).lean();
    expect(docs.map((d: any) => d.username).sort()).toEqual(["a", "b"]);
  });

  it("nested $and / $or with hex strings is cast", async () => {
    const userOid = new ObjectId();
    await Post.create({ authorID: userOid, cancelled: false });
    const docs = await Post.find({
      $and: [
        { authorID: userOid.toString() },
        { cancelled: false },
      ],
    }).lean();
    expect(docs.length).toBe(1);
  });

  it("aggregate $match stage is cast", async () => {
    const userOid = new ObjectId();
    await Post.create({ authorID: userOid, cancelled: false });
    const res = await Post.aggregate([
      { $match: { authorID: userOid.toString() } },
    ]);
    expect(res.length).toBe(1);
  });

  it("non-hex strings are left alone", async () => {
    await User.create({ username: "not-a-hex-just-a-name" });
    const doc = await User.findOne({ username: "not-a-hex-just-a-name" }).lean();
    expect(doc?.username).toBe("not-a-hex-just-a-name");
  });

  it("strings that happen to be 23 or 25 chars are NOT cast", async () => {
    // 23-char hex: not an ObjectId, must pass through
    await User.create({ token: "a".repeat(23) });
    const doc = await User.findOne({ token: "a".repeat(23) }).lean();
    expect(doc?.token).toBe("a".repeat(23));
  });

  it("$regex value is not cast even if it'd match the hex pattern", async () => {
    // ObjectId strings happen to be valid regex; mongoose treats $regex
    // value as a string/regex, never as a ref. We do the same.
    await User.create({ username: "abc123" });
    const doc = await User.findOne({
      username: { $regex: "^abc" },
    }).lean();
    expect(doc?.username).toBe("abc123");
  });

  it("updates are not cast (user-controlled write shape)", async () => {
    // The string in $set is a value the user is explicitly writing —
    // we shouldn't second-guess and coerce it. If they want an ObjectId,
    // they pass one.
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    const hexVal = new ObjectId().toString();
    await User.updateOne({ _id: oid }, { $set: { customField: hexVal } });
    const after = await User.findOne({ _id: oid }).lean();
    // Real mongoose without a schema for customField would also leave
    // the string as-is. Critical: it remains a string, not coerced.
    expect(typeof after?.customField).toBe("string");
    expect(after?.customField).toBe(hexVal);
  });
});
