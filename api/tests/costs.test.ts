import { describe, expect, it } from "vitest";
import {
  buildRecurringTableView,
  summarizeItems,
  updateEntry,
} from "../src/lib/costs.js";
import type { EntryRecord, ItemRecord } from "../src/lib/models.js";

const item: ItemRecord = {
  id: 1,
  name: "Example Service",
  category: "Platform",
  billingType: "recurring",
  plan: null,
  url: null,
  account: null,
  powerWatts: null,
  status: "active",
  closedAt: null,
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const entry = (
  overrides: Partial<EntryRecord & { membership: string | null }> = {},
): EntryRecord & { membership: string | null } => ({
  id: 1,
  itemId: item.id,
  amount: 99.9,
  currency: "TRY",
  periodStart: "2026-01-01",
  periodKind: "month",
  membership: null,
  note: null,
  sourceRef: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("cost item summaries", () => {
  it("uses period date then entry id to derive the current membership", () => {
    const result = summarizeItems([item], [
      entry({ id: 1, periodStart: "2026-01-01", membership: "Basic" }),
      entry({ id: 3, periodStart: "2026-02-01", membership: "Pro" }),
      entry({ id: 2, periodStart: "2026-02-01", membership: "Team" }),
    ])[0];

    expect(result.currentMembership).toBe("Pro");
    expect(result.latestEntryId).toBe(3);
  });

  it("falls back to the legacy plan when the latest membership is absent", () => {
    const [result] = summarizeItems(
      [{ ...item, plan: "Legacy" }],
      [entry({ membership: null })],
    );

    expect(result.currentMembership).toBe("Legacy");
  });
});

describe("ledger entry updates", () => {
  it("merges editable fields while preserving identity and source metadata", () => {
    const existing = entry({
      id: 42,
      membership: "Basic",
      sourceRef: "seed:platform-1:2026-02",
      createdAt: "2026-02-01T00:00:00.000Z",
    });

    expect(
      updateEntry(existing, {
        amount: 149.9,
        periodStart: "2026-03-01",
        periodKind: "month",
        membership: "Professional",
        note: "Price change",
      }),
    ).toEqual({
      ...existing,
      amount: 149.9,
      periodStart: "2026-03-01",
      periodKind: "month",
      membership: "Professional",
      note: "Price change",
    });
  });

  it("normalizes money, currency, and blank optional values", () => {
    const existing = entry({ membership: "Basic", note: "Previous note" });

    const result = updateEntry(existing, {
      amount: 149.999,
      currency: "try",
      periodStart: "2026-03-01",
      periodKind: "adjustment",
      membership: "   ",
      note: "",
    });

    expect(result.amount).toBe(150);
    expect(result.currency).toBe("TRY");
    expect(result.membership).toBeNull();
    expect(result.note).toBeNull();
  });

  it("accepts explicit null optional values from the PATCH contract", () => {
    const existing = entry({ membership: "Basic", note: "Previous note" });

    const result = updateEntry(existing, {
      amount: existing.amount,
      currency: existing.currency,
      periodStart: existing.periodStart,
      periodKind: existing.periodKind,
      membership: null,
      note: null,
    });

    expect(result.membership).toBeNull();
    expect(result.note).toBeNull();
  });
});

describe("active recurring table view", () => {
  it("builds a literal rolling window with carried membership and totals", () => {
    const activeRecurring = {
      ...item,
      id: 1,
      name: "Alpha Service",
      plan: "Legacy",
    };
    const secondRecurring = {
      ...item,
      id: 2,
      name: "Beta Service",
      plan: "Starter",
    };
    const closedRecurring = {
      ...item,
      id: 3,
      name: "Closed Service",
      status: "closed" as const,
    };
    const activeAnnual = {
      ...item,
      id: 4,
      name: "Annual Service",
      billingType: "annual" as const,
    };
    const activeOneTime = {
      ...item,
      id: 5,
      name: "One-time Service",
      billingType: "one_time" as const,
    };

    const result = buildRecurringTableView(
      [
        activeRecurring,
        secondRecurring,
        closedRecurring,
        activeAnnual,
        activeOneTime,
      ],
      [
        entry({
          id: 1,
          itemId: 1,
          amount: 10,
          periodStart: "2025-06-15",
          membership: "Basic",
        }),
        entry({
          id: 2,
          itemId: 1,
          amount: 20,
          periodStart: "2026-04-01",
          membership: "Pro",
        }),
        entry({
          id: 3,
          itemId: 1,
          amount: 5,
          periodStart: "2026-04-15",
          membership: "Team",
        }),
        entry({
          id: 4,
          itemId: 1,
          amount: 999,
          periodStart: "2026-05-01",
          periodKind: "adjustment",
          membership: "Enterprise",
        }),
        entry({
          id: 5,
          itemId: 2,
          amount: 7,
          periodStart: "2026-03-01",
          membership: "Plus",
        }),
        entry({
          id: 6,
          itemId: 2,
          amount: 3,
          periodStart: "2026-04-01",
          membership: "Plus",
        }),
        entry({
          id: 7,
          itemId: 3,
          amount: 100,
          periodStart: "2026-04-01",
        }),
        entry({
          id: 8,
          itemId: 4,
          amount: 200,
          periodStart: "2026-04-01",
        }),
        entry({
          id: 9,
          itemId: 5,
          amount: 300,
          periodStart: "2026-04-01",
        }),
      ],
    );

    expect(result.periods).toHaveLength(12);
    expect(result.periods[0].key).toBe("2025-05");
    expect(result.periods[11].key).toBe("2026-04");
    expect(result.rows.map((row) => row.name)).toEqual([
      "Alpha Service",
      "Beta Service",
    ]);
    expect(result.rows[0].cells[0].membership).toBe("Legacy");
    expect(result.rows[0].cells[1]).toMatchObject({ amount: 10, membership: "Basic" });
    expect(result.rows[0].cells[10].membership).toBe("Basic");
    expect(result.rows[0].cells[11]).toMatchObject({ amount: 25, membership: "Team" });
    expect(result.rows[0].currentMembership).toBe("Enterprise");
    expect(result.rows.map((row) => row.total)).toEqual([35, 10]);
    expect(result.monthlyTotals).toEqual([0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 7, 28]);
    expect(result.grandTotal).toBe(45);
  });

  it("ends at the current UTC month when no monthly entry exists", () => {
    const result = buildRecurringTableView(
      [{ ...item, plan: "Legacy" }],
      [],
      new Date("2026-08-20T12:00:00.000Z"),
    );

    expect(result.periods[0].key).toBe("2025-09");
    expect(result.periods[11].key).toBe("2026-08");
    expect(result.rows[0].cells.every((cell) => cell.membership === "Legacy")).toBe(true);
    expect(result.grandTotal).toBe(0);
  });
});
