export type Category = "Platform" | "Certificate" | "Device" | "Other";
export type BillingType = "recurring" | "annual" | "one_time";
export type ItemStatus = "active" | "closed";
export type PeriodKind = "month" | "year" | "one_time" | "adjustment";

export interface SeedItem {
  key: string;
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
}

export interface SeedEntry {
  itemKey: string;
  amount: number;
  currency: string;
  periodStart: string;
  periodKind: PeriodKind;
  note: string | null;
  sourceRef: string | null;
}

export interface SeedPayload {
  metadata: Record<string, unknown>;
  items: SeedItem[];
  entries: SeedEntry[];
}
