// Gating semantics for the 24-hex → ObjectId auto-cast.
//
// What's tested here:
//   - default behavior (cast is ON for Mongoose parity)
//   - constructor flag (`autoCastIds: true | false`)
//   - per-query chain methods (`.castIds()` / `.skipCastIds()`)
//   - conflict resolution policies (throw / firstWins / lastWins / defaultWins)
//   - CastIdsConflictError shape
//
// The actual cast logic (operators, $in arrays, nested $and/$or,
// $regex pass-through, etc.) is covered by castFilter.test.ts. This
// file only cares about WHEN the cast runs, not WHAT it does.
//
// Fake-only — real mongoose's cast is driven by schema, not by this
// flag, so the gating doesn't apply there.

import { ObjectId } from "bson";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";
import { CastIdsConflictError } from "../src/CastIdsConflictError.js";

describe.skipIf(BACKEND === "real")(`autoCastIds gating (${BACKEND})`, () => {
  // ---- helpers ------------------------------------------------------

  // Seed a single User keyed by ObjectId and return both forms.
  const seedUser = async (
    User: any,
  ): Promise<{ oid: ObjectId; hex: string }> => {
    const oid = new ObjectId();
    await User.create({ _id: oid, username: "alice" });
    return { oid, hex: oid.toString() };
  };

  // ---- default: on (Mongoose parity) -------------------------------

  describe("default (no autoCastIds, no chain methods)", () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      setup = await createTestSetup({ User: "users" });
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("hex-string filter matches an ObjectId stored value (default cast on)", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex }).lean();
      expect(found?.username).toBe("alice");
    });

    it("ObjectId filter DOES match (sanity — driver behavior)", async () => {
      const { oid } = await seedUser(User);
      const found = await User.findOne({ _id: oid }).lean();
      expect(found?.username).toBe("alice");
    });
  });

  // ---- constructor flag --------------------------------------------

  describe("autoCastIds: true (constructor)", () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: true },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("hex-string filter matches", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex }).lean();
      expect(found?.username).toBe("alice");
    });
  });

  describe("autoCastIds: false (constructor — explicit)", () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: false },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("hex-string filter does NOT match (same as default)", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex }).lean();
      expect(found).toBeNull();
    });
  });

  // ---- per-query .castIds() ----------------------------------------

  describe(".castIds() (force-on)", () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      // Constructor forced off so .castIds() has something to flip.
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: false },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("turns the cast on for that query only", async () => {
      const { hex } = await seedUser(User);
      const withCast = await User.findOne({ _id: hex }).castIds().lean();
      expect(withCast?.username).toBe("alice");

      // Next query (no .castIds()) still uses constructor setting = off.
      const withoutCast = await User.findOne({ _id: hex }).lean();
      expect(withoutCast).toBeNull();
    });

    it("calling .castIds() multiple times is not a conflict", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .castIds()
        .castIds()
        .lean();
      expect(found?.username).toBe("alice");
    });
  });

  // ---- per-query .skipCastIds() ------------------------------------

  describe(".skipCastIds() (force-off)", () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      // Constructor default: on. Per-query opt-out via .skipCastIds().
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: true },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("turns the cast off for that query only", async () => {
      const { hex } = await seedUser(User);
      const withoutCast = await User.findOne({ _id: hex })
        .skipCastIds()
        .lean();
      expect(withoutCast).toBeNull();

      // Next query (no override) still uses constructor default = on.
      const withCast = await User.findOne({ _id: hex }).lean();
      expect(withCast?.username).toBe("alice");
    });

    it("calling .skipCastIds() multiple times is not a conflict", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .skipCastIds()
        .skipCastIds()
        .lean();
      expect(found).toBeNull();
    });
  });

  // ---- conflict policies -------------------------------------------

  describe('castIdsConflictPolicy: "throw" (default)', () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: true /* policy omitted → default "throw" */ },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("throws CastIdsConflictError when both methods are called", async () => {
      const { hex } = await seedUser(User);
      await expect(
        User.findOne({ _id: hex }).castIds().skipCastIds().lean(),
      ).rejects.toBeInstanceOf(CastIdsConflictError);
    });

    it("throws at exec time, not chain time", async () => {
      // Building the chain itself must NOT throw — only exec does.
      // Lets callers conditionally chain without explosions.
      const q = User.findOne({ _id: new ObjectId().toString() })
        .castIds()
        .skipCastIds();
      // Reaching this line is the assertion. The next await throws.
      await expect(q.lean()).rejects.toBeInstanceOf(CastIdsConflictError);
    });

    it("error carries the call counts", async () => {
      const { hex } = await seedUser(User);
      try {
        await User.findOne({ _id: hex })
          .castIds()
          .castIds()
          .skipCastIds()
          .lean();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(CastIdsConflictError.is(e)).toBe(true);
        expect(e.castIdsCallCount).toBe(2);
        expect(e.skipCastIdsCallCount).toBe(1);
      }
    });
  });

  describe('castIdsConflictPolicy: "lastWins"', () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: false, castIdsConflictPolicy: "lastWins" },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("last .castIds() wins", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .skipCastIds()
        .castIds()
        .lean();
      expect(found?.username).toBe("alice");
    });

    it("last .skipCastIds() wins", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .castIds()
        .skipCastIds()
        .lean();
      expect(found).toBeNull();
    });
  });

  describe('castIdsConflictPolicy: "firstWins"', () => {
    let setup: TestSetup;
    let User: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: false, castIdsConflictPolicy: "firstWins" },
      );
      User = setup.getModel("User");
    });

    afterEach(() => setup.teardown());

    it("first .castIds() wins", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .castIds()
        .skipCastIds()
        .lean();
      expect(found?.username).toBe("alice");
    });

    it("first .skipCastIds() wins", async () => {
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .skipCastIds()
        .castIds()
        .lean();
      expect(found).toBeNull();
    });
  });

  describe('castIdsConflictPolicy: "defaultWins"', () => {
    it("falls back to autoCastIds: true on conflict", async () => {
      const setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: true, castIdsConflictPolicy: "defaultWins" },
      );
      const User = setup.getModel("User");
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .castIds()
        .skipCastIds()
        .lean();
      expect(found?.username).toBe("alice");
      await setup.teardown();
    });

    it("falls back to autoCastIds: false on conflict", async () => {
      const setup = await createTestSetup(
        { User: "users" },
        { autoCastIds: false, castIdsConflictPolicy: "defaultWins" },
      );
      const User = setup.getModel("User");
      const { hex } = await seedUser(User);
      const found = await User.findOne({ _id: hex })
        .castIds()
        .skipCastIds()
        .lean();
      expect(found).toBeNull();
      await setup.teardown();
    });
  });
});
