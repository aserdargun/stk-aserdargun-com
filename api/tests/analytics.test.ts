import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDashboard } from "../src/lib/analytics.js";
import type { EntryRecord, ItemRecord, SeedPayload } from "../src/lib/models.js";

const payload = JSON.parse(
  readFileSync(new URL("../../data/seed-data.json", import.meta.url), "utf8"),
) as SeedPayload;
const itemIds = new Map<string, number>();
const items: ItemRecord[] = payload.items.map((item, index) => {
  const id = index + 1;
  itemIds.set(item.key, id);
  return { ...item, id, createdAt: "2026-08-10T00:00:00.000Z", updatedAt: "2026-08-10T00:00:00.000Z" };
});
const entries: EntryRecord[] = payload.entries.map((entry, index) => ({
  ...entry,
  id: index + 1,
  itemId: itemIds.get(entry.itemKey)!,
  membership: entry.membership || null,
  createdAt: "2026-08-10T00:00:00.000Z",
}));

describe("Azure-native dashboard analytics", () => {
  it("reconciles the migrated source data", () => {
    const dashboard = buildDashboard(items, entries, 426621.77, 2025);
    expect(dashboard.metrics.lifetimeSpend).toBe(426621.77);
    expect(dashboard.metrics.trackedItems).toBe(51);
    expect(dashboard.availableYears).toEqual([2026, 2025, 2024]);
    expect(dashboard.monthlySeries).toHaveLength(12);
  });

  it("keeps annual-only entries out of monthly charts", () => {
    const dashboard = buildDashboard(items, entries, 426621.77, 2025);
    const monthlyTotal = dashboard.monthlySeries.reduce((total, month) => total + month.spend, 0);
    const expectedMonthlyTotal = entries
      .filter((entry) => entry.periodKind === "month" && entry.periodStart.startsWith("2025"))
      .reduce((total, entry) => total + entry.amount, 0);
    expect(monthlyTotal).toBeCloseTo(expectedMonthlyTotal, 8);
    expect(dashboard.metrics.annualOnlySpend).not.toBe(0);
  });
});
