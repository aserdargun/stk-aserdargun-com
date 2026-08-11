import type {
  CostItemSummaryRecord,
  EntryRecord,
  ItemRecord,
  PeriodKind,
  RecurringTablePeriod,
  RecurringTableViewData,
} from "./models.js";

const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function latestEntry(entries: EntryRecord[]): EntryRecord | null {
  return entries.reduce<EntryRecord | null>(
    (latest, entry) =>
      !latest ||
      entry.periodStart > latest.periodStart ||
      (entry.periodStart === latest.periodStart && entry.id > latest.id)
        ? entry
        : latest,
    null,
  );
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
      lifetimeSpend: round(
        itemEntries.reduce((total, entry) => total + entry.amount, 0),
      ),
      entryCount: itemEntries.length,
      latestPeriod: latest?.periodStart || null,
      currentMembership: latest?.membership ?? item.plan,
      latestEntryId: latest?.id || null,
    };
  });
}

export interface EntryUpdate {
  amount: number;
  currency?: string;
  periodStart: string;
  periodKind: PeriodKind;
  membership?: string | null;
  note?: string | null;
}

const normalizedOptional = (
  value: string | null | undefined,
  current: string | null,
) => (value === undefined ? current : value?.trim() || null);

export function updateEntry(
  existing: EntryRecord,
  fields: EntryUpdate,
): EntryRecord {
  return {
    ...existing,
    amount: round(fields.amount),
    currency: (fields.currency ?? existing.currency).trim().toUpperCase(),
    periodStart: fields.periodStart,
    periodKind: fields.periodKind,
    membership: normalizedOptional(fields.membership, existing.membership),
    note: normalizedOptional(fields.note, existing.note),
  };
}

const monthIndex = (periodKey: string) => {
  const year = Number(periodKey.slice(0, 4));
  const month = Number(periodKey.slice(5, 7));
  return year * 12 + month - 1;
};

const periodFromIndex = (index: number): RecurringTablePeriod => {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return {
    key,
    label: new Intl.DateTimeFormat("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(year, month - 1, 1))),
  };
};

export function buildRecurringTableView(
  items: ItemRecord[],
  entries: EntryRecord[],
  now = new Date(),
): RecurringTableViewData {
  const latestMonthlyPeriod = entries
    .filter((entry) => entry.periodKind === "month")
    .map((entry) => entry.periodStart.slice(0, 7))
    .sort()
    .at(-1);
  const endPeriod =
    latestMonthlyPeriod ||
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const endIndex = monthIndex(endPeriod);
  const periods = Array.from({ length: 12 }, (_, index) =>
    periodFromIndex(endIndex - 11 + index),
  );
  const entriesByItem = new Map<number, EntryRecord[]>();

  for (const entry of entries) {
    const itemEntries = entriesByItem.get(entry.itemId) || [];
    itemEntries.push(entry);
    entriesByItem.set(entry.itemId, itemEntries);
  }

  const rows = items
    .filter(
      (item) => item.status === "active" && item.billingType === "recurring",
    )
    .map((item) => {
      const itemEntries = [...(entriesByItem.get(item.id) || [])].sort(
        (left, right) =>
          left.periodStart.localeCompare(right.periodStart) || left.id - right.id,
      );
      let chronologyIndex = 0;
      let effectiveEntry: EntryRecord | null = null;
      const cells = periods.map((period) => {
        while (
          chronologyIndex < itemEntries.length &&
          itemEntries[chronologyIndex].periodStart.slice(0, 7) <= period.key
        ) {
          effectiveEntry = itemEntries[chronologyIndex];
          chronologyIndex += 1;
        }

        return {
          period: period.key,
          amount: round(
            itemEntries
              .filter(
                (entry) =>
                  entry.periodKind === "month" &&
                  entry.periodStart.slice(0, 7) === period.key,
              )
              .reduce((total, entry) => total + entry.amount, 0),
          ),
          membership: effectiveEntry?.membership ?? item.plan,
        };
      });
      const latest = latestEntry(itemEntries);

      return {
        id: item.id,
        name: item.name,
        currentMembership: latest?.membership ?? item.plan,
        cells,
        total: round(cells.reduce((total, cell) => total + cell.amount, 0)),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.id - right.id);

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
