export const formatMoney = (value: number, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "TRY",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);

export const formatDate = (date: string | null, options?: Intl.DateTimeFormatOptions) => {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
};

export const formatBillingType = (value: string) =>
  ({ recurring: "Recurring", annual: "Annual", one_time: "One-time" })[value] || value;

export const formatPeriodKind = (value: string) =>
  ({ month: "Monthly", year: "Annual total", one_time: "One-time", adjustment: "Reconciliation" })[
    value
  ] || value;
