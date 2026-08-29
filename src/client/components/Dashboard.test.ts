import { describe, expect, it } from "vitest";
import { selectInsightItems } from "./Dashboard";

describe("selectInsightItems", () => {
  it("keeps the insights rail focused on the four largest commitments", () => {
    expect(selectInsightItems(["one", "two", "three", "four", "five"])).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
