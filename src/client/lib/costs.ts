import type { CostEntry, CostItemSummary } from "../types";

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildItemMonthlySeries(entries: CostEntry[], requestedYear?: number) {
  const availableYears = [
    ...new Set(entries.map((entry) => Number(entry.periodStart.slice(0, 4)))),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const currentYear = new Date().getUTCFullYear();
  const year =
    requestedYear && availableYears.includes(requestedYear)
      ? requestedYear
      : availableYears[0] || currentYear;

  const series = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = String(index + 1).padStart(2, "0");
    const period = `${year}-${monthNumber}-01`;
    return {
      period,
      month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
        new Date(`${period}T00:00:00Z`),
      ),
      spend: round(
        entries
          .filter(
            (entry) =>
              entry.periodKind === "month" && entry.periodStart.startsWith(`${year}-${monthNumber}`),
          )
          .reduce((total, entry) => total + entry.amount, 0),
      ),
    };
  });

  return { year, availableYears, series };
}

export type CostSortKey =
  | "name"
  | "category"
  | "billingType"
  | "currentMembership"
  | "status"
  | "latestPeriod"
  | "lifetimeSpend";

export type CostSort = { key: CostSortKey; direction: "asc" | "desc" };

export type CostFilters = {
  search: string;
  name: string;
  category: string;
  billingType: string;
  membership: string;
  status: string;
  latestFrom: string;
  latestTo: string;
  spendMin: string;
  spendMax: string;
};

const normalized = (value: string | null | undefined) => value?.trim().toLowerCase() || "";

export function filterAndSortCosts(
  items: CostItemSummary[],
  filters: Partial<CostFilters>,
  sort: CostSort,
) {
  const search = normalized(filters.search);
  const name = normalized(filters.name);
  const membership = normalized(filters.membership);
  const spendMin = filters.spendMin ? Number(filters.spendMin) : null;
  const spendMax = filters.spendMax ? Number(filters.spendMax) : null;

  return items
    .filter((item) => {
      const searchable = [
        item.name,
        item.currentMembership,
        item.account,
        item.category,
        item.billingType,
        item.status,
      ]
        .map(normalized)
        .join(" ");
      return (
        (!search || searchable.includes(search)) &&
        (!name || normalized(item.name).includes(name)) &&
        (!filters.category || item.category === filters.category) &&
        (!filters.billingType || item.billingType === filters.billingType) &&
        (!membership || normalized(item.currentMembership).includes(membership)) &&
        (!filters.status || item.status === filters.status) &&
        (!filters.latestFrom || Boolean(item.latestPeriod && item.latestPeriod >= filters.latestFrom)) &&
        (!filters.latestTo || Boolean(item.latestPeriod && item.latestPeriod <= filters.latestTo)) &&
        (spendMin === null || !Number.isFinite(spendMin) || item.lifetimeSpend >= spendMin) &&
        (spendMax === null || !Number.isFinite(spendMax) || item.lifetimeSpend <= spendMax)
      );
    })
    .sort((left, right) => {
      const leftValue = left[sort.key];
      const rightValue = right[sort.key];
      const compared =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue || "").localeCompare(String(rightValue || ""));
      return (sort.direction === "asc" ? compared : -compared) || left.id - right.id;
    });
}
