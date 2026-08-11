import type { CostEntry, CostItemSummary } from "../types";

const round = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function buildItemMonthlySeries(
  entries: CostEntry[],
  requestedYear?: number,
) {
  const monthlyEntries = entries.filter(
    (entry) => entry.periodKind === "month",
  );
  const availableYears = [
    ...new Set(
      monthlyEntries.map((entry) => Number(entry.periodStart.slice(0, 4))),
    ),
  ]
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  const year =
    requestedYear && availableYears.includes(requestedYear)
      ? requestedYear
      : availableYears[0] ?? new Date().getUTCFullYear();

  const series = Array.from({ length: 12 }, (_, index) => {
    const monthNumber = String(index + 1).padStart(2, "0");
    const period = `${year}-${monthNumber}-01`;
    return {
      period,
      month: new Intl.DateTimeFormat("en-US", {
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${period}T00:00:00Z`)),
      spend: round(
        monthlyEntries
          .filter(
            (entry) =>
              entry.periodStart.startsWith(`${year}-${monthNumber}-`),
          )
          .reduce((total, entry) => total + entry.amount, 0),
      ),
    };
  });

  return { year, availableYears, series };
}

export interface CostFilters {
  search: string;
  cost: string;
  category: string;
  billing: string;
  membership: string;
  status: string;
  latestFrom: string;
  latestTo: string;
  lifetimeMin: string;
  lifetimeMax: string;
}

export type CostSortKey =
  | "name"
  | "category"
  | "billingType"
  | "currentMembership"
  | "status"
  | "latestPeriod"
  | "lifetimeSpend";

export interface CostSort {
  key: CostSortKey;
  direction: "asc" | "desc";
}

export const emptyCostFilters: CostFilters = {
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

const normalized = (value: string | null | undefined) =>
  value?.trim().toLowerCase() || "";

function compareCostValues(
  left: string | number | null,
  right: string | number | null,
) {
  const leftMissing = left === null || left === "";
  const rightMissing = right === null || right === "";
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right), "en", {
    sensitivity: "base",
  });
}

export function filterAndSortCosts(
  items: CostItemSummary[],
  filters: CostFilters,
  sort: CostSort | null,
) {
  const search = normalized(filters.search);
  const cost = normalized(filters.cost);
  const membership = normalized(filters.membership);
  const minimum = filters.lifetimeMin.trim()
    ? Number(filters.lifetimeMin)
    : null;
  const maximum = filters.lifetimeMax.trim()
    ? Number(filters.lifetimeMax)
    : null;

  const filtered = items
    .filter(
      (item) =>
        !search ||
        [
          item.name,
          item.currentMembership,
          item.plan,
          item.account,
          item.category,
          item.billingType,
          item.status,
        ].some((value) => normalized(value).includes(search)),
    )
    .filter((item) => !cost || normalized(item.name).includes(cost))
    .filter(
      (item) => !filters.category || item.category === filters.category,
    )
    .filter(
      (item) => !filters.billing || item.billingType === filters.billing,
    )
    .filter(
      (item) =>
        !membership || normalized(item.currentMembership).includes(membership),
    )
    .filter((item) => !filters.status || item.status === filters.status)
    .filter(
      (item) =>
        !filters.latestFrom ||
        Boolean(item.latestPeriod && item.latestPeriod >= filters.latestFrom),
    )
    .filter(
      (item) =>
        !filters.latestTo ||
        Boolean(item.latestPeriod && item.latestPeriod <= filters.latestTo),
    )
    .filter(
      (item) =>
        minimum === null || !Number.isFinite(minimum) || item.lifetimeSpend >= minimum,
    )
    .filter(
      (item) =>
        maximum === null || !Number.isFinite(maximum) || item.lifetimeSpend <= maximum,
    );

  if (!sort) return filtered;

  return filtered.toSorted((left, right) => {
    const leftValue = left[sort.key];
    const rightValue = right[sort.key];
    const leftMissing = leftValue === null || leftValue === "";
    const rightMissing = rightValue === null || rightValue === "";
    if (leftMissing !== rightMissing) return leftMissing ? 1 : -1;
    const comparison = compareCostValues(leftValue, rightValue);
    return (sort.direction === "asc" ? comparison : -comparison) || left.id - right.id;
  });
}
