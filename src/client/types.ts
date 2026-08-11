export type Category = "Platform" | "Certificate" | "Device" | "Other";
export type BillingType = "recurring" | "annual" | "one_time";
export type ItemStatus = "active" | "closed";
export type PeriodKind = "month" | "year" | "one_time" | "adjustment";

export interface DashboardData {
  year: number;
  availableYears: number[];
  metrics: {
    lifetimeSpend: number;
    yearSpend: number;
    previousYearSpend: number;
    yearOverYearPercent: number | null;
    trackedItems: number;
    activeItems: number;
    closedItems: number;
    latestMonthlySpend: number;
    latestMonthlyPeriod: string | null;
    annualOnlySpend: number;
    sourceGrandTotal: number | null;
  };
  monthlySeries: Array<{ period: string; month: string; spend: number }>;
  yearlySeries: Array<{ year: string; spend: number }>;
  categorySeries: Array<{ category: Category; spend: number }>;
  lifetimeCategories: Array<{ category: Category; spend: number }>;
  topItems: Array<{
    id: number;
    name: string;
    category: Category;
    status: ItemStatus;
    spend: number;
  }>;
}

export interface CostItemSummary {
  id: number;
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
  powerWatts: number | null;
  status: ItemStatus;
  closedAt: string | null;
  notes: string | null;
  lifetimeSpend: number;
  entryCount: number;
  latestPeriod: string | null;
  latestEntryId: number | null;
  currentMembership: string | null;
}

export interface CostEntry {
  id: number;
  amount: number;
  currency: string;
  periodStart: string;
  periodKind: PeriodKind;
  membership: string | null;
  note: string | null;
  sourceRef: string | null;
  createdAt: string;
}

export interface ItemDetail {
  item: Omit<CostItemSummary, "lifetimeSpend" | "entryCount" | "latestPeriod"> & {
    createdAt: string;
    updatedAt: string;
  };
  entries: CostEntry[];
}

export interface TableViewData {
  periods: Array<{ key: string; label: string }>;
  rows: Array<{
    id: number;
    name: string;
    currentMembership: string | null;
    cells: Array<{ period: string; amount: number; membership: string | null }>;
    total: number;
  }>;
  monthlyTotals: number[];
  grandTotal: number;
}

export interface NewCostPayload {
  name: string;
  category: Category;
  billingType: BillingType;
  plan?: string;
  url?: string;
  account?: string;
  powerWatts?: number | null;
  status: ItemStatus;
  notes?: string;
  initialEntry?: {
    amount: number;
    currency: string;
    periodStart: string;
    periodKind: Exclude<PeriodKind, "adjustment">;
    membership?: string;
    note?: string;
  };
}
