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

export interface StatementImportPreview {
  preview: true;
  fileName: string;
  cutoffDate: string | null;
  charges: Array<{ name: string; date: string; amount: number; description: string }>;
  newItems: Array<{
    serviceKey: string;
    name: string;
    category: Category;
    billingType: BillingType;
    plan: string | null;
    url: string | null;
    account: string | null;
  }>;
  newEntries: Array<{
    serviceKey: string;
    name: string;
    itemId: number | null;
    amount: number;
    currency: string;
    periodStart: string;
    periodKind: string;
    membership: string | null;
    note: string;
    sourceRef: string;
  }>;
  matchedCount: number;
  unclassified: Array<{ date: string; amount: number; description: string }>;
  summary: { charges: number; newItems: number; newEntries: number; matched: number };
}

export interface StatementImportResult {
  applied: true;
  itemsCreated: number;
  entriesCreated: number;
  matchedSkipped: number;
  summary: { charges: number; newItems: number; newEntries: number; matched: number };
}
