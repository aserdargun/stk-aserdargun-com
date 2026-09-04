export const formatMoney = (value: number, compact = false) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "TRY",
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);

const legacyServiceNames: Record<string, string> = {
  Turknet: "TurkNet",
  Youtube: "YouTube",
  Linkedin: "LinkedIn",
  Github: "GitHub",
  Huggingface: "Hugging Face",
  Elevenlabs: "ElevenLabs",
  capcut: "CapCut",
  "iPad Wifi 128GB A16 + Apple Pencil USB-C": "iPad Wi-Fi 128GB A16 + Apple Pencil USB-C",
};

const legacyMemberships: Record<string, string> = {
  "Github Pro": "GitHub Pro",
  "Premium(2TB)": "Premium (2 TB)",
  "1Gbit": "1 Gbps",
};

export const formatDate = (date: string | null, options?: Intl.DateTimeFormatOptions) => {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(options ?? { year: "numeric", month: "short", day: "numeric" }),
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
};

export const formatPeriodDate = (date: string | null, periodKind: string) => {
  if (periodKind === "month") {
    return formatDate(date, { month: "short", year: "numeric" });
  }
  if (periodKind === "year") return formatDate(date, { year: "numeric" });
  return formatDate(date);
};

export const formatServiceName = (value: string) => legacyServiceNames[value] || value;

export const normalizeMembership = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized && !["-", "—"].includes(normalized) ? normalized : null;
};

export const formatMembership = (value: string | null | undefined, empty = "Not set") => {
  const normalized = normalizeMembership(value);
  return normalized ? legacyMemberships[normalized] || normalized : empty;
};

export const formatBillingType = (value: string) =>
  ({ recurring: "Recurring", annual: "Annual", one_time: "One-time" })[value] || value;

export const formatPeriodKind = (value: string) =>
  ({ month: "Monthly", year: "Annual total", one_time: "One-time", adjustment: "Reconciliation" })[
    value
  ] || value;
