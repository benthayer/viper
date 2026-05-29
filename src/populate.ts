import type { ClientSession } from "mongodb";

// Populate engine. Goals:
//   1. ONE $in query per (parent-set × path) — never N+1.
//   2. Support string paths ("authorID"), object specs
//      ({ path, select, match, populate }), nested populate, and array
//      paths ("tags._id" → array-of-subdocs each with ._id ref).
//   3. Use the model's `populates` map to resolve which collection
//      to read from for each path.

export type PopulateSpec = {
  path: string;
  select?: any;
  match?: any;
  populate?: PopulateSpec[];
};

type ModelLike = {
  name: string;
  populates: Record<string, { collection: string }>;
  collectionToModelName: Map<string, string>;
  getModelByName: (name: string) => any;
};

type RunOpts = {
  ownerModel: ModelLike;
  session: ClientSession | undefined;
  comment?: string;
};

export const normalizePopulateArg = (arg: any): PopulateSpec[] => {
  if (!arg) return [];
  if (typeof arg === "string") {
    // Mongoose accepts "a b c" → three populates.
    return arg
      .split(/\s+/)
      .filter(Boolean)
      .map((path) => ({ path }));
  }
  if (Array.isArray(arg)) {
    return arg.flatMap(normalizePopulateArg);
  }
  if (typeof arg === "object") {
    const { path, select, match, populate } = arg;
    return [
      {
        path,
        select,
        match,
        populate: populate ? normalizePopulateArg(populate) : undefined,
      },
    ];
  }
  return [];
};

export const runPopulate = async (
  docs: any[],
  specs: PopulateSpec[],
  opts: RunOpts,
): Promise<any[]> => {
  for (const spec of specs) {
    await applySpec(docs, spec, opts);
  }
  return docs;
};

const applySpec = async (
  docs: any[],
  spec: PopulateSpec,
  opts: RunOpts,
): Promise<void> => {
  const cfg = opts.ownerModel.populates[spec.path];
  if (!cfg) {
    // No mapping configured for this path → nothing to do. Matches
    // mongoose's behavior of silently skipping unknown refs.
    return;
  }
  const refModelName = opts.ownerModel.collectionToModelName.get(cfg.collection);
  if (!refModelName) return;
  const refModel = opts.ownerModel.getModelByName(refModelName);

  const isArrayPath = spec.path.includes(".");
  if (isArrayPath) {
    await populateArrayPath(docs, spec, refModel, opts);
  } else {
    await populateScalarPath(docs, spec, refModel, opts);
  }
};

const populateScalarPath = async (
  docs: any[],
  spec: PopulateSpec,
  refModel: any,
  opts: RunOpts,
): Promise<void> => {
  const ids = uniqueIds(docs.map((d) => d?.[spec.path]).filter(isPresent));
  if (ids.length === 0) return;

  const filter: any = { _id: { $in: ids } };
  if (spec.match) Object.assign(filter, spec.match);

  const findOpts: any = {};
  if (spec.select) findOpts.projection = normalizeProjection(spec.select);
  if (opts.session) findOpts.session = opts.session;
  const childComment = buildPopulateComment(opts.comment, spec.path);
  if (childComment) findOpts.comment = childComment;

  const fetched = await refModel.collection.find(filter, findOpts).toArray();

  if (spec.populate) {
    await runPopulate(fetched, spec.populate, {
      ownerModel: refModel,
      session: opts.session,
      comment: childComment,
    });
  }

  const byId = new Map<string, any>();
  for (const f of fetched) byId.set(idKey(f._id), f);

  // Mongoose semantics: if a match filter is present, refs that don't
  // satisfy it get nulled out (the parent doc still exists, but the
  // populated field becomes null). Without a match, leave non-matches
  // alone (the raw ref id stays, matching mongoose's behavior when a
  // referenced doc has been deleted).
  const nullifyMisses = !!spec.match;

  for (const d of docs) {
    const raw = d?.[spec.path];
    if (!isPresent(raw)) continue;
    const hit = byId.get(idKey(raw));
    if (hit) d[spec.path] = hit;
    else if (nullifyMisses) d[spec.path] = null;
  }
};

// "tags._id" — parent has an array of subdocs, each with an _id
// field that's a ref. After populate, each subdoc's _id is replaced
// with the full referenced doc.
const populateArrayPath = async (
  docs: any[],
  spec: PopulateSpec,
  refModel: any,
  opts: RunOpts,
): Promise<void> => {
  const [parent, child] = spec.path.split(".");
  const allIds: any[] = [];
  for (const d of docs) {
    const arr = d?.[parent];
    if (!Array.isArray(arr)) continue;
    for (const sub of arr) {
      const v = sub?.[child];
      if (isPresent(v)) allIds.push(v);
    }
  }
  const ids = uniqueIds(allIds);
  if (ids.length === 0) return;

  const filter: any = { _id: { $in: ids } };
  if (spec.match) Object.assign(filter, spec.match);

  const findOpts: any = {};
  if (spec.select) findOpts.projection = normalizeProjection(spec.select);
  if (opts.session) findOpts.session = opts.session;
  const childComment = buildPopulateComment(opts.comment, spec.path);
  if (childComment) findOpts.comment = childComment;

  const fetched = await refModel.collection.find(filter, findOpts).toArray();

  if (spec.populate) {
    await runPopulate(fetched, spec.populate, {
      ownerModel: refModel,
      session: opts.session,
      comment: childComment,
    });
  }

  const byId = new Map<string, any>();
  for (const f of fetched) byId.set(idKey(f._id), f);

  const nullifyMisses = !!spec.match;

  for (const d of docs) {
    const arr = d?.[parent];
    if (!Array.isArray(arr)) continue;
    for (const sub of arr) {
      const raw = sub?.[child];
      if (!isPresent(raw)) continue;
      const hit = byId.get(idKey(raw));
      if (hit) sub[child] = hit;
      else if (nullifyMisses) sub[child] = null;
    }
  }
};

// Propagate the parent query's comment to populate fan-out queries so
// they remain attributable in profiler / log output. Mongoose itself
// does not do this — we deliberately diverge to preserve route-level
// observability. Annotate with `(populate <path>)` so it's obvious
// which query is the parent and which is the populate.
const buildPopulateComment = (
  parentComment: string | undefined,
  path: string,
): string | undefined => {
  if (!parentComment) return undefined;
  return `${parentComment} (populate ${path})`;
};

const isPresent = (v: any): boolean => v !== null && v !== undefined;

// ObjectId values aren't === equal even when they represent the same
// 24 hex chars, so key by their string form.
const idKey = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v.toHexString === "function") return v.toHexString();
  return String(v);
};

const uniqueIds = (ids: any[]): any[] => {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const id of ids) {
    const k = idKey(id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(id);
  }
  return out;
};

const normalizeProjection = (sel: any): any => {
  if (typeof sel !== "string") return sel;
  const out: Record<string, 0 | 1> = {};
  for (const tok of sel.split(/\s+/).filter(Boolean)) {
    if (tok.startsWith("-")) out[tok.slice(1)] = 0;
    else out[tok] = 1;
  }
  return out;
};
