import { describe, expect, it } from "vitest";
import { buildItemMonthlySeries, filterAndSortCosts } from "./costs";
import type { CostEntry, CostItemSummary } from "../types";

const entry = (overrides: Partial<CostEntry> = {}): CostEntry => ({
  id: 1,
  amount: 10,
  currency: "TRY",
  periodStart: "2025-01-01",
  periodKind: "month",
  membership: "Basic",
  note: null,
  sourceRef: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

describe("item monthly chart series", () => {
  it("sums monthly entries into 12 UTC months and excludes other entry kinds", () => {
    const result = buildItemMonthlySeries(
      [
        entry({ id: 1, amount: 10.1 }),
        entry({ id: 2, amount: 1.23, periodStart: "2025-01-15" }),
        entry({ id: 3, amount: 20, periodStart: "2025-02-01" }),
        entry({
          id: 4,
          amount: 999,
          periodStart: "2025-02-01",
          periodKind: "adjustment",
        }),
        entry({
          id: 5,
          amount: 500,
          periodStart: "2025-03-01",
          periodKind: "year",
        }),
      ],
      2025,
    );

    expect(result.series).toHaveLength(12);
    expect(result.series[0]).toEqual({
      period: "2025-01-01",
      month: "Jan",
      spend: 11.33,
    });
    expect(result.series[1]).toEqual({
      period: "2025-02-01",
      month: "Feb",
      spend: 20,
    });
    expect(result.series.slice(2).every((month) => month.spend === 0)).toBe(true);
  });

  it("lists available years descending and defaults to the latest year", () => {
    const result = buildItemMonthlySeries([
      entry({ id: 1, periodStart: "2024-06-01" }),
      entry({ id: 2, periodStart: "2026-01-01" }),
      entry({ id: 3, periodStart: "2025-12-01" }),
    ]);

    expect(result.availableYears).toEqual([2026, 2025, 2024]);
    expect(result.year).toBe(2026);
    expect(result.series[0].period).toBe("2026-01-01");
  });
});

const cost = (
  overrides: Partial<CostItemSummary> = {},
): CostItemSummary => ({
  id: 1,
  name: "Alpha Cloud",
  category: "Certificate",
  billingType: "annual",
  plan: "Legacy",
  url: null,
  account: "alpha@example.com",
  powerWatts: null,
  status: "closed",
  closedAt: "2025-12-31",
  notes: null,
  lifetimeSpend: 100,
  entryCount: 2,
  latestPeriod: "2025-12-01",
  currentMembership: "Basic",
  latestEntryId: 10,
  ...overrides,
});

const costs = [
  cost({
    id: 3,
    name: "Gamma Studio",
    category: "Platform",
    billingType: "recurring",
    account: "gamma@example.com",
    status: "active",
    closedAt: null,
    lifetimeSpend: 300,
    latestPeriod: "2026-03-01",
    currentMembership: "Professional",
    latestEntryId: 30,
  }),
  cost(),
  cost({
    id: 2,
    name: "Beta Device",
    category: "Device",
    billingType: "one_time",
    plan: null,
    account: null,
    status: "active",
    closedAt: null,
    lifetimeSpend: 200,
    latestPeriod: null,
    currentMembership: null,
    latestEntryId: null,
  }),
];

const noFilters = {
  search: "",
  cost: "",
  category: "",
  billing: "",
  membership: "",
  status: "",
  latestFrom: "",
  latestTo: "",
  lifetimeMin: "",
  lifetimeMax: "",
};

describe("cost table filtering and sorting", () => {
  it("matches trimmed lowercase global and cost-column text", () => {
    expect(
      filterAndSortCosts(costs, { ...noFilters, search: "  GAMMA@ " }, null).map(
        (item) => item.id,
      ),
    ).toEqual([3]);
    expect(
      filterAndSortCosts(costs, { ...noFilters, cost: " alpha " }, null).map(
        (item) => item.id,
      ),
    ).toEqual([1]);
  });

  it("filters category, billing, membership, and status columns", () => {
    expect(
      filterAndSortCosts(costs, { ...noFilters, category: "Platform" }, null).map(
        (item) => item.id,
      ),
    ).toEqual([3]);
    expect(
      filterAndSortCosts(costs, { ...noFilters, billing: "one_time" }, null).map(
        (item) => item.id,
      ),
    ).toEqual([2]);
    expect(
      filterAndSortCosts(
        costs,
        { ...noFilters, membership: "  FESS  " },
        null,
      ).map((item) => item.id),
    ).toEqual([3]);
    expect(
      filterAndSortCosts(costs, { ...noFilters, status: "closed" }, null).map(
        (item) => item.id,
      ),
    ).toEqual([1]);
  });

  it("filters inclusive latest-entry and lifetime-spend ranges", () => {
    expect(
      filterAndSortCosts(
        costs,
        { ...noFilters, latestFrom: "2026-01-01", latestTo: "2026-12-31" },
        null,
      ).map((item) => item.id),
    ).toEqual([3]);
    expect(
      filterAndSortCosts(
        costs,
        { ...noFilters, lifetimeMin: "150", lifetimeMax: "250" },
        null,
      ).map((item) => item.id),
    ).toEqual([2]);
  });

  it("sorts numbers ascending and dates descending with nulls last", () => {
    expect(
      filterAndSortCosts(costs, noFilters, {
        key: "lifetimeSpend",
        direction: "asc",
      }).map((item) => item.id),
    ).toEqual([1, 2, 3]);
    expect(
      filterAndSortCosts(costs, noFilters, {
        key: "latestPeriod",
        direction: "desc",
      }).map((item) => item.id),
    ).toEqual([3, 1, 2]);
  });

  it("uses stable ID tie-breaking without mutating API order", () => {
    const tied = [
      cost({ id: 8, name: "Same", lifetimeSpend: 100 }),
      cost({ id: 4, name: "Same", lifetimeSpend: 100 }),
    ];
    const originalIds = tied.map((item) => item.id);

    const result = filterAndSortCosts(tied, noFilters, {
      key: "name",
      direction: "desc",
    });

    expect(result.map((item) => item.id)).toEqual([4, 8]);
    expect(tied.map((item) => item.id)).toEqual(originalIds);
  });
});
