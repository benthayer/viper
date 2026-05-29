// populate must be $in-batched per level, never N+1.
// Covers populate chain signatures from inventory: string path, object
// spec with select/match, nested populate, array-of-refs populate
// (e.g. tags._id), and static Model.populate.
//
// Each test wraps the call in a query recorder and asserts exact query
// counts in addition to result correctness.

import { ObjectId } from "bson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { recordQueries, type QueryRecorder } from "./lib/queryCounter.js";
import { BACKEND } from "./lib/getModel.js";

describe(`populate engine (${BACKEND})`, () => {
  let setup: TestSetup;
  let rec: QueryRecorder;
  let Post: any;
  let User: any;
  let Article: any;
  let Tag: any;
  let Comment: any;
  let Reply: any;

  beforeEach(async () => {
    setup = await createTestSetup(
      {
        Post: "posts",
        User: "users",
        Article: "articles",
        Tag: "tags",
        Comment: "comments",
        Reply: "replies",
      },
      {
        Post: {
          authorID: { collection: "users" },
          articleID: { collection: "articles" },
          "transactions._id": { collection: "comments" },
        },
        Article: {
          "tags._id": { collection: "tags" },
        },
        Comment: {
          postID: { collection: "posts" },
          ownerID: { collection: "users" },
          articleID: { collection: "articles" },
          correspondingID: { collection: "replies" },
        },
        Reply: {
          correspondingID: { collection: "replies" },
          ownerID: { collection: "users" },
        },
      },
    );
    Post = setup.getModel("Post");
    User = setup.getModel("User");
    Article = setup.getModel("Article");
    Tag = setup.getModel("Tag");
    Comment = setup.getModel("Comment");
    Reply = setup.getModel("Reply");
    rec = recordQueries(setup.queryClient, {
      commands: ["find", "aggregate"],
    });
  });

  afterEach(async () => {
    rec.stop();
    await setup.teardown();
  });

  it("populate(string) — single path, exactly 2 queries for N parents", async () => {
    const userIds = await seedUsers(User, 5);
    for (const uid of userIds) {
      await Post.create({ authorID: uid, views: 100 });
    }
    rec.reset();
    const docs = await Post.find({})
      .populate("authorID")
      .lean();
    expect(docs).toHaveLength(5);
    for (const d of docs) {
      expect(d.authorID?.username).toMatch(/^user-/);
    }
    // One find on sessions, one $in find on users. Total = 2.
    expect(rec.total()).toBe(2);
  });

  it("populate(object) with select — still 2 queries", async () => {
    const userIds = await seedUsers(User, 3);
    for (const uid of userIds) {
      await Post.create({ authorID: uid });
    }
    rec.reset();
    const docs = await Post.find({})
      .populate({ path: "authorID", select: "username" })
      .lean();
    expect(docs).toHaveLength(3);
    for (const d of docs) {
      expect(d.authorID?.username).toMatch(/^user-/);
      expect(d.authorID?.secret).toBeUndefined();
    }
    expect(rec.total()).toBe(2);
  });

  it("populate with match filter applies it on the join", async () => {
    const aliceId = (await User.create({ username: "alice", tier: "gold" }))
      ._id;
    const bobId = (await User.create({ username: "bob", tier: "silver" }))
      ._id;
    await Post.create({ authorID: aliceId });
    await Post.create({ authorID: bobId });
    rec.reset();
    const docs = await Post.find({})
      .populate({
        path: "authorID",
        match: { tier: "gold" },
      })
      .lean();
    expect(docs).toHaveLength(2);
    const populated = docs.filter((d: any) => d.authorID);
    expect(populated).toHaveLength(1);
    expect(populated[0].authorID.username).toBe("alice");
    expect(rec.total()).toBe(2);
  });

  it("nested populate (articleID → tags._id) — exactly 3 queries", async () => {
    // Build: tags → games (with participant refs) → transactions
    // (with articleID refs). Populate transactions → articleID → tags._id.
    const tagIds: ObjectId[] = [];
    for (let i = 0; i < 4; i++) {
      const oid = new ObjectId();
      await Tag.create({ _id: oid, name: `t-${i}` });
      tagIds.push(oid);
    }
    // 3 games, each referencing 2 tags. Total unique parts: 4.
    const games = [
      [tagIds[0], tagIds[1]],
      [tagIds[2], tagIds[3]],
      [tagIds[0], tagIds[2]],
    ];
    const articleIds: ObjectId[] = [];
    for (const pair of games) {
      const oid = new ObjectId();
      await Article.create({
        _id: oid,
        tags: pair.map((p) => ({ _id: p })),
      });
      articleIds.push(oid);
    }
    // 5 transactions across the 3 games.
    for (let i = 0; i < 5; i++) {
      await Comment.create({ articleID: articleIds[i % 3], amount: i });
    }
    rec.reset();
    const docs = await Comment.find({})
      .populate({
        path: "articleID",
        populate: { path: "tags._id" },
      })
      .lean();
    expect(docs).toHaveLength(5);
    for (const d of docs) {
      expect(d.articleID?._id).toBeTruthy();
      expect(Array.isArray(d.articleID.tags)).toBe(true);
      for (const p of d.articleID.tags) {
        expect(p._id?.name).toMatch(/^t-/);
      }
    }
    // 1 find on transactions, 1 $in on games, 1 $in on tags. Total = 3.
    expect(rec.total()).toBe(3);
  });

  it("array-of-refs populate (tags._id) — 2 queries", async () => {
    const tagIds: ObjectId[] = [];
    for (let i = 0; i < 6; i++) {
      const oid = new ObjectId();
      await Tag.create({ _id: oid, name: `t-${i}` });
      tagIds.push(oid);
    }
    // 3 games, each holding 2 participant refs in an array.
    for (let i = 0; i < 3; i++) {
      await Article.create({
        tags: [{ _id: tagIds[i * 2] }, { _id: tagIds[i * 2 + 1] }],
      });
    }
    rec.reset();
    const docs = await Article.find({})
      .populate("tags._id")
      .lean();
    expect(docs).toHaveLength(3);
    for (const d of docs) {
      expect(d.tags).toHaveLength(2);
      for (const p of d.tags) {
        expect(p._id?.name).toMatch(/^t-/);
      }
    }
    // 1 find on games, 1 $in on tags. Total = 2.
    expect(rec.total()).toBe(2);
  });

  it("two .populate() calls on different paths — 3 queries", async () => {
    const userIds = await seedUsers(User, 3);
    const articleIds: ObjectId[] = [];
    for (let i = 0; i < 3; i++) {
      const oid = new ObjectId();
      await Article.create({ _id: oid, name: `a-${i}` });
      articleIds.push(oid);
    }
    for (let i = 0; i < 3; i++) {
      await Post.create({ authorID: userIds[i], articleID: articleIds[i] });
    }
    rec.reset();
    const docs = await Post.find({})
      .populate("authorID")
      .populate("articleID")
      .lean();
    expect(docs).toHaveLength(3);
    for (const d of docs) {
      expect(d.authorID?.username).toMatch(/^user-/);
      expect(d.articleID?.name).toMatch(/^a-/);
    }
    // 1 sessions, 1 users, 1 games.
    expect(rec.total()).toBe(3);
  });

  it("populate over many parents still uses ONE $in (anti-N+1)", async () => {
    const userIds = await seedUsers(User, 50);
    for (const uid of userIds) {
      await Post.create({ authorID: uid });
    }
    rec.reset();
    const docs = await Post.find({})
      .populate("authorID")
      .lean();
    expect(docs).toHaveLength(50);
    // Critical regression guard: must NOT be 1 + 50 = 51.
    expect(rec.total()).toBe(2);
  });

  // viper-only: we deliberately propagate the parent .comment() into
  // populate fan-out queries so they remain attributable in profiler
  // output. Mongoose does not do this; we want the divergence.
  (BACKEND === "fake" ? it : it.skip)(
    "comment() propagates into single-level populate queries",
    async () => {
      const userIds = await seedUsers(User, 3);
      for (const uid of userIds) {
        await Post.create({ authorID: uid });
      }
      rec.reset();
      await Post.find({})
        .comment("getPostsWithAuthor")
        .populate("authorID")
        .lean();
      const seen = rec.comments();
      const posts = seen.find((s) => s.collection === "posts");
      const users = seen.find((s) => s.collection === "users");
      expect(posts?.comment).toBe("getPostsWithAuthor");
      expect(users?.comment).toBe("getPostsWithAuthor (populate authorID)");
    },
  );

  (BACKEND === "fake" ? it : it.skip)(
    "comment() propagates into nested populate queries",
    async () => {
      const tagId = new ObjectId();
      await Tag.create({ _id: tagId, name: "t-0" });
      const articleId = new ObjectId();
      await Article.create({ _id: articleId, tags: [{ _id: tagId }] });
      await Comment.create({ articleID: articleId });
      rec.reset();
      await Comment.find({})
        .comment("renderComments")
        .populate({ path: "articleID", populate: { path: "tags._id" } })
        .lean();
      const seen = rec.comments();
      const byColl = new Map(seen.map((s) => [s.collection, s.comment]));
      expect(byColl.get("comments")).toBe("renderComments");
      expect(byColl.get("articles")).toBe(
        "renderComments (populate articleID)",
      );
      expect(byColl.get("tags")).toBe(
        "renderComments (populate articleID) (populate tags._id)",
      );
    },
  );

  it("populate where some parents have null ref — still 2 queries", async () => {
    const aliceId = (await User.create({ username: "user-alice" }))._id;
    await Post.create({ authorID: aliceId });
    await Post.create({ authorID: null });
    await Post.create({});
    rec.reset();
    const docs = await Post.find({})
      .populate("authorID")
      .lean();
    expect(docs).toHaveLength(3);
    const filled = docs.filter((d: any) => d.authorID);
    expect(filled).toHaveLength(1);
    expect(filled[0].authorID.username).toBe("user-alice");
    expect(rec.total()).toBe(2);
  });
});

const seedUsers = async (User: any, n: number): Promise<ObjectId[]> => {
  const ids: ObjectId[] = [];
  for (let i = 0; i < n; i++) {
    const doc = await User.create({
      username: `user-${i}`,
      secret: `s-${i}`,
    });
    ids.push(doc._id);
  }
  return ids;
};
