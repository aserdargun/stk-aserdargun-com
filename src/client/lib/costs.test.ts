import { describe, expect, it } from "vitest";
import { buildItemMonthlySeries, filterAndSortCosts } from "./costs";
import type { CostEntry, CostItemSummary } from "../types";

const entry = (overrides: Partial<CostEntry> = {}): CostEntry => ({
  id: 1,
  amount: 100,
  currency: "TRY",
  periodStart: "2026-01-01",
  periodKind: "month",
  membership: "Professional",
  note: null,
  sourceRef: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("item monthly cost series", () => {
  it("defaults to the latest year and zero-fills all 12 monthly points", () => {
    const result = buildItemMonthlySeries([
      entry({ id: 1, amount: 100 }),
      entry({ id: 2, amount: 49.999 }),
      entry({ id: 3, amount: 20, periodStart: "2026-02-01" }),
      entry({ id: 4, amount: 999, periodStart: "2026-03-01", periodKind: "year" }),
      entry({ id: 5, amount: 80, periodStart: "2025-12-01" }),
    ]);

    expect(result.year).toBe(2026);
    expect(result.availableYears).toEqual([2026, 2025]);
    expect(result.series).toHaveLength(12);
    expect(result.series[0]).toEqual({ period: "2026-01-01", month: "Jan", spend: 150 });
    expect(result.series[1].spend).toBe(20);
    expect(result.series[2].spend).toBe(0);
  });

  it("uses a requested available year", () => {
    const result = buildItemMonthlySeries(
      [entry({ amount: 80, periodStart: "2025-12-01" }), entry()],
      2025,
    );

    expect(result.year).toBe(2025);
    expect(result.series[11].spend).toBe(80);
  });
});

const cost = (overrides: Partial<CostItemSummary> = {}): CostItemSummary => ({
  id: 1,
  name: "Alpha Cloud",
  category: "Platform",
  billingType: "recurring",
  plan: "Legacy",
  url: null,
  account: "owner@example.com",
  powerWatts: null,
  status: "active",
  closedAt: null,
  notes: null,
  lifetimeSpend: 1200,
  entryCount: 12,
  latestPeriod: "2026-03-01",
  latestEntryId: 12,
  currentMembership: "Professional",
  ...overrides,
});

describe("Costs table filtering and sorting", () => {
  const items = [
    cost(),
    cost({
      id: 2,
      name: "Beta Device",
      category: "Device",
      billingType: "one_time",
      status: "closed",
      latestPeriod: "2025-06-01",
      lifetimeSpend: 5000,
      currentMembership: null,
    }),
    cost({
      id: 3,
      name: "Gamma Suite",
      category: "Platform",
      billingType: "annual",
      latestPeriod: "2026-01-01",
      lifetimeSpend: 800,
      currentMembership: "Team",
    }),
  ];

  it.each([
    ["global search", { search: "owner@example" }, [1, 2, 3]],
    ["cost name", { name: "gamma" }, [3]],
    ["category", { category: "Device" }, [2]],
    ["billing", { billingType: "annual" }, [3]],
    ["membership", { membership: "prof" }, [1]],
    ["status", { status: "closed" }, [2]],
    ["latest from", { latestFrom: "2026-02-01" }, [1]],
    ["latest to", { latestTo: "2025-12-31" }, [2]],
    ["spend minimum", { spendMin: "1000" }, [1, 2]],
    ["spend maximum", { spendMax: "1000" }, [3]],
  ])("filters by %s", (_label, filters, expectedIds) => {
    expect(filterAndSortCosts(items, filters, { key: "name", direction: "asc" }).map((item) => item.id))
      .toEqual(expectedIds);
  });

  it("sorts numbers and dates without mutating API order", () => {
    const originalIds = items.map((item) => item.id);

    expect(
      filterAndSortCosts(items, {}, { key: "lifetimeSpend", direction: "desc" }).map(
        (item) => item.id,
      ),
    ).toEqual([2, 1, 3]);
    expect(
      filterAndSortCosts(items, {}, { key: "latestPeriod", direction: "asc" }).map(
        (item) => item.id,
      ),
    ).toEqual([2, 3, 1]);
    expect(items.map((item) => item.id)).toEqual(originalIds);
  });
});
