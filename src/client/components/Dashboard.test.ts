import { describe, expect, it } from "vitest";
import { describeMonthlyFreshness, selectInsightItems } from "./Dashboard";

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

describe("describeMonthlyFreshness", () => {
  it("makes an aging monthly ledger explicit without inventing newer data", () => {
    expect(
      describeMonthlyFreshness("2026-07-01", new Date("2026-09-04T00:00:00Z")),
    ).toEqual({
      label: "Current through July 2026",
      detail: "2 months since the latest monthly entry",
      needsAttention: true,
    });
  });

  it("handles a current ledger and an empty ledger", () => {
    expect(
      describeMonthlyFreshness("2026-09-01", new Date("2026-09-04T00:00:00Z")),
    ).toMatchObject({ detail: "Latest month recorded", needsAttention: false });
    expect(describeMonthlyFreshness(null, new Date("2026-09-04T00:00:00Z"))).toEqual({
      label: "No monthly data yet",
      detail: "Import a statement to start the monthly view",
      needsAttention: true,
    });
  });
});
