import type { EntryRecord, ItemRecord } from "./models.js";

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildDashboard(
  items: ItemRecord[],
  entries: EntryRecord[],
  sourceGrandTotal: number | null,
  requestedYear?: number,
) {
  const availableYears = [...new Set(entries.map((entry) => Number(entry.periodStart.slice(0, 4))))]
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const year = requestedYear && availableYears.includes(requestedYear) ? requestedYear : availableYears[0];
  const selectedYear = year ?? new Date().getUTCFullYear();
  const previousYear = selectedYear - 1;
  const entriesForYear = entries.filter((entry) => entry.periodStart.startsWith(String(selectedYear)));
  const previousEntries = entries.filter((entry) => entry.periodStart.startsWith(String(previousYear)));
  const lifetimeSpend = entries.reduce((total, entry) => total + entry.amount, 0);
  const yearSpend = entriesForYear.reduce((total, entry) => total + entry.amount, 0);
  const previousYearSpend = previousEntries.reduce((total, entry) => total + entry.amount, 0);
  const monthlyEntries = entries.filter((entry) => entry.periodKind === "month");
  const latestMonthlyPeriod = monthlyEntries
    .map((entry) => entry.periodStart.slice(0, 7))
    .sort()
    .at(-1);
  const latestMonthlySpend = latestMonthlyPeriod
    ? monthlyEntries
        .filter((entry) => entry.periodStart.startsWith(latestMonthlyPeriod))
        .reduce((total, entry) => total + entry.amount, 0)
    : 0;
  const itemById = new Map(items.map((item) => [item.id, item]));

  const monthlySeries = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = String(index + 1).padStart(2, "0");
    const period = `${selectedYear}-${monthNumber}-01`;
    return {
      period,
      month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
        new Date(`${period}T00:00:00Z`),
      ),
      spend: round(
        entriesForYear
          .filter((entry) => entry.periodKind === "month" && entry.periodStart.slice(5, 7) === monthNumber)
          .reduce((total, entry) => total + entry.amount, 0),
      ),
    };
  });

  const yearlySeries = [...availableYears]
    .sort((a, b) => a - b)
    .map((entryYear) => ({
      year: String(entryYear),
      spend: round(
        entries
          .filter((entry) => entry.periodStart.startsWith(String(entryYear)))
          .reduce((total, entry) => total + entry.amount, 0),
      ),
    }));

  const summarizeCategories = (sourceEntries: EntryRecord[]) => {
    const totals = new Map<string, number>();
    for (const entry of sourceEntries) {
      const category = itemById.get(entry.itemId)?.category;
      if (category) totals.set(category, (totals.get(category) || 0) + entry.amount);
    }
    return [...totals.entries()]
      .map(([category, spend]) => ({ category, spend: round(spend) }))
      .sort((a, b) => b.spend - a.spend);
  };

  const itemTotals = new Map<number, number>();
  for (const entry of entriesForYear) {
    itemTotals.set(entry.itemId, (itemTotals.get(entry.itemId) || 0) + entry.amount);
  }

  return {
    year: selectedYear,
    availableYears,
    metrics: {
      lifetimeSpend: round(lifetimeSpend),
      yearSpend: round(yearSpend),
      previousYearSpend: round(previousYearSpend),
      yearOverYearPercent:
        previousYearSpend === 0 ? null : round(((yearSpend - previousYearSpend) / Math.abs(previousYearSpend)) * 100),
      trackedItems: items.length,
      activeItems: items.filter((item) => item.status === "active").length,
      closedItems: items.filter((item) => item.status === "closed").length,
      latestMonthlySpend: round(latestMonthlySpend),
      latestMonthlyPeriod: latestMonthlyPeriod ? `${latestMonthlyPeriod}-01` : null,
      annualOnlySpend: round(
        entriesForYear
          .filter((entry) => ["year", "one_time", "adjustment"].includes(entry.periodKind))
          .reduce((total, entry) => total + entry.amount, 0),
      ),
      sourceGrandTotal,
    },
    monthlySeries,
    yearlySeries,
    categorySeries: summarizeCategories(entriesForYear),
    lifetimeCategories: summarizeCategories(entries),
    topItems: [...itemTotals.entries()]
      .map(([id, spend]) => ({ item: itemById.get(id), spend: round(spend) }))
      .filter((entry): entry is { item: ItemRecord; spend: number } => Boolean(entry.item))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 7)
      .map(({ item, spend }) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        status: item.status,
        spend,
      })),
  };
}
