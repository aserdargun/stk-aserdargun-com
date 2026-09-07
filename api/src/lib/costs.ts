import type { CostItemSummaryRecord, EntryRecord, ItemRecord } from "./models.js";

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const optionalText = (value: string | null | undefined) => value?.trim() || null;

export type EntryUpdate = Pick<
  EntryRecord,
  "amount" | "currency" | "periodStart" | "periodKind" | "membership" | "note"
>;

export function latestEntry(entries: EntryRecord[]): EntryRecord | null {
  return entries.reduce<EntryRecord | null>((latest, entry) => {
    if (
      !latest ||
      entry.periodStart > latest.periodStart ||
      (entry.periodStart === latest.periodStart && entry.id > latest.id)
    ) {
      return entry;
    }
    return latest;
  }, null);
}

export function summarizeItems(
  items: ItemRecord[],
  entries: EntryRecord[],
): CostItemSummaryRecord[] {
  const entriesByItem = new Map<number, EntryRecord[]>();
  for (const entry of entries) {
    const itemEntries = entriesByItem.get(entry.itemId) || [];
    itemEntries.push(entry);
    entriesByItem.set(entry.itemId, itemEntries);
  }

  return items.map((item) => {
    const itemEntries = entriesByItem.get(item.id) || [];
    const latest = latestEntry(itemEntries);
    return {
      ...item,
      lifetimeSpend: round(itemEntries.reduce((total, entry) => total + entry.amount, 0)),
      entryCount: itemEntries.length,
      latestPeriod: latest?.periodStart || null,
      latestEntryId: latest?.id || null,
      currentMembership: latest?.membership || item.plan,
    };
  });
}

export function updateEntry(existing: EntryRecord, update: EntryUpdate): EntryRecord {
  return {
    ...existing,
    amount: round(update.amount),
    currency: update.currency.trim().toUpperCase(),
    periodStart: update.periodStart,
    periodKind: update.periodKind,
    membership: optionalText(update.membership),
    note: optionalText(update.note),
  };
}

const monthKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

export function buildRecurringTableView(
  items: ItemRecord[],
  entries: EntryRecord[],
  now = new Date(),
) {
  // Table View mirrors the Costs page: every active cost item is a row,
  // regardless of billing type. Recurring subscriptions fill the 12-month
  // grid monthly; one-time charges and annual entries land in the month of
  // their periodStart and leave the rest of the row empty. Closed items
  // are excluded so the table stays in sync with the active portfolio.
  const activeItems = items
    .filter((item) => item.status === "active")
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);
  const activeIds = new Set(activeItems.map((item) => item.id));
  const anchorEntry = latestEntry(
    entries.filter((entry) => activeIds.has(entry.itemId)),
  );
  const anchor = anchorEntry
    ? new Date(`${anchorEntry.periodStart.slice(0, 7)}-01T00:00:00Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periods = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 11 + index, 1));
    return {
      key: monthKey(date),
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      }).format(date),
    };
  });
  const entriesByItem = new Map<number, EntryRecord[]>();
  for (const entry of entries) {
    const itemEntries = entriesByItem.get(entry.itemId) || [];
    itemEntries.push(entry);
    entriesByItem.set(entry.itemId, itemEntries);
  }

  const rows = activeItems.map((item) => {
    const itemEntries = entriesByItem.get(item.id) || [];
    const current = latestEntry(itemEntries);
    const cells = periods.map((period) => {
      const effective = latestEntry(
        itemEntries.filter((entry) => entry.periodStart.slice(0, 7) <= period.key),
      );
      return {
        period: period.key,
        amount: round(
          itemEntries
            .filter((entry) => entry.periodStart.slice(0, 7) === period.key)
            .reduce((total, entry) => total + entry.amount, 0),
        ),
        membership: effective?.membership || item.plan,
      };
    });
    return {
      id: item.id,
      name: item.name,
      currentMembership: current?.membership || item.plan,
      cells,
      total: round(cells.reduce((total, cell) => total + cell.amount, 0)),
    };
  });
  const monthlyTotals = periods.map((_, index) =>
    round(rows.reduce((total, row) => total + row.cells[index].amount, 0)),
  );

  return {
    periods,
    rows,
    monthlyTotals,
    grandTotal: round(monthlyTotals.reduce((total, amount) => total + amount, 0)),
  };
}
