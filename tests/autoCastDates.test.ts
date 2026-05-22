// Gating semantics for the ISO/RFC 1123 → Date auto-cast.
//
// What's tested here:
//   - default behavior (cast is ON for Mongoose parity)
//   - constructor flag (`autoCastDates: true | false`)
//   - per-query chain methods (`.castDates()` / `.skipCastDates()`)
//   - conflict resolution policies (throw / firstWins / lastWins / defaultWins)
//   - CastDatesConflictError shape
//
// The actual cast logic (operators, $in arrays, nested $and/$or,
// $regex pass-through, etc.) is covered by castDates.test.ts. This
// file only cares about WHEN the cast runs, not WHAT it does.
//
// Fake-only — real mongoose's cast is driven by schema, not by this
// flag, so the gating doesn't apply there.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";
import { CastDatesConflictError } from "../src/CastDatesConflictError.js";

describe.skipIf(BACKEND === "real")(`autoCastDates gating (${BACKEND})`, () => {
  // ---- helpers ------------------------------------------------------

  // Seed a single Event document with a known `at` Date and return both
  // the Date object and its ISO string form.
  const seedEvent = async (
    Event: any,
  ): Promise<{ at: Date; iso: string }> => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    return { at, iso: at.toISOString() };
  };

  // ---- default: on (Mongoose parity) -------------------------------

  describe("default (no autoCastDates, no chain methods)", () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      setup = await createTestSetup({ Event: "events" });
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("ISO-string filter matches a Date stored value (default cast on)", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso }).lean();
      expect(found?.name).toBe("kickoff");
    });

    it("Date filter DOES match (sanity — driver behavior)", async () => {
      const { at } = await seedEvent(Event);
      const found = await Event.findOne({ at }).lean();
      expect(found?.name).toBe("kickoff");
    });
  });

  // ---- constructor flag --------------------------------------------

  describe("autoCastDates: true (constructor)", () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: true },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("ISO-string filter matches", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso }).lean();
      expect(found?.name).toBe("kickoff");
    });
  });

  describe("autoCastDates: false (constructor — explicit)", () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: false },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("ISO-string filter does NOT match (string ≠ Date in BSON)", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso }).lean();
      expect(found).toBeNull();
    });
  });

  // ---- per-query .castDates() --------------------------------------

  describe(".castDates() (force-on)", () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      // Constructor forced off so .castDates() has something to flip.
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: false },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("turns the cast on for that query only", async () => {
      const { iso } = await seedEvent(Event);
      const withCast = await Event.findOne({ at: iso }).castDates().lean();
      expect(withCast?.name).toBe("kickoff");

      // Next query (no .castDates()) still uses constructor setting = off.
      const withoutCast = await Event.findOne({ at: iso }).lean();
      expect(withoutCast).toBeNull();
    });

    it("calling .castDates() multiple times is not a conflict", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .castDates()
        .castDates()
        .lean();
      expect(found?.name).toBe("kickoff");
    });
  });

  // ---- per-query .skipCastDates() ----------------------------------

  describe(".skipCastDates() (force-off)", () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      // Constructor default: on. Per-query opt-out via .skipCastDates().
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: true },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("turns the cast off for that query only", async () => {
      const { iso } = await seedEvent(Event);
      const withoutCast = await Event.findOne({ at: iso })
        .skipCastDates()
        .lean();
      expect(withoutCast).toBeNull();

      // Next query (no override) still uses constructor default = on.
      const withCast = await Event.findOne({ at: iso }).lean();
      expect(withCast?.name).toBe("kickoff");
    });

    it("calling .skipCastDates() multiple times is not a conflict", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .skipCastDates()
        .skipCastDates()
        .lean();
      expect(found).toBeNull();
    });
  });

  // ---- conflict policies -------------------------------------------

  describe('castDatesConflictPolicy: "throw" (default)', () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: true /* policy omitted → default "throw" */ },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("throws CastDatesConflictError when both methods are called", async () => {
      const { iso } = await seedEvent(Event);
      await expect(
        Event.findOne({ at: iso }).castDates().skipCastDates().lean(),
      ).rejects.toBeInstanceOf(CastDatesConflictError);
    });

    it("throws at exec time, not chain time", async () => {
      // Building the chain itself must NOT throw — only exec does.
      const q = Event.findOne({ at: new Date().toISOString() })
        .castDates()
        .skipCastDates();
      // Reaching this line is the assertion. The next await throws.
      await expect(q.lean()).rejects.toBeInstanceOf(CastDatesConflictError);
    });

    it("error carries the call counts", async () => {
      const { iso } = await seedEvent(Event);
      try {
        await Event.findOne({ at: iso })
          .castDates()
          .castDates()
          .skipCastDates()
          .lean();
        expect.fail("should have thrown");
      } catch (e: any) {
        expect(CastDatesConflictError.is(e)).toBe(true);
        expect(e.castDatesCallCount).toBe(2);
        expect(e.skipCastDatesCallCount).toBe(1);
      }
    });
  });

  describe('castDatesConflictPolicy: "lastWins"', () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: false, castDatesConflictPolicy: "lastWins" },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("last .castDates() wins", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .skipCastDates()
        .castDates()
        .lean();
      expect(found?.name).toBe("kickoff");
    });

    it("last .skipCastDates() wins", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .castDates()
        .skipCastDates()
        .lean();
      expect(found).toBeNull();
    });
  });

  describe('castDatesConflictPolicy: "firstWins"', () => {
    let setup: TestSetup;
    let Event: any;

    beforeEach(async () => {
      setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: false, castDatesConflictPolicy: "firstWins" },
      );
      Event = setup.getModel("Event");
    });

    afterEach(() => setup.teardown());

    it("first .castDates() wins", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .castDates()
        .skipCastDates()
        .lean();
      expect(found?.name).toBe("kickoff");
    });

    it("first .skipCastDates() wins", async () => {
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .skipCastDates()
        .castDates()
        .lean();
      expect(found).toBeNull();
    });
  });

  describe('castDatesConflictPolicy: "defaultWins"', () => {
    it("falls back to autoCastDates: true on conflict", async () => {
      const setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: true, castDatesConflictPolicy: "defaultWins" },
      );
      const Event = setup.getModel("Event");
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .castDates()
        .skipCastDates()
        .lean();
      expect(found?.name).toBe("kickoff");
      await setup.teardown();
    });

    it("falls back to autoCastDates: false on conflict", async () => {
      const setup = await createTestSetup(
        { Event: "events" },
        { autoCastDates: false, castDatesConflictPolicy: "defaultWins" },
      );
      const Event = setup.getModel("Event");
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso })
        .castDates()
        .skipCastDates()
        .lean();
      expect(found).toBeNull();
      await setup.teardown();
    });
  });

  // ---- independence from castIds ----------------------------------

  describe("independence from castIds", () => {
    it("disabling autoCastIds does not disable autoCastDates", async () => {
      const setup = await createTestSetup(
        { Event: "events" },
        { autoCastIds: false, autoCastDates: true },
      );
      const Event = setup.getModel("Event");
      const { iso } = await seedEvent(Event);
      const found = await Event.findOne({ at: iso }).lean();
      expect(found?.name).toBe("kickoff");
      await setup.teardown();
    });

    it("disabling autoCastDates does not disable autoCastIds", async () => {
      const setup = await createTestSetup(
        { Event: "events" },
        { autoCastIds: true, autoCastDates: false },
      );
      const Event = setup.getModel("Event");
      // Seed by ObjectId, query with hex — should still match because
      // autoCastIds is independently on.
      const { ObjectId } = await import("bson");
      const oid = new ObjectId();
      await Event.create({ _id: oid, name: "kickoff" });
      const found = await Event.findOne({ _id: oid.toString() }).lean();
      expect(found?.name).toBe("kickoff");
      await setup.teardown();
    });
  });
});
