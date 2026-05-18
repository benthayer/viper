import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestSetup, type TestSetup } from "./lib/setup.js";
import { BACKEND } from "./lib/getModel.js";

describe(`Model.aggregate (${BACKEND})`, () => {
  let setup: TestSetup;
  let Article: any;

  beforeEach(async () => {
    setup = await createTestSetup({ Article: "articles" });
    Article = setup.getModel("Article");
  });

  afterEach(async () => {
    await setup.teardown();
  });

  it("aggregate(pipeline) — terminator await on the call", async () => {
    await Article.create({ category: "tech", score: 100 });
    await Article.create({ category: "tech", score: 90 });
    await Article.create({ category: "news", score: 24 });
    const result = await Article.aggregate([
      { $match: { category: "tech" } },
      { $group: { _id: "$category", total: { $sum: "$score" } } },
    ]);
    expect(result).toEqual([{ _id: "tech", total: 190 }]);
  });

  it("aggregate(pipeline).option({ comment }) — chain method", async () => {
    await Article.create({ category: "tech" });
    const result = await Article.aggregate([
      { $match: { category: "tech" } },
    ]).option({ comment: "inv:aggregateOption" });
    expect(result).toHaveLength(1);
  });

  it("aggregate handles empty result", async () => {
    const result = await Article.aggregate([
      { $match: { category: "nowhere" } },
    ]);
    expect(result).toEqual([]);
  });
});
