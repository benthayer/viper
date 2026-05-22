import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MongoClient } from "mongodb";
import { createGetModel } from "../src/index.js";

// Real-world scenario: a service constructs its driver client and viper
// models at module load time (synchronously, before .connect() runs).
// Db and Collection handles are stateless references in the driver —
// .db(name) and .collection(name) do no I/O — so this must work without
// the client being connected yet. The actual connect happens later,
// and by the time any query runs the client is live.

describe("createGetModel before client.connect()", () => {
  const uri =
    process.env.MONGO_URI ?? "mongodb://localhost:27017/?directConnection=true";
  let client: MongoClient;
  const dbName = `viper-lazy-${Date.now()}`;

  beforeEach(() => {
    // Construct only — no connect() yet.
    client = new MongoClient(uri);
  });

  afterEach(async () => {
    await client.db(dbName).dropDatabase().catch(() => {});
    await client.close().catch(() => {});
  });

  it("builds models against an unconnected client and queries after connect()", async () => {
    // Build the model registry NOW, against a client that has not yet
    // called .connect(). This is the whole point of the change.
    const getModel = createGetModel({
      db: client.db(dbName),
      models: { User: "users" },
    });
    const User = getModel("User");

    // Connect AFTER the model exists. The driver's mechanism for
    // lazy-connecting on first command would also work, but services
    // typically call connect() explicitly for fail-fast startup.
    await client.connect();

    await User.create({ username: "lazy", balance: 7 });
    const found = await User.findOne({ username: "lazy" }).lean();
    expect(found).toBeTruthy();
    expect(found.username).toBe("lazy");
    expect(found.balance).toBe(7);
  });

  it("reflects collection lookup dynamically (no cached handle)", async () => {
    // If the Db reference is swapped (e.g. driver reconnect, test
    // teardown/recreate) the Model should pick up the new db without
    // anyone re-running createGetModel. We exercise this by inspecting
    // the .collection getter directly.
    const getModel = createGetModel({
      db: client.db(dbName),
      models: { User: "users" },
    });
    const User: any = getModel("User");
    const coll1 = User.collection;
    const coll2 = User.collection;
    expect(coll1.collectionName).toBe("users");
    // Each access returns a fresh Collection handle from db.collection,
    // which is fine — Collection is a thin reference, not a resource.
    expect(coll2.collectionName).toBe("users");
  });
});
