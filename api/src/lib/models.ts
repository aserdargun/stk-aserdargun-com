export type Category = "Platform" | "Certificate" | "Device" | "Other";
export type BillingType = "recurring" | "annual" | "one_time";
export type ItemStatus = "active" | "closed";
export type PeriodKind = "month" | "year" | "one_time" | "adjustment";

export interface ItemRecord {
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
  createdAt: string;
  updatedAt: string;
}

export interface EntryRecord {
  id: number;
  itemId: number;
  amount: number;
  currency: string;
  periodStart: string;
  periodKind: PeriodKind;
  membership: string | null;
  note: string | null;
  sourceRef: string | null;
  createdAt: string;
}

export interface CostItemSummaryRecord extends ItemRecord {
  lifetimeSpend: number;
  entryCount: number;
  latestPeriod: string | null;
  latestEntryId: number | null;
  currentMembership: string | null;
}

export interface SeedPayload {
  metadata: Record<string, unknown>;
  items: Array<Omit<ItemRecord, "id" | "createdAt" | "updatedAt"> & { key: string }>;
  entries: Array<
    Omit<EntryRecord, "id" | "itemId" | "createdAt" | "membership"> & {
      itemKey: string;
      membership?: string | null;
    }
  >;
}

export interface LearnedMapping {
  id: string;
  pattern: string;
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
  createdAt: string;
}
