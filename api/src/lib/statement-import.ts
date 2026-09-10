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

export class StatementInputError extends Error {}

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

export interface SlipReferences {
  terminalNo: string | null;
  workplaceNo: string | null;
  approvalCode: string | null;
  sequenceNo: string | null;
  bankRefNo: string | null;
  rrn: string | null;
  aid: string | null;
  cardLast4: string | null;
  network: string | null;
}

export interface StatementSlip {
  merchant: string;
  city: string | null;
  transactionType: string | null;
  date: string;
  time: string | null;
  amount: number;
  description: string;
  references: SlipReferences;
}

export interface SlipImportPreview {
  fileName: string;
  slip: StatementSlip;
  matched: { service: PreviewNewItem; itemId: number | null; alreadyTracked: boolean } | null;
  summary: { classified: boolean; newItem: boolean; alreadyTracked: boolean };
}

export interface SlipImportResult {
  itemsCreated: number;
  entriesCreated: number;
  alreadyTracked: boolean;
  learnedPattern: string | null;
  summary: { classified: boolean; newItem: boolean; alreadyTracked: boolean };
}

export interface SlipManualMappingPayload {
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string | null;
  url: string | null;
  account: string | null;
  pattern: string | null;
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
  if (!data.length || data.length > 10 * 1024 * 1024) {
    throw new StatementInputError("Choose a non-empty PDF file no larger than 10 MB.");
  }
  const task = getDocument({ data, disableFontFace: true });
  try {
    const document = await task.promise;
    if (document.numPages > 100) throw new StatementInputError("Statements must have 100 pages or fewer.");
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...reconstructLines(content.items));
    }
    return lines;
  } catch (error) {
    if (error instanceof StatementInputError) throw error;
    throw new StatementInputError("This PDF could not be read. Choose an unlocked, text-based credit-card statement.");
  } finally {
    await task.destroy();
  }
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

// --- Single-charge digital slip (POS) parser --------------------------------
// A digital slip is a one-page receipt (Yapı Kredi / other Turkish banks) that
// documents a single card transaction. Top of the page lists the merchant, the
// merchant city, then merchant/terminal IDs; the rest is structured key/value
// data (date, amount, slip references). We extract the minimum needed for the
// import flow: merchant, date, amount, and the slip references for traceability.

const SLIP_DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\b/;
const SLIP_DATE_ONLY_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const SLIP_AMOUNT_RE = /TUTAR\s*[:=]?\s*([\d.]+,\d{2})/i;
const SLIP_TERMINAL_RE = /TERM\u0130NAL\s*NO\s*[:=]?\s*([A-Z0-9]+)/i;
const SLIP_WORKPLACE_RE = /\u0130\u015eYER\u0130\s*NO\s*[:=]?\s*([A-Z0-9]+)/i;
const SLIP_APPROVAL_RE = /ONAY\s*KODU\s*[:=]?\s*(\d+)/i;
const SLIP_SEQUENCE_RE = /SIRA\s*NO\s*[:=]?\s*(\d+)/i;
const SLIP_BANKREF_RE = /BANKA\s*REF\s*NO\s*[:=]?\s*(\d+)/i;
const SLIP_RRN_RE = /\bRRN\s*[:=]?\s*(\d+)/i;
const SLIP_AID_RE = /AID\s*[:=]?\s*([A-Z0-9]+)/i;
const SLIP_CARD_RE = /\b(\d{0,6})\*+(\d{4})\b/;
const SLIP_NETWORK_RE = /\b(VISA|MASTERCARD|MAESTRO|AMEX|TROY)\b/i;
const SLIP_TYPE_RE = /(Pe\u015fin|Online)\s*Sat\u0131\u015f|Taksitli\s*Sat\u0131\u015f|Para\s*\u00c7ekme|E[-\s]*ticaret/i;

function toIsoDateFromSlip(day: string, month: string, year: string) {
  return `${year}-${month}-${day}`;
}

function firstMatch(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? m[1] : null;
}

function cleanToken(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function pickMerchant(lines: string[]): string | null {
  // The merchant name is the first non-empty, all-caps line that doesn't look
  // like a date/amount/receipt footer/header. Some receipts have a 1-2 line
  // header (bank name + slip title) before the merchant; we skip those.
  for (const raw of lines) {
    const line = cleanToken(raw);
    if (!line) continue;
    if (SLIP_DATE_RE.test(line)) continue;
    if (SLIP_AMOUNT_RE.test(line)) continue;
    if (/^[\d*]+$/.test(line)) continue;
    if (/^SIRA NO|^ONAY KODU|^BANKA REF|^RRN|^AID|^TUTAR|^GRUP NO/i.test(line)) continue;
    if (/^[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc][A-Z0-9 .\u00c7\u011e\u0130\u00d6\u015e\u00dc&'/-]{1,}$/.test(line)) {
      return line;
    }
  }
  return null;
}

function pickCity(lines: string[], merchantIndex: number): string | null {
  // The city is typically the next non-empty line after the merchant, in a
  // "CITY/CC" format (e.g. "SINGAPORE/SG" or "ISTANBUL/TR").
  for (let index = merchantIndex + 1; index < Math.min(merchantIndex + 5, lines.length); index += 1) {
    const line = cleanToken(lines[index] ?? "");
    if (!line) continue;
    if (SLIP_DATE_RE.test(line)) return null;
    if (/^[\d*]+$/.test(line)) return null;
    if (/^[A-Z]{2,}\/[A-Z]{2,3}$/.test(line)) return line;
    if (line.length <= 4) continue;
    return null;
  }
  return null;
}

/**
 * Parse a single-charge digital slip (POS receipt) into the structured data
 * the import flow needs. Returns `null` when the PDF does not look like a slip
 * (no merchant, no amount, no date) so callers can fall back to statement
 * parsing or surface a clear error.
 */
export function parseSlipLines(lines: string[]): StatementSlip | null {
  if (lines.length === 0) return null;

  // Find the merchant first so we can exclude it from the city search.
  const merchantIndex = lines.findIndex((raw) => {
    const line = cleanToken(raw);
    return Boolean(
      line &&
        /^[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc][A-Z0-9 .\u00c7\u011e\u0130\u00d6\u015e\u00dc&'/-]{1,}$/.test(
          line,
        ) &&
        !SLIP_DATE_RE.test(line) &&
        !SLIP_AMOUNT_RE.test(line),
    );
  });
  const merchant = merchantIndex >= 0 ? cleanToken(lines[merchantIndex]) : null;
  if (!merchant) return null;

  const city = pickCity(lines, merchantIndex);
  const flattened = lines.map(cleanToken).filter(Boolean).join(" \u00b7 ");

  // Date: prefer full "DD/MM/YYYY HH:MM:SS"; fall back to date-only.
  const dateTimeMatch = SLIP_DATE_RE.exec(flattened);
  let date: string | null = null;
  let time: string | null = null;
  if (dateTimeMatch) {
    date = toIsoDateFromSlip(dateTimeMatch[1], dateTimeMatch[2], dateTimeMatch[3]);
    time = `${dateTimeMatch[4]}:${dateTimeMatch[5]}:${dateTimeMatch[6]}`;
  } else {
    const dateOnlyMatch = SLIP_DATE_ONLY_RE.exec(flattened);
    if (dateOnlyMatch) {
      date = toIsoDateFromSlip(dateOnlyMatch[1], dateOnlyMatch[2], dateOnlyMatch[3]);
    }
  }
  if (!date) return null;

  const amountMatch = SLIP_AMOUNT_RE.exec(flattened);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const cardMatch = SLIP_CARD_RE.exec(flattened);
  const networkMatch = SLIP_NETWORK_RE.exec(flattened);
  const typeMatch = SLIP_TYPE_RE.exec(flattened);

  const references: SlipReferences = {
    terminalNo: firstMatch(SLIP_TERMINAL_RE, flattened),
    workplaceNo: firstMatch(SLIP_WORKPLACE_RE, flattened),
    approvalCode: firstMatch(SLIP_APPROVAL_RE, flattened),
    sequenceNo: firstMatch(SLIP_SEQUENCE_RE, flattened),
    bankRefNo: firstMatch(SLIP_BANKREF_RE, flattened),
    rrn: firstMatch(SLIP_RRN_RE, flattened),
    aid: firstMatch(SLIP_AID_RE, flattened),
    cardLast4: cardMatch ? cardMatch[2] : null,
    network: networkMatch ? networkMatch[1].toUpperCase() : null,
  };

  const description = city ? `${merchant} ${city}` : merchant;
  return {
    merchant,
    city,
    transactionType: typeMatch ? cleanToken(typeMatch[0]) : null,
    date,
    time,
    amount,
    description,
    references,
  };
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

export function manualMappingToEntry(
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
    amount: round2(mapping.amount),
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
  return applyStatementPreview(repo, preview, manualMappings);
}

export async function applyStatementPreview(
  repo: TableRepository,
  preview: StatementImportPreview,
  manualMappings: ManualMappingPayload[] = [],
) {
  const signature = (row: { date: string; amount: number; description: string }) =>
    JSON.stringify([row.date, round2(row.amount), row.description]);
  const unclassified = new Set(preview.unclassified.map(signature));
  const classified = new Set(preview.charges.map(signature));
  const seenMappings = new Set<string>();
  manualMappings = manualMappings.filter((mapping) => {
    const key = signature(mapping);
    if (!unclassified.has(key) && !classified.has(key)) {
      throw new StatementInputError("A mapped transaction is not present in this statement. Preview the file again.");
    }
    // A retry may already classify a previously learned merchant automatically.
    if (!unclassified.has(key) || seenMappings.has(key)) return false;
    seenMappings.add(key);
    return true;
  });
  const now = new Date().toISOString();
  let itemsCreated = 0;

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
    itemsCreated += 1;
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

  const existingItems = await repo.listItems();
  const itemKey = (item: { name: string; plan: string | null; account: string | null }) =>
    JSON.stringify([item.name, item.plan ?? "", item.account ?? ""].map((value) => value.trim().toLowerCase()));
  const itemsByNamePlan = new Map(existingItems.map((item) => [itemKey(item), item]));
  const existingEntries = await repo.listEntries();

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
    existingEntries.push(record);
    entriesCreated += 1;
  }

  for (let index = 0; index < manualMappings.length; index += 1) {
    const mapping = manualMappings[index];
    const learned = learnedMappings[index];
    let itemId = itemsByNamePlan.get(itemKey(mapping))?.id;
    if (itemId === undefined) {
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
      itemsCreated += 1;
      itemsByNamePlan.set(itemKey(mapping), newItem);
    }
    if (!itemId || itemId < 1) continue;
    const entry = manualMappingToEntry(itemId, mapping, learned.id, now);
    if (existingEntries.some((existing) => existing.itemId === itemId
      && existing.periodStart === entry.periodStart && existing.amount === entry.amount
      && existing.note === entry.note)) continue;
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
    existingEntries.push(record);
    entriesCreated += 1;
  }

  return {
    itemsCreated,
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

// --- Single-slip import -----------------------------------------------------
// A slip is a one-charge receipt: either a transaction the monthly statement
// missed (e.g. posted after the cutoff, paid on a different card, or excluded
// from the statement PDF) or a one-off charge the user wants to add by hand.
// The flow mirrors the statement manual-mapping flow but for a single line.

function slipSourceRef(fileName: string, slip: StatementSlip): string {
  const token = slip.references.bankRefNo ?? slip.references.rrn ?? slip.references.sequenceNo;
  return token ? `slip:${fileName}#${token}` : `slip:${fileName}`;
}

function slipToNote(fileName: string, slip: StatementSlip): string {
  const ref = slip.references;
  const segments: string[] = [`Slip: ${slip.merchant}${slip.city ? ` (${slip.city})` : ""}`];
  if (ref.network) segments.push(ref.network);
  if (ref.bankRefNo) segments.push(`BANKA REF ${ref.bankRefNo}`);
  if (ref.rrn) segments.push(`RRN ${ref.rrn}`);
  if (ref.sequenceNo) segments.push(`SIRA NO ${ref.sequenceNo}`);
  if (ref.approvalCode) segments.push(`ONAY ${ref.approvalCode}`);
  if (slip.transactionType) segments.push(slip.transactionType);
  if (slip.time) segments.push(slip.time);
  if (ref.cardLast4) segments.push(`card ****${ref.cardLast4}`);
  segments.push(`file: ${fileName}`);
  return segments.join(" \u00b7 ");
}

function slipToPreviewEntry(
  itemId: number | null,
  slip: StatementSlip,
  service: CatalogService,
  fileName: string,
): PreviewNewEntry {
  const oneTime = service.billingType === "one_time";
  const membership = service.plan && service.plan !== "-" ? service.plan : null;
  return {
    serviceKey: service.key,
    name: service.name,
    itemId,
    amount: round2(slip.amount),
    currency: "TRY",
    periodStart: oneTime ? slip.date : `${slip.date.slice(0, 7)}-01`,
    periodKind: oneTime ? "one_time" : "month",
    membership,
    note: slipToNote(fileName, slip),
    sourceRef: slipSourceRef(fileName, slip),
  };
}

export async function previewSlipImport(
  repo: TableRepository,
  fileName: string,
  base64Data: string,
): Promise<SlipImportPreview> {
  const lines = await extractPdfLines(base64Data);
  const slip = parseSlipLines(lines);
  if (!slip) {
    throw new Error(
      "This PDF does not look like a single-charge slip. Choose a digital POS receipt with a merchant, date, and TUTAR amount, or switch to the statement import.",
    );
  }

  const services = await loadCatalog(repo);
  const service = classifyDescription(slip.description, services);
  if (!service) {
    return {
      fileName,
      slip,
      matched: null,
      summary: { classified: false, newItem: false, alreadyTracked: false },
    };
  }

  const items = await repo.listItems();
  const resolved = resolveItem(items, service);
  if (resolved.missing) {
    return {
      fileName,
      slip,
      matched: {
        service: {
          serviceKey: service.key,
          name: service.name,
          category: service.category,
          billingType: service.billingType,
          plan: service.plan && service.plan !== "-" ? service.plan : null,
          url: service.url ?? null,
          account: service.account ?? null,
        },
        itemId: null,
        alreadyTracked: false,
      },
      summary: { classified: true, newItem: true, alreadyTracked: false },
    };
  }

  if (resolved.id === null) {
    // Multiple items share the name and plan/account did not disambiguate.
    return {
      fileName,
      slip,
      matched: null,
      summary: { classified: false, newItem: false, alreadyTracked: false },
    };
  }

  const entries = await repo.listEntriesForItem(resolved.id);
  const oneTime = service.billingType === "one_time";
  const periodStart = oneTime ? slip.date : `${slip.date.slice(0, 7)}-01`;
  const alreadyTracked = entries.some(
    (entry) =>
      entry.periodStart === periodStart &&
      Math.abs(entry.amount - slip.amount) < 0.011,
  );

  return {
    fileName,
    slip,
    matched: {
      service: {
        serviceKey: service.key,
        name: service.name,
        category: service.category,
        billingType: service.billingType,
        plan: service.plan && service.plan !== "-" ? service.plan : null,
        url: service.url ?? null,
        account: service.account ?? null,
      },
      itemId: resolved.id,
      alreadyTracked,
    },
    summary: { classified: true, newItem: false, alreadyTracked },
  };
}

export async function applySlipImport(
  repo: TableRepository,
  fileName: string,
  base64Data: string,
  manualMapping: SlipManualMappingPayload | null = null,
): Promise<SlipImportResult> {
  const preview = await previewSlipImport(repo, fileName, base64Data);
  const now = new Date().toISOString();
  let itemsCreated = 0;
  let entriesCreated = 0;
  let learnedPattern: string | null = null;

  if (!preview.matched) {
    if (!manualMapping) {
      throw new Error(
        "The slip merchant is not in the catalog. Provide a manual mapping to add it as a new service.",
      );
    }
    const learned = buildLearnedMapping({
      description: preview.slip.description,
      name: manualMapping.name,
      category: manualMapping.category,
      billingType: manualMapping.billingType,
      plan: manualMapping.plan,
      url: manualMapping.url,
      account: manualMapping.account,
      pattern: manualMapping.pattern ?? undefined,
    });
    await repo.addLearnedMapping(learned);
    learnedPattern = learned.pattern;

    const items = await repo.listItems();
    const key = `${manualMapping.name.trim().toLowerCase()}|${(manualMapping.plan ?? "").trim().toLowerCase()}`;
    let itemId: number;
    const existing = items.find(
      (item) =>
        `${item.name.trim().toLowerCase()}|${(item.plan ?? "").trim().toLowerCase()}` === key,
    );
    if (existing) {
      itemId = existing.id;
    } else {
      const newItem: ItemRecord = {
        id: await repo.nextItemId(),
        name: manualMapping.name,
        category: manualMapping.category,
        billingType: manualMapping.billingType,
        plan: manualMapping.plan,
        url: manualMapping.url,
        account: manualMapping.account,
        powerWatts: null,
        status: "active",
        closedAt: null,
        notes: "Created from a manual mapping of a single digital slip.",
        createdAt: now,
        updatedAt: now,
      };
      await repo.saveItem(newItem);
      itemId = newItem.id;
      itemsCreated = 1;
    }

    const oneTime = manualMapping.billingType === "one_time";
    const periodStart = oneTime
      ? preview.slip.date
      : `${preview.slip.date.slice(0, 7)}-01`;
    const record: EntryRecord = {
      id: await repo.nextEntryId(),
      itemId,
      amount: round2(preview.slip.amount),
      currency: "TRY",
      periodStart,
      periodKind: oneTime ? "one_time" : "month",
      membership: manualMapping.plan && manualMapping.plan !== "-" ? manualMapping.plan : null,
      note: slipToNote(fileName, preview.slip),
      sourceRef: slipSourceRef(fileName, preview.slip),
      createdAt: now,
    };
    await repo.saveEntry(record);
    entriesCreated = 1;
    return {
      itemsCreated,
      entriesCreated,
      alreadyTracked: false,
      learnedPattern,
      summary: { classified: false, newItem: itemsCreated > 0, alreadyTracked: false },
    };
  }

  if (preview.matched.alreadyTracked) {
    return {
      itemsCreated: 0,
      entriesCreated: 0,
      alreadyTracked: true,
      learnedPattern: null,
      summary: { classified: true, newItem: false, alreadyTracked: true },
    };
  }

  let itemId = preview.matched.itemId;
  if (itemId === null) {
    const newItem: ItemRecord = {
      id: await repo.nextItemId(),
      name: preview.matched.service.name,
      category: preview.matched.service.category,
      billingType: preview.matched.service.billingType,
      plan: preview.matched.service.plan,
      url: preview.matched.service.url,
      account: preview.matched.service.account,
      powerWatts: null,
      status: "active",
      closedAt: null,
      notes: "Created from a single digital slip.",
      createdAt: now,
      updatedAt: now,
    };
    await repo.saveItem(newItem);
    itemId = newItem.id;
    itemsCreated = 1;
  }

  // Re-resolve the catalog service for the entry builder (preview.matched
  // strips the patterns/URL away from the service for the wire payload).
  const services = await loadCatalog(repo);
  const serviceFromCatalog = services.find((s) => s.key === preview.matched!.service.serviceKey);
  const service: CatalogService = serviceFromCatalog ?? {
    key: preview.matched.service.serviceKey,
    name: preview.matched.service.name,
    itemKey: null,
    category: preview.matched.service.category,
    billingType: preview.matched.service.billingType,
    plan: preview.matched.service.plan,
    url: preview.matched.service.url,
    account: preview.matched.service.account,
    patterns: [],
  };
  const entry = slipToPreviewEntry(itemId, preview.slip, service, fileName);
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
  entriesCreated = 1;
  return {
    itemsCreated,
    entriesCreated,
    alreadyTracked: false,
    learnedPattern: null,
    summary: { classified: true, newItem: itemsCreated > 0, alreadyTracked: false },
  };
}
