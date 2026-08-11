import { describe, expect, it } from "vitest";
import {
  buildRecurringTableView,
  summarizeItems,
  updateEntry,
} from "../src/lib/costs.js";
import type { EntryRecord, ItemRecord } from "../src/lib/models.js";

const item = (overrides: Partial<ItemRecord> = {}): ItemRecord => ({
  id: 1,
  name: "Example Cloud",
  category: "Platform",
  billingType: "recurring",
  plan: "Legacy",
  url: null,
  account: null,
  powerWatts: null,
  status: "active",
  closedAt: null,
  notes: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

const entry = (overrides: Partial<EntryRecord> = {}): EntryRecord => ({
  id: 1,
  itemId: 1,
  amount: 100,
  currency: "TRY",
  periodStart: "2026-01-01",
  periodKind: "month",
  membership: "Basic",
  note: null,
  sourceRef: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("cost membership summaries", () => {
  it("uses period date then entry id to derive the current membership", () => {
    const result = summarizeItems(
      [item()],
      [
        entry({ id: 1, periodStart: "2026-01-01", membership: "Basic" }),
        entry({ id: 3, periodStart: "2026-02-01", membership: "Pro" }),
        entry({ id: 2, periodStart: "2026-02-01", membership: "Team" }),
      ],
    )[0];

    expect(result.currentMembership).toBe("Pro");
    expect(result.latestEntryId).toBe(3);
    expect(result.latestPeriod).toBe("2026-02-01");
    expect(result.lifetimeSpend).toBe(300);
  });

  it("falls back to the legacy plan when the latest membership is absent", () => {
    const result = summarizeItems(
      [item({ plan: "Legacy Membership" })],
      [entry({ membership: null })],
    )[0];

    expect(result.currentMembership).toBe("Legacy Membership");
  });
});

describe("ledger entry updates", () => {
  it("merges editable fields while preserving identity and source metadata", () => {
    const existing = entry({
      id: 42,
      itemId: 7,
      amount: 99,
      membership: "Basic",
      sourceRef: "Platforms!E2",
      createdAt: "2025-02-01T10:20:30.000Z",
    });

    expect(
      updateEntry(existing, {
        amount: 149.899,
        currency: "try",
        periodStart: "2026-03-01",
        periodKind: "month",
        membership: "  Professional  ",
        note: "  Price change  ",
      }),
    ).toEqual({
      ...existing,
      amount: 149.9,
      currency: "TRY",
      periodStart: "2026-03-01",
      periodKind: "month",
      membership: "Professional",
      note: "Price change",
    });
  });
});

describe("active recurring Table View", () => {
  it("builds a latest-data rolling 12-month matrix with memberships and totals", () => {
    const items = [
      item({ id: 1, name: "Alpha", plan: "Fallback" }),
      item({ id: 2, name: "Beta", plan: "Starter" }),
      item({ id: 3, name: "Closed", status: "closed" }),
      item({ id: 4, name: "Annual", billingType: "annual" }),
    ];
    const entries = [
      entry({ id: 1, itemId: 1, amount: 10, periodStart: "2025-03-01", membership: "Basic" }),
      entry({ id: 2, itemId: 1, amount: 20, periodStart: "2026-01-01", membership: "Pro" }),
      entry({ id: 3, itemId: 1, amount: 5, periodStart: "2026-01-15", membership: "Pro Plus" }),
      entry({ id: 4, itemId: 2, amount: 30, periodStart: "2025-12-01", membership: "Team" }),
      entry({ id: 5, itemId: 3, amount: 99, periodStart: "2026-01-01" }),
      entry({ id: 6, itemId: 4, amount: 77, periodStart: "2026-01-01" }),
    ];

    const result = buildRecurringTableView(items, entries, new Date("2030-06-01T00:00:00Z"));

    expect(result.periods).toHaveLength(12);
    expect(result.periods[0].key).toBe("2025-02");
    expect(result.periods[11].key).toBe("2026-01");
    expect(result.rows.map((row) => row.id)).toEqual([1, 2]);
    expect(result.rows[0].cells[0]).toEqual({
      period: "2025-02",
      amount: 0,
      membership: "Fallback",
    });
    expect(result.rows[0].cells[1].amount).toBe(10);
    expect(result.rows[0].cells[11]).toEqual({
      period: "2026-01",
      amount: 25,
      membership: "Pro Plus",
    });
    expect(result.rows[0].currentMembership).toBe("Pro Plus");
    expect(result.rows[0].total).toBe(35);
    expect(result.rows[1].cells[11].membership).toBe("Team");
    expect(result.monthlyTotals[1]).toBe(10);
    expect(result.monthlyTotals[10]).toBe(30);
    expect(result.monthlyTotals[11]).toBe(25);
    expect(result.grandTotal).toBe(65);
  });
});
