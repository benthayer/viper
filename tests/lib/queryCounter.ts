// Helper: wrap a mongo Db's command monitor to count `find`
// commands per collection during a block. Used by populate.test.ts to
// assert the $in-batched populate engine never N+1s.
//
// Works against both backends because both ultimately hit the same
// MongoClient command channel — we attach the monitor to the client
// used by the test context.

import type { MongoClient } from "mongodb";

export type QueryCounts = Record<string, number>;

export type QueryRecorder = {
  counts: () => QueryCounts;
  total: () => number;
  reset: () => void;
  stop: () => void;
};

export const recordQueries = (
  client: MongoClient,
  opts: { commands?: string[] } = {},
): QueryRecorder => {
  const wanted = new Set(opts.commands ?? ["find", "aggregate"]);
  let counts: QueryCounts = {};

  const listener = (ev: any) => {
    if (!wanted.has(ev.commandName)) return;
    const coll = ev.command?.[ev.commandName] ?? "<unknown>";
    counts[coll] = (counts[coll] ?? 0) + 1;
  };

  client.on("commandStarted", listener);

  return {
    counts: () => ({ ...counts }),
    total: () => Object.values(counts).reduce((a, b) => a + b, 0),
    reset: () => {
      counts = {};
    },
    stop: () => {
      client.off("commandStarted", listener);
    },
  };
};
