// Thrown at query exec time when a single Query has had both
// `.castIds()` and `.skipCastIds()` called on it AND the configured
// conflict policy is "throw".
//
// Exported as a named class so callers can do `instanceof` in error
// handlers. The static `is(err)` helper is here for callers that
// receive errors across module-boundaries (different bundles can
// produce instanceof-incompatible classes with the same name).

export class CastIdsConflictError extends Error {
  readonly name = "CastIdsConflictError";
  readonly castIdsCallCount: number;
  readonly skipCastIdsCallCount: number;

  constructor(opts: { castIdsCallCount: number; skipCastIdsCallCount: number }) {
    super(
      `Conflicting calls on the same Query: ${opts.castIdsCallCount}× .castIds() and ${opts.skipCastIdsCallCount}× .skipCastIds(). ` +
        `The configured castIdsConflictPolicy is "throw" — pass createGetModel({ castIdsConflictPolicy: "lastWins" | "firstWins" | "defaultWins" }) to resolve conflicts automatically, or remove one of the calls.`,
    );
    this.castIdsCallCount = opts.castIdsCallCount;
    this.skipCastIdsCallCount = opts.skipCastIdsCallCount;
  }

  static is(err: unknown): err is CastIdsConflictError {
    return (
      err instanceof Error &&
      (err as any).name === "CastIdsConflictError"
    );
  }
}
