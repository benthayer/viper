// ISO 8601 / RFC 1123 strings should be auto-cast to Date in filter
// positions when the cast is enabled. The cast is ON by default
// (Mongoose parity) — see autoCastDates.test.ts for the gating
// semantics. This file just tests the cast itself (operators, $in
// arrays, nested $and/$or, $regex pass-through, the exact regex shape
// surface, etc.) given that it's been enabled.
//
// Note: this is fake-only behavior. Real mongoose does an equivalent
// cast but only when a schema declares the field as Date-typed. Our
// test harness builds schemas with strict:false and no Date fields,
// so the "real" backend doesn't have type info for fields like `at`
// and would correctly fail these tests.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe.skipIf(BACKEND === "real")(`date-string → Date auto-cast (${BACKEND})`, () => {
  let setup: TestSetup;
  let Event: any;

  beforeEach(async () => {
    setup = await createTestSetup(
      { Event: "events" },
      { autoCastDates: true },
    );
    Event = setup.getModel("Event");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  // ---- shape coverage: ISO 8601 ---------------------------------------

  it("findOne by Date-typed field passes a toISOString()", async () => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    const found = await Event.findOne({ at: at.toISOString() }).lean();
    expect(found?.name).toBe("kickoff");
  });

  it("ISO 8601 with no millis is cast", async () => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    const found = await Event.findOne({ at: "2026-05-22T14:00:00Z" }).lean();
    expect(found?.name).toBe("kickoff");
  });

  it("ISO 8601 with explicit offset is cast", async () => {
    // 2026-05-22T09:00:00-05:00 == 2026-05-22T14:00:00.000Z
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    const found = await Event.findOne({
      at: "2026-05-22T09:00:00-05:00",
    }).lean();
    expect(found?.name).toBe("kickoff");
  });

  // ---- shape coverage: RFC 1123 ---------------------------------------

  it("findOne by Date-typed field passes a toUTCString()", async () => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    const found = await Event.findOne({ at: at.toUTCString() }).lean();
    expect(found?.name).toBe("kickoff");
  });

  // ---- range queries ($gt / $lte / etc.) ------------------------------

  it("$gt + $lte with toUTCString() strings — the original Zack bug", async () => {
    // The exact pattern that was silently returning empty in
    // core-api Transaction.getTransactionsBetweenTwoDates.
    const start = new Date("2026-05-21T12:00:00.000Z");
    const end = new Date("2026-05-22T12:00:00.000Z");
    await Event.create({ at: new Date("2026-05-22T00:15:00.000Z"), name: "in-window" });
    await Event.create({ at: new Date("2026-05-20T00:15:00.000Z"), name: "before" });
    await Event.create({ at: new Date("2026-05-23T00:15:00.000Z"), name: "after" });
    const docs = await Event.find({
      at: { $gt: start.toUTCString(), $lte: end.toUTCString() },
    }).lean();
    expect(docs.map((d: any) => d.name)).toEqual(["in-window"]);
  });

  it("$gte / $lt with toISOString() strings", async () => {
    const start = new Date("2026-05-21T00:00:00.000Z");
    const end = new Date("2026-05-22T00:00:00.000Z");
    await Event.create({ at: start, name: "edge-low" });
    await Event.create({ at: end, name: "edge-high" });
    const docs = await Event.find({
      at: { $gte: start.toISOString(), $lt: end.toISOString() },
    }).lean();
    expect(docs.map((d: any) => d.name)).toEqual(["edge-low"]);
  });

  // ---- $in --------------------------------------------------------------

  it("$in: [isoStrings] matches Date values", async () => {
    const a = new Date("2026-01-01T00:00:00.000Z");
    const b = new Date("2026-02-01T00:00:00.000Z");
    const c = new Date("2026-03-01T00:00:00.000Z");
    await Event.create({ at: a, name: "a" });
    await Event.create({ at: b, name: "b" });
    await Event.create({ at: c, name: "c" });

    const docs = await Event.find({
      at: { $in: [a.toISOString(), b.toISOString()] },
    }).lean();
    expect(docs.map((d: any) => d.name).sort()).toEqual(["a", "b"]);
  });

  // ---- nested $and / $or -----------------------------------------------

  it("nested $and / $or with date strings is cast", async () => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff", live: true });
    const docs = await Event.find({
      $and: [{ at: at.toISOString() }, { live: true }],
    }).lean();
    expect(docs.length).toBe(1);
  });

  // ---- aggregate $match ------------------------------------------------

  it("aggregate $match stage is cast", async () => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    const res = await Event.aggregate([
      { $match: { at: at.toISOString() } },
    ]);
    expect(res.length).toBe(1);
  });

  // ---- non-matches -----------------------------------------------------

  it("non-date strings are left alone", async () => {
    await Event.create({ name: "not-a-date" });
    const found = await Event.findOne({ name: "not-a-date" }).lean();
    expect(found?.name).toBe("not-a-date");
  });

  it("bare year / date-only / number-as-string are NOT cast", async () => {
    // These look date-ish but aren't structurally unambiguous, so they
    // pass through as raw strings. Insertion stays a string; query
    // matches by raw equality.
    await Event.create({ token: "2026" });
    await Event.create({ token: "2026-05-22" });
    await Event.create({ token: "5" });
    const a = await Event.findOne({ token: "2026" }).lean();
    const b = await Event.findOne({ token: "2026-05-22" }).lean();
    const c = await Event.findOne({ token: "5" }).lean();
    expect(a?.token).toBe("2026");
    expect(b?.token).toBe("2026-05-22");
    expect(c?.token).toBe("5");
  });

  it("Date.toString() (locale form) is NOT cast", async () => {
    // "Fri May 22 2026 14:00:00 GMT+0000" — toString output, not RFC
    // 1123. No comma after the day, no " GMT" suffix at the end.
    // We do NOT cast this — it would be ambiguous against locale strings.
    const looksDateish = "Fri May 22 2026 14:00:00 GMT+0000 (UTC)";
    await Event.create({ token: looksDateish });
    const found = await Event.findOne({ token: looksDateish }).lean();
    expect(typeof found?.token).toBe("string");
    expect(found?.token).toBe(looksDateish);
  });

  it("epoch milliseconds as a string are NOT cast", async () => {
    const epochStr = "1747921680000";
    await Event.create({ token: epochStr });
    const found = await Event.findOne({ token: epochStr }).lean();
    expect(typeof found?.token).toBe("string");
    expect(found?.token).toBe(epochStr);
  });

  // ---- operator pass-through -------------------------------------------

  it("$regex value is not cast even if it'd match the date pattern", async () => {
    // A regex source happening to match the ISO 8601 pattern shouldn't
    // be coerced — $regex's value is a regex/string by definition.
    await Event.create({ name: "2026-05-22T14:00:00.000Z" });
    const found = await Event.findOne({
      name: { $regex: "^2026-05-22T14:00:00\\.000Z$" },
    }).lean();
    expect(found?.name).toBe("2026-05-22T14:00:00.000Z");
  });

  // ---- updates are not cast --------------------------------------------

  it("updates are not cast (user-controlled write shape)", async () => {
    // A string in $set is a value the user is explicitly writing. We
    // shouldn't second-guess and coerce it. If they want a Date, they
    // pass one.
    await Event.create({ name: "kickoff" });
    const dateStr = "2026-05-22T14:00:00.000Z";
    await Event.updateOne(
      { name: "kickoff" },
      { $set: { customField: dateStr } },
    );
    const after = await Event.findOne({ name: "kickoff" }).lean();
    expect(typeof after?.customField).toBe("string");
    expect(after?.customField).toBe(dateStr);
  });

  // ---- already-Date passes through -------------------------------------

  it("already-Date filter values are untouched", async () => {
    const at = new Date("2026-05-22T14:00:00.000Z");
    await Event.create({ at, name: "kickoff" });
    const found = await Event.findOne({ at }).lean();
    expect(found?.name).toBe("kickoff");
  });
});
