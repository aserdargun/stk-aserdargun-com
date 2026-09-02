import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  BillingType,
  Category,
  EntryRecord,
  ItemRecord,
  LearnedMapping,
  PeriodKind,
} from "./models.js";
import type { TableRepository } from "./storage.js";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];
const MONTH_INDEX = Object.fromEntries(MONTH_NAMES.map((name, index) => [name, index + 1]));

const TRANSACTION_RE = new RegExp(`^(\\d{2}) (${MONTH_NAMES.join("|")}) (\\d{4})\\s+(.*)$`);
const AMOUNT_RE = /([+-]?)(\d[\d.]*,\d{2})/;

interface CatalogService {
  key: string;
  name: string;
  itemKey: string | null;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
  patterns: string[];
  _patterns?: RegExp[];
}

interface Catalog {
  services: CatalogService[];
}

interface StatementTransaction {
  date: string;
  description: string;
  amount: number;
}

interface StatementCharge {
  date: string;
  amount: number;
  description: string;
  service: CatalogService;
  cutoffDate: string | null;
  sourceFile: string;
}

export interface PreviewNewItem {
  serviceKey: string;
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
}

export interface PreviewNewEntry {
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
}

export interface ManualMappingPayload {
  date: string;
  amount: number;
  description: string;
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
  pattern: string | null;
}

export interface ManualMappingResult {
  applied: number;
  patterns: string[];
}

export interface StatementImportPreview {
  fileName: string;
  cutoffDate: string | null;
  charges: Array<{ name: string; date: string; amount: number; description: string }>;
  newItems: PreviewNewItem[];
  newEntries: PreviewNewEntry[];
  matchedCount: number;
  unclassified: Array<{ date: string; amount: number; description: string }>;
  summary: { charges: number; newItems: number; newEntries: number; matched: number };
}

export function parseAmount(raw: string): number | null {
  const match = AMOUNT_RE.exec(raw);
  if (!match) return null;
  const sign = match[1] === "+" || match[1] === "-" ? -1 : 1;
  const value = Number(match[2].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? sign * value : null;
}

function toIsoDate(day: string, monthName: string, year: string): string {
  return `${year}-${String(MONTH_INDEX[monthName]).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

function reconstructLines(items: Array<{ str: string; transform: number[] }>): string[] {
  const glyphs = items.filter((item) => item.str && item.str.trim().length > 0);
  const sorted = [...glyphs].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  );
  const lines: Array<Array<{ str: string; transform: number[] }>> = [];
  let current: Array<{ str: string; transform: number[] }> = [];
  let baseline: number | null = null;
  for (const glyph of sorted) {
    const y = glyph.transform[5];
    if (baseline === null || Math.abs(y - baseline) > 1) {
      current = [];
      lines.push(current);
      baseline = y;
    }
    current.push(glyph);
  }
  return lines.map((line) =>
    line
      .sort((a, b) => a.transform[4] - b.transform[4])
      .map((glyph) => glyph.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

async function extractPdfLines(base64Data: string): Promise<string[]> {
  const base64 = base64Data.includes(",") ? base64Data.slice(base64Data.indexOf(",") + 1) : base64Data;
  const data = new Uint8Array(Buffer.from(base64, "base64"));
  const document = await getDocument({ data, disableFontFace: true }).promise;
  const lines: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    lines.push(...reconstructLines(content.items));
  }
  return lines;
}

export function parseStatementLines(lines: string[]): {
  cutoffDate: string | null;
  transactions: StatementTransaction[];
} {
  let cutoffDate: string | null = null;
  for (const line of lines) {
    if (!cutoffDate && /^\s*Hesap Kesim Tarihi\s*:/i.test(line)) {
      const value = line.replace(/^.*?:\s*/, "");
      const match = new RegExp(`([0-9]{1,2})\\s+(${MONTH_NAMES.join("|")})\\s+([0-9]{4})`).exec(value);
      if (match) cutoffDate = toIsoDate(match[1], match[2], match[3]);
    }
  }

  const transactions: StatementTransaction[] = [];
  for (const line of lines) {
    const match = TRANSACTION_RE.exec(line);
    if (!match) continue;
    const amount = parseAmount(match[4]);
    if (amount === null) continue;
    transactions.push({
      date: toIsoDate(match[1], match[2], match[3]),
      description: match[4].trim(),
      amount,
    });
  }
  return { cutoffDate, transactions };
}

export function compileServices(services: CatalogService[]): CatalogService[] {
  return services.map((service) => ({
    ...service,
    _patterns: service.patterns.map((pattern) => new RegExp(pattern, "i")),
  }));
}

export function classifyDescription(
  description: string,
  services: CatalogService[],
): CatalogService | null {
  const upper = description.toUpperCase();
  for (const service of services) {
    for (const pattern of service._patterns ?? []) {
      if (pattern.test(upper)) return service;
    }
  }
  return null;
}

const isOnlineCandidate = (description: string) =>
  /\.(com|io|dev|ai|app|net|org|co|cloud|tech)\b/i.test(description) ||
  /(SUBSCR|BILL|CLOUD|PREMIUM)/i.test(description);

async function loadCatalog(repo: TableRepository): Promise<CatalogService[]> {
  const raw = await readFile(new URL("../data/card-digital-services.json", import.meta.url), "utf8");
  const catalog = JSON.parse(raw) as Catalog;
  const baseServices = compileServices(catalog.services);
  const learned = await repo.listLearnedMappings();
  const learnedServices = compileServices(learnedToServices(learned));
  return [...baseServices, ...learnedServices];
}

function learnedToServices(learned: LearnedMapping[]): CatalogService[] {
  return learned.map((mapping) => ({
    key: `learned:${mapping.id}`,
    name: mapping.name,
    itemKey: null,
    category: mapping.category,
    billingType: mapping.billingType,
    plan: mapping.plan,
    url: mapping.url,
    account: mapping.account,
    patterns: [escapeForContainsRegex(mapping.pattern)],
  }));
}

const REGEX_RESERVED = /[.*+?^${}()|[\]\\]/g;
function escapeForContainsRegex(value: string): string {
  return value.replace(REGEX_RESERVED, "\\$&");
}

export function extractLearnedPattern(description: string): string {
  const tokens = description
    .replace(/\d+/g, " ")
    .split(/[\s/]+/)
    .map((token) => token.replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü*]+|[^A-Za-zÇĞİÖŞÜçğıöşü*]+$/g, ""))
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) {
    return description.trim().toUpperCase().slice(0, 24) || "UNKNOWN";
  }
  return tokens[0].toUpperCase();
}

export function buildLearnedMapping(input: {
  description: string;
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
  pattern?: string;
}): LearnedMapping {
  const pattern = (input.pattern && input.pattern.trim()) || extractLearnedPattern(input.description);
  return {
    id: randomUUID(),
    pattern: pattern.toUpperCase().trim(),
    name: input.name.trim(),
    category: input.category,
    billingType: input.billingType,
    plan: input.plan?.trim() || null,
    url: input.url?.trim() || null,
    account: input.account?.trim() || null,
    createdAt: new Date().toISOString(),
  };
}

export function resolveItem(items: ItemRecord[], service: CatalogService): {
  id: number | null;
  missing: boolean;
} {
  const nameMatches = items.filter(
    (item) => item.name.trim().toLowerCase() === service.name.trim().toLowerCase(),
  );
  if (nameMatches.length === 0) return { id: null, missing: true };
  if (nameMatches.length === 1) return { id: nameMatches[0].id, missing: false };

  const planMatches = nameMatches.filter(
    (item) => (item.plan ?? "").trim().toLowerCase() === (service.plan ?? "").trim().toLowerCase(),
  );
  if (planMatches.length === 1) return { id: planMatches[0].id, missing: false };

  const accountMatches = nameMatches.filter(
    (item) => (item.account ?? "").trim().toLowerCase() === (service.account ?? "").trim().toLowerCase(),
  );
  if (accountMatches.length === 1) return { id: accountMatches[0].id, missing: false };

  return { id: null, missing: false };
}

function chargeToEntry(
  itemId: number | null,
  charge: StatementCharge,
  service: CatalogService,
): PreviewNewEntry {
  const oneTime = service.billingType === "one_time";
  const membership =
    service.plan && service.plan !== "-" && service.plan !== "None" ? service.plan : null;
  return {
    serviceKey: service.key,
    name: service.name,
    itemId,
    amount: round2(charge.amount),
    currency: "TRY",
    periodStart: oneTime ? charge.date : `${charge.date.slice(0, 7)}-01`,
    periodKind: oneTime ? "one_time" : "month",
    membership,
    note: `Card: ${charge.description}`,
    sourceRef: charge.sourceFile,
  };
}

function manualMappingToEntry(
  itemId: number | null,
  mapping: ManualMappingPayload,
  mappingId: string,
  now: string,
): PreviewNewEntry {
  const oneTime = mapping.billingType === "one_time";
  const membership = mapping.plan && mapping.plan !== "-" ? mapping.plan : null;
  return {
    serviceKey: `learned:${mappingId}`,
    name: mapping.name,
    itemId,
    amount: round2(Math.abs(mapping.amount)),
    currency: "TRY",
    periodStart: oneTime ? mapping.date : `${mapping.date.slice(0, 7)}-01`,
    periodKind: oneTime ? "one_time" : "month",
    membership,
    note: `Card: ${mapping.description}`,
    sourceRef: `manual:${mappingId}`,
  };
}

export async function previewStatementImport(
  repo: TableRepository,
  fileName: string,
  base64Data: string,
): Promise<StatementImportPreview> {
  const services = await loadCatalog(repo);
  const lines = await extractPdfLines(base64Data);
  const { cutoffDate, transactions } = parseStatementLines(lines);

  const seen = new Set<string>();
  const charges: StatementCharge[] = [];
  const unclassified: Array<{ date: string; amount: number; description: string }> = [];

  for (const transaction of transactions) {
    const service = classifyDescription(transaction.description, services);
    if (!service) {
      if (isOnlineCandidate(transaction.description)) {
        unclassified.push({
          date: transaction.date,
          amount: transaction.amount,
          description: transaction.description,
        });
      }
      continue;
    }
    const key = `${transaction.date}|${service.key}|${round2(transaction.amount)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    charges.push({
      date: transaction.date,
      amount: transaction.amount,
      description: transaction.description,
      service,
      cutoffDate,
      sourceFile: fileName,
    });
  }

  const [items, entries] = await Promise.all([repo.listItems(), repo.listEntries()]);
  const entriesByItem = new Map<number, EntryRecord[]>();
  for (const entry of entries) {
    if (!entriesByItem.has(entry.itemId)) entriesByItem.set(entry.itemId, []);
    entriesByItem.get(entry.itemId)!.push(entry);
  }

  const newItems: PreviewNewItem[] = [];
  const newEntries: PreviewNewEntry[] = [];
  let matchedCount = 0;
  const newServiceKeys = new Set<string>();

  for (const charge of charges) {
    const service = charge.service;
    const resolved = resolveItem(items, service);

    if (resolved.missing) {
      // Genuinely new service: create the item and its entries on apply.
      newServiceKeys.add(service.key);
      newEntries.push(chargeToEntry(null, charge, service));
      continue;
    }

    if (resolved.id === null) {
      // Multiple items share the name and plan/account did not disambiguate.
      unclassified.push({
        date: charge.date,
        amount: charge.amount,
        description: charge.description,
      });
      continue;
    }

    const candidate = chargeToEntry(resolved.id, charge, service);
    const existing = entriesByItem.get(resolved.id) ?? [];
    const alreadyTracked = existing.some(
      (entry) =>
        entry.periodStart === candidate.periodStart &&
        Math.abs(entry.amount - candidate.amount) < 0.011,
    );
    if (alreadyTracked) {
      matchedCount += 1;
    } else {
      newEntries.push(candidate);
    }
  }

  const newItemList: PreviewNewItem[] = [...new Set(newServiceKeys)].map((key) => {
    const service = charges.find((charge) => charge.service.key === key)!.service;
    return {
      serviceKey: service.key,
      name: service.name,
      category: service.category,
      billingType: service.billingType,
      plan: service.plan && service.plan !== "-" ? service.plan : null,
      url: service.url ?? null,
      account: service.account ?? null,
    };
  });

  const orderedCharges = charges.map((charge) => ({
    name: charge.service.name,
    date: charge.date,
    amount: charge.amount,
    description: charge.description,
  }));

  return {
    fileName,
    cutoffDate,
    charges: orderedCharges,
    newItems: newItemList,
    newEntries,
    matchedCount,
    unclassified,
    summary: {
      charges: charges.length,
      newItems: newItemList.length,
      newEntries: newEntries.length,
      matched: matchedCount,
    },
  };
}

export async function applyStatementImport(
  repo: TableRepository,
  fileName: string,
  base64Data: string,
  manualMappings: ManualMappingPayload[] = [],
) {
  const preview = await previewStatementImport(repo, fileName, base64Data);
  const now = new Date().toISOString();

  const itemIdByServiceKey = new Map<string, number>();
  for (const newItem of preview.newItems) {
    const item: ItemRecord = {
      id: await repo.nextItemId(),
      name: newItem.name,
      category: newItem.category,
      billingType: newItem.billingType,
      plan: newItem.plan,
      url: newItem.url,
      account: newItem.account,
      powerWatts: null,
      status: "active",
      closedAt: null,
      notes: "Imported from a credit-card statement.",
      createdAt: now,
      updatedAt: now,
    };
    await repo.saveItem(item);
    itemIdByServiceKey.set(newItem.serviceKey, item.id);
  }

  // Apply manually-mapped unmapped transactions: remember the pattern, create
  // the item, and add the ledger entry. Future statement imports will match
  // these patterns against the catalog automatically.
  const learnedMappings: LearnedMapping[] = [];
  for (const mapping of manualMappings) {
    const learned = buildLearnedMapping({
      description: mapping.description,
      name: mapping.name,
      category: mapping.category,
      billingType: mapping.billingType,
      plan: mapping.plan,
      url: mapping.url,
      account: mapping.account,
      pattern: mapping.pattern ?? undefined,
    });
    await repo.addLearnedMapping(learned);
    learnedMappings.push(learned);
  }

  const manualItemIds = new Map<string, number>();
  learnedMappings.forEach((learned, index) => {
    const mapping = manualMappings[index];
    manualItemIds.set(learned.id, -1); // placeholder; resolved below
  });
  const existingItems = await repo.listItems();
  const itemsByNamePlan = new Map<string, ItemRecord>();
  for (const item of existingItems) {
    const key = `${item.name.trim().toLowerCase()}|${(item.plan ?? "").trim().toLowerCase()}`;
    itemsByNamePlan.set(key, item);
  }
  learnedMappings.forEach((learned, index) => {
    const mapping = manualMappings[index];
    const key = `${mapping.name.trim().toLowerCase()}|${(mapping.plan ?? "").trim().toLowerCase()}`;
    const existing = itemsByNamePlan.get(key);
    if (existing) {
      manualItemIds.set(learned.id, existing.id);
      return;
    }
    // Create lazily; resolve below after we know the next id.
    manualItemIds.set(learned.id, -2);
  });

  let entriesCreated = 0;
  for (const entry of preview.newEntries) {
    const itemId = entry.itemId ?? itemIdByServiceKey.get(entry.serviceKey);
    if (itemId === undefined || itemId === null) continue;
    const record: EntryRecord = {
      id: await repo.nextEntryId(),
      itemId,
      amount: entry.amount,
      currency: entry.currency,
      periodStart: entry.periodStart,
      periodKind: entry.periodKind as EntryRecord["periodKind"],
      membership: entry.membership,
      note: entry.note,
      sourceRef: entry.sourceRef,
      createdAt: now,
    };
    await repo.saveEntry(record);
    entriesCreated += 1;
  }

  for (let index = 0; index < manualMappings.length; index += 1) {
    const mapping = manualMappings[index];
    const learned = learnedMappings[index];
    let itemId = manualItemIds.get(learned.id);
    if (itemId === -2) {
      const newItem: ItemRecord = {
        id: await repo.nextItemId(),
        name: mapping.name,
        category: mapping.category,
        billingType: mapping.billingType,
        plan: mapping.plan,
        url: mapping.url,
        account: mapping.account,
        powerWatts: null,
        status: "active",
        closedAt: null,
        notes: "Created from a manual mapping of an unmapped statement charge.",
        createdAt: now,
        updatedAt: now,
      };
      await repo.saveItem(newItem);
      itemId = newItem.id;
      manualItemIds.set(learned.id, itemId);
    }
    if (!itemId || itemId < 1) continue;
    const entry = manualMappingToEntry(itemId, mapping, learned.id, now);
    const record: EntryRecord = {
      id: await repo.nextEntryId(),
      itemId,
      amount: entry.amount,
      currency: entry.currency,
      periodStart: entry.periodStart,
      periodKind: entry.periodKind as PeriodKind,
      membership: entry.membership,
      note: entry.note,
      sourceRef: entry.sourceRef,
      createdAt: now,
    };
    await repo.saveEntry(record);
    entriesCreated += 1;
  }

  return {
    itemsCreated: preview.newItems.length,
    entriesCreated,
    matchedSkipped: preview.matchedCount,
    summary: preview.summary,
    manualMappingsApplied: manualMappings.length,
    learnedPatterns: learnedMappings.map((learned) => ({
      id: learned.id,
      pattern: learned.pattern,
      name: learned.name,
    })),
  };
}
