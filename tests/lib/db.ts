import { MongoClient, type Db } from "mongodb";
import { randomUUID } from "node:crypto";

const URI =
  process.env.MONGO_URI ??
  "mongodb://localhost:27017/?directConnection=true";

export type TestDbContext = {
  client: MongoClient;
  db: Db;
  dbName: string;
};

// Single shared db, single shared client across the whole test run.
// We drop collections (not the DB) per test to avoid hammering the
// replica-set oplog with createDatabase/dropDatabase entries — that
// causes mongo to spend minutes replaying on restart.
const SHARED_DB_NAME = `viper-test-${randomUUID()}`;
let sharedClient: MongoClient | null = null;
let sharedClientRefs = 0;

const getSharedClient = async (): Promise<MongoClient> => {
  if (!sharedClient) {
    sharedClient = new MongoClient(URI, { monitorCommands: true });
    await sharedClient.connect();
  }
  sharedClientRefs++;
  return sharedClient;
};

const releaseSharedClient = async () => {
  sharedClientRefs--;
  // Don't close here. The process exit handler covers it via vitest
  // teardown. Keeping it open across tests is the whole point.
};

export const makeTestDbName = () => SHARED_DB_NAME;

export const connectTestDb = async (
  dbName = SHARED_DB_NAME,
): Promise<TestDbContext> => {
  const client = await getSharedClient();
  const db = client.db(dbName);
  // Cheap per-test isolation: drop all collections in the shared db.
  // This is way lighter than dropDatabase on a replica set.
  const collections = await db.collections();
  for (const c of collections) {
    try {
      await c.drop();
    } catch {
      // Collection doesn't exist or already dropped — fine.
    }
  }
  return { client, db, dbName };
};

export const teardownTestDb = async (_ctx: TestDbContext) => {
  await releaseSharedClient();
};

export const withTestDb = async <T>(
  fn: (ctx: TestDbContext) => Promise<T>,
): Promise<T> => {
  const ctx = await connectTestDb();
  try {
    return await fn(ctx);
  } finally {
    await teardownTestDb(ctx);
  }
};
