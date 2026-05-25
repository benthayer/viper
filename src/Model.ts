import type { Collection, Db, ObjectId as ObjectIdType } from "mongodb";
import { ObjectId } from "bson";
import { Query } from "./Query.js";
import { runPopulate, normalizePopulateArg } from "./populate.js";
import type {
  CastIdsConflictPolicy,
  CastDatesConflictPolicy,
} from "./types.js";

type ModelInit = {
  name: string;
  collection: Collection;
  db: Db;
  populates: Record<string, { collection: string }>;
  collectionToModelName: Map<string, string>;
  getModelByName: (name: string) => any;
  autoCastIds: boolean;
  castIdsConflictPolicy: CastIdsConflictPolicy;
  autoCastDates: boolean;
  castDatesConflictPolicy: CastDatesConflictPolicy;
};

// Mongoose `Model` is half class, half magic. We mimic the surface the
// codebase actually uses (per inventory): the static entry verbs.
// Instances are not a thing — call sites never `new Model()`.
export class Model {
  name: string;
  collection: Collection;
  populates: Record<string, { collection: string }>;
  collectionToModelName: Map<string, string>;
  getModelByName: (name: string) => any;
  autoCastIds: boolean;
  castIdsConflictPolicy: CastIdsConflictPolicy;
  autoCastDates: boolean;
  castDatesConflictPolicy: CastDatesConflictPolicy;

  // Mongoose exposes Model.db as a Connection-like object, and
  // Connection.db is the native Db handle. Some libraries reach
  // through `Model.db.db` to grab the native Db and issue a raw
  // `db.collection(name).findOne({})` — bypassing the ODM (often
  // to avoid lossy type handling like mongoose's historical
  // Decimal128 quirks).
  //
  // We mimic that two-hop shape: `model.db` is a wrapper object whose
  // `.db` is the native Db. Anything else hanging off Connection is
  // not currently used by any call site, so we leave it unset.
  db: { db: Db };

  constructor(init: ModelInit) {
    this.name = init.name;
    this.collection = init.collection;
    this.populates = init.populates;
    this.collectionToModelName = init.collectionToModelName;
    this.getModelByName = init.getModelByName;
    this.autoCastIds = init.autoCastIds;
    this.castIdsConflictPolicy = init.castIdsConflictPolicy;
    this.autoCastDates = init.autoCastDates;
    this.castDatesConflictPolicy = init.castDatesConflictPolicy;
    this.db = { db: init.db };
  }

  // ---- query entry verbs --------------------------------------------

  find(filter: any = {}, projection?: any, options?: any): Query {
    const q = new Query({ model: this, op: "find", filter, options });
    if (projection) q.select(projection);
    if (options?.sort) q.sort(options.sort);
    if (options?.limit !== undefined) q.limit(options.limit);
    if (options?.skip !== undefined) q.skip(options.skip);
    return q;
  }

  findOne(filter: any = {}, projection?: any, options?: any): Query {
    const q = new Query({ model: this, op: "findOne", filter, options });
    if (projection) q.select(projection);
    return q;
  }

  findById(id: any, projection?: any, options?: any): Query {
    return this.findOne({ _id: extractId(id) }, projection, options);
  }

  findOneAndUpdate(filter: any, update: any, options?: any): Query {
    return new Query({
      model: this,
      op: "findOneAndUpdate",
      filter,
      update,
      options,
    });
  }

  findByIdAndUpdate(id: any, update: any, options?: any): Query {
    return this.findOneAndUpdate({ _id: extractId(id) }, update, options);
  }

  findOneAndDelete(filter: any, options?: any): Query {
    return new Query({
      model: this,
      op: "findOneAndDelete",
      filter,
      options,
    });
  }

  findByIdAndDelete(id: any, options?: any): Query {
    return this.findOneAndDelete({ _id: extractId(id) }, options);
  }

  updateOne(filter: any, update: any, options?: any): Query {
    return new Query({
      model: this,
      op: "updateOne",
      filter,
      update,
      options,
    });
  }

  updateMany(filter: any, update: any, options?: any): Query {
    return new Query({
      model: this,
      op: "updateMany",
      filter,
      update,
      options,
    });
  }

  deleteOne(filter: any, options?: any): Query {
    return new Query({
      model: this,
      op: "deleteOne",
      filter,
      options,
    });
  }

  deleteMany(filter: any, options?: any): Query {
    return new Query({
      model: this,
      op: "deleteMany",
      filter,
      options,
    });
  }

  countDocuments(filter: any = {}, options?: any): Query {
    return new Query({
      model: this,
      op: "countDocuments",
      filter,
      options,
    });
  }

  distinct(field: string, filter: any = {}, options?: any): Query {
    return new Query({
      model: this,
      op: "distinct",
      filter,
      distinctField: field,
      options,
    });
  }

  exists(filter: any, options?: any): Query {
    return new Query({
      model: this,
      op: "exists",
      filter,
      options,
    });
  }

  aggregate(pipeline: any[] = [], options?: any): Query {
    return new Query({
      model: this,
      op: "aggregate",
      pipeline,
      options,
    });
  }

  // ---- writes that aren't chains ------------------------------------

  // Mongoose's create returns the inserted doc(s) with _id set.
  // Inventory uses both forms: create(doc) and create([docs], options).
  async create(input: any, options?: any): Promise<any> {
    if (Array.isArray(input)) {
      const docs = input.map(prepInsert);
      if (docs.length === 0) return [];
      await this.collection.insertMany(docs, options ?? {});
      return docs;
    }
    const doc = prepInsert(input);
    await this.collection.insertOne(doc, options ?? {});
    return doc;
  }

  async insertMany(docs: any[], options?: any): Promise<any[]> {
    const prepared = docs.map(prepInsert);
    if (prepared.length === 0) return [];
    await this.collection.insertMany(prepared, options ?? {});
    return prepared;
  }

  async bulkWrite(ops: any[], options?: any): Promise<any> {
    return this.collection.bulkWrite(ops, options ?? {});
  }

  // Static populate: takes pre-fetched doc(s) and decorates them.
  // Used in a handful of inventory sites for ad-hoc populate after
  // a custom aggregation.
  async populate(docs: any, arg: any): Promise<any> {
    const isArr = Array.isArray(docs);
    const arr = isArr ? docs : [docs];
    if (arr.length === 0) return docs;
    const specs = normalizePopulateArg(arg);
    const populated = await runPopulate(arr, specs, {
      ownerModel: this,
      session: undefined,
    });
    return isArr ? populated : populated[0];
  }
}

// Mongoose auto-assigns _id on insert; the driver does the same, but
// only if _id is missing. We let the driver handle it — no work here.
// Kept as a hook in case we ever need to deep-clone or strip Mongoose-
// only fields.
const prepInsert = (doc: any): any => doc;

const coerceId = (id: any): any => {
  if (id instanceof ObjectId) return id;
  if (typeof id === "string" && /^[0-9a-fA-F]{24}$/.test(id)) {
    return new ObjectId(id);
  }
  return id;
};

// findById helpers accept a document-shaped object (matches mongoose).
// We extract `_id` and then run it through the normal id coercion.
const extractId = (input: any): any => {
  if (input instanceof ObjectId) return input;
  if (input != null && typeof input === "object" && "_id" in input) {
    return coerceId(input._id);
  }
  return coerceId(input);
};
