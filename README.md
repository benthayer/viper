# Viper

In a fight of Mongoose vs. Viper, only 1 in 10 Vipers come out on top. This is the 10th Viper.

Viper is a drop-in Mongoose replacement built for speed.

Under the hood, it uses the native MongoDB driver without any fluff for optimal performance while maintaining the same convenient API as Mongoose.

## Quickstart

```bash
npm install @4csoftware/mongoose-killer mongodb
```
```ts
import { createGetModel } from "@4csoftware/mongoose-killer";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI!);
await client.connect();
const db = client.db("app");

const getModel = createGetModel({
  db,
  models: {
    User: "users",
    Post: "posts",
  },
  populates: {
    Post: {
      authorID: { collection: "users" },
    },
  },
});

const User = getModel("User");
const Post = getModel("Post");

await User.create({ name: "Alice" });

const posts = await Post.find({ published: true })
  .populate("authorID")
  .sort({ createdAt: -1 })
  .limit(10)
  .lean();
```

## What it is

- **A `Model` API, not an ODM.** No schemas, no validation, no hooks,
  no virtuals. The native MongoDB driver does the work; Viper just
  exposes it through the chainable, thenable, `.populate()`-aware
  interface mongoose users already think in.
- **Drop-in equivalence is enforced.** The test suite runs every test
  against real Mongoose *and* Viper, asserting identical results. If a
  call shape isn't covered by `tests/`, assume it isn't supported.
- **TypeScript-first.** Source is TS, types ship with the package, ESM
  and CJS both work.

## What it isn't

- A general-purpose ODM. The supported surface is whatever the test
  suite covers — see "What's supported" below.
- A schema layer. Documents are plain objects in and out. If you want
  validation, do it before you call Viper.

## Installing

```bash
npm install @4csoftware/mongoose-killer mongodb
# or
yarn add @4csoftware/mongoose-killer mongodb
```

`mongodb` is a peer dependency — Viper doesn't bundle a driver, so the
client and Viper agree on driver version.

## What's supported

- **Standard calls**: `find`, `findOne`, `findById`, `findOneAndUpdate`,
  `findByIdAndUpdate`, `findOneAndDelete`, `findByIdAndDelete`,
  `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `create`,
  `insertMany`, `bulkWrite`, `aggregate`, `countDocuments`, `distinct`,
  `exists`.
- **Populate**: string path, object spec with `select`/`match`, nested,
  array-of-refs (`tags._id`), array of specs, static
  `Model.populate(docs, spec)`. Always `$in`-batched, never N+1.
- **Method chaining**: `lean`, `sort`, `limit`, `skip`, `select`, `hint`,
  `comment`, `session`, `read`, `populate`, `where`, `or`, `and`,
  `nor`, `option`.
- **Sessions & Transactions**: `{ session }` threads through every op for transactions.
- **Thenable API**: `await`, `.then`, `.catch`, `.finally`, `.exec()`.

## What's *not* supported

- Schemas, virtuals, hooks (`pre`/`post`), getters, setters, casting,
  validation, defaults.
- `new Model(doc)` / `doc.save()`. Use `Model.create(doc)`.
- Mongoose-specific connection/event API. You own the `MongoClient`
  and pass us a `Db`.
- Mongoose's `Types` namespace — import `ObjectId` / `Decimal128`
  straight from `bson`.

## Compatibility Features

### ObjectId Auto-casting

Like Mongoose, Viper automatically casts 24-char hex strings to
`ObjectId` in filter positions. **On by default** for drop-in parity.

Since Viper doesn't know your schemas, this cast is applied to *every*
24-hex string in a filter, not just the ones that should be IDs. If
you have a field that stores 24-character hex strings that aren't IDs, 
this behavior will be incorrect for your use case.

You can easily opt out of this behavior by changing the global default
or overriding per query.


```ts
// Default — on
const getModel = createGetModel({ db, models });
const getModel = createGetModel({ db, models, autoCastIds: true }); // Same but explicit

// Opt out globally
const getModel = createGetModel({ db, models, autoCastIds: false });

// Override per query
await User.findOne({ _id: hexId }).castIds();           // force on
await User.findOne({ slug: hexLookingSlug }).skipCastIds(); // force off
```

If both `.castIds()` and `.skipCastIds()` get called on the same query
(probably a bug), Viper throws by default. You can change that via
`castIdsConflictPolicy: 'firstWins' | 'lastWins' | 'defaultWins'`.

### `.id` field

Like Mongoose, Viper exposes `.id` on non-lean documents as the
stringified `_id`.

```ts
const post = await Post.findOne({ slug: "hello-world" });
// post._id is an ObjectId, post.id is its string form

console.log(post._id);       // ObjectId("507f1f77bcf86cd799439011")
console.log(post.id);        // "507f1f77bcf86cd799439011"
```

If a document has no `_id`, `.id` returns `null` (matching Mongoose).
The `.id` field will not be detected by `JSON.stringify`,  `Object.keys` 
and other similar functions, so you won't end up with an id field when
storing in Redis, for example.

`.lean()` returns plain driver objects with no `.id` virtual, also
matching Mongoose.

## TypeScript and ESM

Both TypeScript and ESM import syntax are supported by default.


## Running the tests

Requires a local MongoDB at `mongodb://localhost:27017`

With docker-compose like this:
```docker-compose
services:
  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    ulimits:
      nofile:
        soft: 64000
        hard: 64000
```

With docker like this:
```bash
docker run --ulimit nofile=64000:64000 -p 27017:27017 mongo:7
```

If using replica set mode, you will need to include directConnection=true

Setting ulimits is required because the internal socket limit default is low and running the tests create a lot of sockets.


```bash
yarn test            # default — runs against Viper
yarn test:real       # against real mongoose
yarn test:both       # back-to-back; the drop-in proof
yarn typecheck       # tsc --noEmit
```

## License

MIT.
