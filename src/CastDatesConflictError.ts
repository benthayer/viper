// Thrown at query exec time when a single Query has had both
// `.castDates()` and `.skipCastDates()` called on it AND the configured
// conflict policy is "throw".
//
// Mirrors CastIdsConflictError exactly — same shape, same `is()` helper
// for cross-bundle instanceof safety.

export class CastDatesConflictError extends Error {
  readonly name = "CastDatesConflictError";
  readonly castDatesCallCount: number;
  readonly skipCastDatesCallCount: number;

  constructor(opts: {
    castDatesCallCount: number;
    skipCastDatesCallCount: number;
  }) {
    super(
      `Conflicting calls on the same Query: ${opts.castDatesCallCount}× .castDates() and ${opts.skipCastDatesCallCount}× .skipCastDates(). ` +
        `The configured castDatesConflictPolicy is "throw" — pass createGetModel({ castDatesConflictPolicy: "lastWins" | "firstWins" | "defaultWins" }) to resolve conflicts automatically, or remove one of the calls.`,
    );
    this.castDatesCallCount = opts.castDatesCallCount;
    this.skipCastDatesCallCount = opts.skipCastDatesCallCount;
  }

  static is(err: unknown): err is CastDatesConflictError {
    return (
      err instanceof Error &&
      (err as any).name === "CastDatesConflictError"
    );
  }
}
