// Unit tests for the addIdVirtual helper. Fake-only: there's no
// equivalent Mongoose surface to compare against, but the behavior
// is meant to match Mongoose's `.id` virtual exactly.
import { ObjectId } from "bson";
import { describe, expect, it } from "vitest";
import { addIdVirtual } from "../src/Query.js";
import { BACKEND } from "./lib/getModel.js";

const describeFn = BACKEND === "real" ? describe.skip : describe;

describeFn("addIdVirtual", () => {
  it("returns the stringified _id when _id is an ObjectId", () => {
    const oid = new ObjectId();
    const doc: any = { _id: oid, name: "alice" };
    addIdVirtual(doc);
    expect(doc.id).toBe(oid.toString());
  });

  it("returns null when _id is null (mongoose parity)", () => {
    const doc: any = { _id: null, name: "alice" };
    addIdVirtual(doc);
    expect(doc.id).toBeNull();
  });

  it("returns null when _id is undefined (mongoose parity)", () => {
    const doc: any = { name: "alice" };
    addIdVirtual(doc);
    expect(doc.id).toBeNull();
  });

  it("`.id` is non-enumerable", () => {
    const oid = new ObjectId();
    const doc: any = { _id: oid };
    addIdVirtual(doc);
    expect(Object.keys(doc)).not.toContain("id");
    expect("id" in { ...doc }).toBe(false);
    expect(JSON.parse(JSON.stringify(doc)).id).toBeUndefined();
  });

  it("is idempotent — second call doesn't overwrite an existing `id`", () => {
    const doc: any = { _id: new ObjectId(), id: "manually-set" };
    addIdVirtual(doc);
    expect(doc.id).toBe("manually-set");
  });

  it("noops on non-objects", () => {
    // Just shouldn't throw.
    expect(() => addIdVirtual(null)).not.toThrow();
    expect(() => addIdVirtual(undefined)).not.toThrow();
    expect(() => addIdVirtual(42)).not.toThrow();
    expect(() => addIdVirtual("string")).not.toThrow();
  });
});
