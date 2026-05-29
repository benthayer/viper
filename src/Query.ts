import type { Collection, ClientSession } from "mongodb";
import { runPopulate, type PopulateSpec, normalizePopulateArg } from "./populate.js";
import { castFilter } from "./castFilter.js";
import { CastIdsConflictError } from "./CastIdsConflictError.js";
import { CastDatesConflictError } from "./CastDatesConflictError.js";
import type {
  CastIdsConflictPolicy,
  CastDatesConflictPolicy,
} from "./types.js";

// One Query class covers every entry verb. The op tag tells exec()
// what to do at terminus time. Mongoose's Query does the same thing
// — a giant state bag with method chaining and a deferred run. We're
// matching that shape because the call sites already think in those
// terms.

type Op =
  | "find"
  | "findOne"
  | "findOneAndUpdate"
  | "findOneAndDelete"
  | "updateOne"
  | "updateMany"
  | "deleteOne"
  | "deleteMany"
  | "countDocuments"
  | "distinct"
  | "exists"
  | "aggregate";

type ModelLike = {
  name: string;
  collection: Collection;
  populates: Record<string, { collection: string }>;
  collectionToModelName: Map<string, string>;
  getModelByName: (name: string) => any;
  autoCastIds: boolean;
  castIdsConflictPolicy: CastIdsConflictPolicy;
  autoCastDates: boolean;
  castDatesConflictPolicy: CastDatesConflictPolicy;
};

type QueryInit = {
  model: ModelLike;
  op: Op;
  filter?: any;
  update?: any;
  pipeline?: any[];
  distinctField?: string;
  options?: any;
};

export class Query implements PromiseLike<any> {
  private model: ModelLike;
  private op: Op;
  private filter: any;
  private update: any;
  private pipeline: any[];
  private distinctField: string | undefined;

  // Chained options. We accumulate them and push to the driver at exec.
  private _sort: any;
  private _limit: number | undefined;
  private _skip: number | undefined;
  private _select: any;
  private _hint: any;
  private _comment: string | undefined;
  private _session: ClientSession | undefined;
  private _readPref: any;
  private _populates: PopulateSpec[] = [];
  private _lean = false;

  // Ordered log of cast-id overrides on this chain.
  //   "on"  — user called .castIds()
  //   "off" — user called .skipCastIds()
  // Empty = neither was called; use model's autoCastIds default.
  // Both present at exec time = conflict, resolve per policy.
  private _castIdsOps: Array<"on" | "off"> = [];

  // Same shape as _castIdsOps, for the date-string cast.
  private _castDatesOps: Array<"on" | "off"> = [];

  // Options bag set by entry verb (e.g. { new, upsert, returnDocument }).
  // Stays mostly opaque — we forward what the driver understands.
  private opOptions: any;

  // Memoize result so a Query (like mongoose) can be awaited / .then'd
  // exactly once and re-runs throw the mongoose error string.
  private _executed = false;
  private _execPromise: Promise<any> | null = null;

  constructor(init: QueryInit) {
    this.model = init.model;
    this.op = init.op;
    this.filter = init.filter;
    this.update = init.update;
    this.pipeline = init.pipeline ?? [];
    this.distinctField = init.distinctField;
    this.opOptions = init.options ?? {};
  }

  // ---- chain methods ------------------------------------------------

  lean(on: boolean = true): this {
    this._lean = on;
    return this;
  }

  sort(spec: any): this {
    this._sort = spec;
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  skip(n: number): this {
    this._skip = n;
    return this;
  }

  select(spec: any): this {
    // Mongoose accepts strings ("name -_id") and objects ({ name: 1 }).
    // The driver only takes objects, so normalize.
    this._select = typeof spec === "string" ? parseSelectString(spec) : spec;
    return this;
  }

  hint(h: any): this {
    this._hint = h;
    return this;
  }

  comment(c: string): this {
    this._comment = c;
    return this;
  }

  session(s: ClientSession | null | undefined): this {
    this._session = s ?? undefined;
    return this;
  }

  read(pref: any): this {
    this._readPref = pref;
    return this;
  }

  // Force ObjectId auto-cast ON for this query, regardless of the
  // constructor's `autoCastIds` setting. See README + SECURITY.md.
  castIds(): this {
    this._castIdsOps.push("on");
    return this;
  }

  // Force ObjectId auto-cast OFF for this query, regardless of the
  // constructor's `autoCastIds` setting.
  skipCastIds(): this {
    this._castIdsOps.push("off");
    return this;
  }

  // Force ISO/RFC 1123 → Date auto-cast ON for this query, regardless
  // of the constructor's `autoCastDates` setting.
  castDates(): this {
    this._castDatesOps.push("on");
    return this;
  }

  // Force ISO/RFC 1123 → Date auto-cast OFF for this query, regardless
  // of the constructor's `autoCastDates` setting.
  skipCastDates(): this {
    this._castDatesOps.push("off");
    return this;
  }

  populate(arg?: any): this {
    // Mongoose semantics: bare `.populate()` populates every ref in the
    // schema. We mirror that by populating every path in the model's
    // populates map.
    if (arg === undefined) {
      const allPaths = Object.keys(this.model.populates);
      this._populates.push(...allPaths.map((path) => ({ path })));
      return this;
    }
    const specs = normalizePopulateArg(arg);
    this._populates.push(...specs);
    return this;
  }

  where(field: string, value?: any): this {
    // Mongoose-style .where('foo').equals(bar) / .where('foo', bar).
    // Inventory shows minimal usage; just support the two-arg form
    // and merge into filter.
    this.filter = this.filter ?? {};
    if (arguments.length === 2) {
      this.filter[field] = value;
    }
    return this;
  }

  // Mongoose-style filter combinators. Merge into the existing filter
  // exactly the way mongoose does — push onto the existing $or/$and
  // array if one exists, else create it.
  or(conditions: any[]): this {
    this.filter = this.filter ?? {};
    this.filter.$or = [...(this.filter.$or ?? []), ...conditions];
    return this;
  }

  and(conditions: any[]): this {
    this.filter = this.filter ?? {};
    this.filter.$and = [...(this.filter.$and ?? []), ...conditions];
    return this;
  }

  nor(conditions: any[]): this {
    this.filter = this.filter ?? {};
    this.filter.$nor = [...(this.filter.$nor ?? []), ...conditions];
    return this;
  }

  // Aggregate-only: matches mongoose's Query.option (loose passthrough).
  option(o: any): this {
    this.opOptions = { ...this.opOptions, ...o };
    return this;
  }

  // ---- thenable terminus ---------------------------------------------

  exec(): Promise<any> {
    if (this._executed) {
      // Match mongoose's actual behavior on re-execution.
      return Promise.reject(
        new Error("Query was already executed: re-run not supported"),
      );
    }
    this._executed = true;
    this._execPromise = this.run();
    return this._execPromise;
  }

  then<TResolve = any, TReject = never>(
    onResolve?: ((v: any) => TResolve | PromiseLike<TResolve>) | null,
    onReject?: ((e: any) => TReject | PromiseLike<TReject>) | null,
  ): Promise<TResolve | TReject> {
    return this.exec().then(onResolve, onReject);
  }

  catch<T = never>(
    onReject?: ((e: any) => T | PromiseLike<T>) | null,
  ): Promise<any | T> {
    return this.exec().catch(onReject);
  }

  finally(onFinally?: (() => void) | null): Promise<any> {
    return this.exec().finally(onFinally);
  }

  // ---- dispatch ------------------------------------------------------

  private async run(): Promise<any> {
    switch (this.op) {
      case "find":
        return this.runFind();
      case "findOne":
        return this.runFindOne();
      case "findOneAndUpdate":
        return this.runFindOneAndUpdate();
      case "findOneAndDelete":
        return this.runFindOneAndDelete();
      case "updateOne":
        return this.runUpdate("updateOne");
      case "updateMany":
        return this.runUpdate("updateMany");
      case "deleteOne":
        return this.runDelete("deleteOne");
      case "deleteMany":
        return this.runDelete("deleteMany");
      case "countDocuments":
        return this.runCount();
      case "distinct":
        return this.runDistinct();
      case "exists":
        return this.runExists();
      case "aggregate":
        return this.runAggregate();
    }
  }

  // Apply structurally-unambiguous coercions to filter strings, IF the
  // resolved per-query settings say we should. Done once per exec, at
  // the boundary just before handing the filter to the driver.
  //
  // Both casts are on by default for Mongoose parity (Mongoose does
  // the same silently from the schema). Opt out globally with
  // `autoCastIds: false` / `autoCastDates: false`, or per-query with
  // `.skipCastIds()` / `.skipCastDates()` when the filter value
  // happens to look like one of the cast shapes but isn't.
  private castedFilter(): any {
    const filter = this.filter ?? {};
    return castFilter(filter, this.resolveCastOptions());
  }

  // Resolve both per-query cast settings at once. Done together so
  // each conflict policy throws in a deterministic order (ids first,
  // then dates) and so we have a single CastOptions value to thread
  // through castFilter and the aggregate $match path.
  private resolveCastOptions(): { castIds: boolean; castDates: boolean } {
    return {
      castIds: this.resolveCastIds(),
      castDates: this.resolveCastDates(),
    };
  }

  // Resolve the per-query cast-id setting:
  //   0 calls of either                 → constructor default
  //   only .castIds()  was called       → true
  //   only .skipCastIds() was called    → false
  //   both were called                  → consult conflict policy
  private resolveCastIds(): boolean {
    const ops = this._castIdsOps;
    const hasOn = ops.includes("on");
    const hasOff = ops.includes("off");

    if (!hasOn && !hasOff) return this.model.autoCastIds;
    if (hasOn && !hasOff) return true;
    if (!hasOn && hasOff) return false;

    // Conflict: both were called at least once.
    switch (this.model.castIdsConflictPolicy) {
      case "throw":
        throw new CastIdsConflictError({
          castIdsCallCount: ops.filter((o) => o === "on").length,
          skipCastIdsCallCount: ops.filter((o) => o === "off").length,
        });
      case "firstWins":
        return ops[0] === "on";
      case "lastWins":
        return ops[ops.length - 1] === "on";
      case "defaultWins":
        return this.model.autoCastIds;
    }
  }

  // Mirrors resolveCastIds for the date-string cast.
  private resolveCastDates(): boolean {
    const ops = this._castDatesOps;
    const hasOn = ops.includes("on");
    const hasOff = ops.includes("off");

    if (!hasOn && !hasOff) return this.model.autoCastDates;
    if (hasOn && !hasOff) return true;
    if (!hasOn && hasOff) return false;

    switch (this.model.castDatesConflictPolicy) {
      case "throw":
        throw new CastDatesConflictError({
          castDatesCallCount: ops.filter((o) => o === "on").length,
          skipCastDatesCallCount: ops.filter((o) => o === "off").length,
        });
      case "firstWins":
        return ops[0] === "on";
      case "lastWins":
        return ops[ops.length - 1] === "on";
      case "defaultWins":
        return this.model.autoCastDates;
    }
  }

  private findOptions(): any {
    const o: any = {};
    if (this._sort) o.sort = this._sort;
    if (this._limit !== undefined) o.limit = this._limit;
    if (this._skip !== undefined) o.skip = this._skip;
    if (this._select) o.projection = this._select;
    if (this._hint) o.hint = this._hint;
    if (this._comment) o.comment = this._comment;
    if (this._session) o.session = this._session;
    if (this._readPref) o.readPreference = this._readPref;
    return o;
  }

  private writeOptions(): any {
    const o: any = { ...this.opOptions };
    if (this._hint) o.hint = this._hint;
    if (this._comment) o.comment = this._comment;
    if (this._session) o.session = this._session;
    return o;
  }

  private async runFind(): Promise<any> {
    const cursor = this.model.collection.find(this.castedFilter(), this.findOptions());
    let docs = await cursor.toArray();
    if (this._populates.length) {
      docs = await runPopulate(docs, this._populates, {
        ownerModel: this.model,
        session: this._session,
        comment: this._comment,
      });
    }
    if (!this._lean) docs.forEach(addIdVirtual);
    return docs;
  }

  private async runFindOne(): Promise<any> {
    const doc = await this.model.collection.findOne(this.castedFilter(), this.findOptions());
    if (!doc) return null;
    if (this._populates.length) {
      const [populated] = await runPopulate([doc], this._populates, {
        ownerModel: this.model,
        session: this._session,
        comment: this._comment,
      });
      if (!this._lean) addIdVirtual(populated);
      return populated;
    }
    if (!this._lean) addIdVirtual(doc);
    return doc;
  }

  private async runFindOneAndUpdate(): Promise<any> {
    // Mongoose default: { new: false, upsert: false }, returns the doc
    // (pre-update unless new: true). Driver default in modern driver is
    // returnDocument: 'before' which matches mongoose. We only translate
    // { new: true } → returnDocument: 'after'.
    const o = this.writeOptions();
    if (o.new === true) o.returnDocument = "after";
    delete o.new;
    if (this._select) o.projection = this._select;
    if (this._sort) o.sort = this._sort;
    const res = await this.model.collection.findOneAndUpdate(
      this.castedFilter(),
      wrapInSetIfPlain(this.update),
      o,
    );
    // Driver returns the document directly (not { value }) in modern
    // versions. Mongoose unwraps to the doc too.
    const doc = res && typeof res === "object" && "value" in (res as any)
      ? (res as any).value
      : res;
    if (!doc) return null;
    if (this._populates.length) {
      const [populated] = await runPopulate([doc], this._populates, {
        ownerModel: this.model,
        session: this._session,
        comment: this._comment,
      });
      if (!this._lean) addIdVirtual(populated);
      return populated;
    }
    if (!this._lean) addIdVirtual(doc);
    return doc;
  }

  private async runFindOneAndDelete(): Promise<any> {
    const o = this.writeOptions();
    if (this._select) o.projection = this._select;
    if (this._sort) o.sort = this._sort;
    const res = await this.model.collection.findOneAndDelete(
      this.castedFilter(),
      o,
    );
    const doc = res && typeof res === "object" && "value" in (res as any)
      ? (res as any).value
      : res;
    if (doc && !this._lean) addIdVirtual(doc);
    return doc;
  }

  private async runUpdate(kind: "updateOne" | "updateMany"): Promise<any> {
    return this.model.collection[kind](
      this.castedFilter(),
      wrapInSetIfPlain(this.update),
      this.writeOptions(),
    );
  }

  private async runDelete(kind: "deleteOne" | "deleteMany"): Promise<any> {
    return this.model.collection[kind](this.castedFilter(), this.writeOptions());
  }

  private async runCount(): Promise<number> {
    return this.model.collection.countDocuments(this.castedFilter(), this.findOptions());
  }

  private async runDistinct(): Promise<any[]> {
    return this.model.collection.distinct(this.distinctField!, this.castedFilter(), this.findOptions());
  }

  private async runExists(): Promise<{ _id: any } | null> {
    const doc = await this.model.collection.findOne(this.castedFilter(), {
      projection: { _id: 1 },
      session: this._session,
    });
    return doc ? { _id: doc._id } : null;
  }

  private async runAggregate(): Promise<any[]> {
    const opts: any = {};
    if (this._session) opts.session = this._session;
    if (this._hint) opts.hint = this._hint;
    if (this._comment) opts.comment = this._comment;
    if (this.opOptions.allowDiskUse) opts.allowDiskUse = this.opOptions.allowDiskUse;
    // Cast hex/date strings in $match stages — same gating as the
    // top-level filter. Other stages may contain expressions, but
    // only $match is a true "filter" position.
    const castOpts = this.resolveCastOptions();
    const pipeline = this.pipeline.map((stage) => {
      if (stage && typeof stage === "object" && "$match" in stage) {
        return { ...stage, $match: castFilter(stage.$match, castOpts) };
      }
      return stage;
    });
    return this.model.collection.aggregate(pipeline, opts).toArray();
  }
}

// Mongoose silently wraps a plain object update in `$set`. The native
// driver requires atomic operators or a pipeline. Pipeline updates are
// Mongoose hydrated docs expose `.id` as a getter that returns
// `this._id.toString()`. Lean docs don't (they're plain objects with
// just _id). We mirror that: every non-lean return path runs each
// doc through addIdVirtual to attach a non-enumerable `id` getter.
//
// Non-enumerable so JSON.stringify / spread / Object.keys see the
// same shape as a lean doc. Idempotent: skip if `id` is already an
// own property (already set, already populated, doc came from
// somewhere else).
export const addIdVirtual = (doc: any): void => {
  if (!doc || typeof doc !== "object") return;
  if (Object.prototype.hasOwnProperty.call(doc, "id")) return;
  Object.defineProperty(doc, "id", {
    get() {
      // Mongoose's `.id` returns `null` when `_id` is missing (rather
      // than `undefined`). Matching that exactly — drop-in compat.
      return this._id == null ? null : this._id.toString();
    },
    enumerable: false,
    configurable: true,
  });
};

// arrays — pass through. Updates that already have at least one
// top-level `$`-key go through. Anything else gets wrapped.
const wrapInSetIfPlain = (update: any): any => {
  if (update == null) return update;
  if (Array.isArray(update)) return update;
  if (typeof update !== "object") return update;
  const keys = Object.keys(update);
  if (keys.length === 0) return update;
  const hasOperator = keys.some((k) => k.startsWith("$"));
  if (hasOperator) return update;
  return { $set: update };
};

const parseSelectString = (s: string): Record<string, 0 | 1> => {
  const out: Record<string, 0 | 1> = {};
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("-")) out[tok.slice(1)] = 0;
    else out[tok] = 1;
  }
  return out;
};
