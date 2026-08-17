import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

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

// A transaction row starts with "DD Ay YYYY" and is followed by the merchant text.
const TRANSACTION_RE = new RegExp(
  `^(\\d{2}) (${MONTH_NAMES.join("|")}) (\\d{4})\\s+(.*)$`,
);
// The first currency-style amount is the "Tutar(TL)" charged this period. A leading
// "+" marks a refund/credit (reduces spend); a leading "-" is a negative charge.
const AMOUNT_RE = /([+-]?)(\d[\d.]*,\d{2})/;

const toIsoDate = (day, monthName, year) =>
  `${year}-${String(MONTH_INDEX[monthName]).padStart(2, "0")}-${day}`;

export function parseAmount(raw) {
  const match = AMOUNT_RE.exec(raw);
  if (!match) return null;
  const sign = match[1] === "+" || match[1] === "-" ? -1 : 1;
  const value = Number(match[2].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? sign * value : null;
}

/**
 * pdfjs text items are positioned glyphs. Reconstruct visual lines by grouping
 * glyphs that share a baseline (y) and ordering each line left-to-right (x).
 */
export function reconstructLines(items) {
  const glyphs = items.filter((item) => item.str && item.str.trim().length > 0);
  const sorted = [...glyphs].sort(
    (a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  );

  const lines = [];
  let current = [];
  let baseline = null;
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

export async function extractPdfLines(filePath) {
  const data = new Uint8Array(readFileSync(filePath));
  const document = await getDocument({ data, disableFontFace: true }).promise;
  const lines = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    lines.push(...reconstructLines(content.items));
  }
  return lines;
}

const DATE_RE = new RegExp(`([0-9]{1,2})\\s+(${MONTH_NAMES.join("|")})\\s+([0-9]{4})`);

function parseTurkishDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return null;
  return `${match[3]}-${String(MONTH_INDEX[match[2]]).padStart(2, "0")}-${String(
    Number(match[1]),
  ).padStart(2, "0")}`;
}

/**
 * Parse a statement's raw lines into metadata and transactions.
 * Returns `{ cutoffDate, dueDate, cards, transactions }` where transactions are
 * `{ date, description, amount }` (amount is signed: negative means refund).
 */
export function parseStatementLines(lines) {
  let cutoffDate = null;
  let dueDate = null;
  const cards = new Set();

  for (const line of lines) {
    if (!cutoffDate && /^\s*Hesap Kesim Tarihi\s*:/i.test(line)) {
      cutoffDate = parseTurkishDate(line.replace(/^.*?:\s*/, ""));
    }
    if (!dueDate && /^\s*Son Ödeme Tarihi\s*:/i.test(line)) {
      dueDate = parseTurkishDate(line.replace(/^.*?:\s*/, ""));
    }
    const card = /(?:Kart Numarası|Dijital Kart Numarası)\s*:\s*([\d*\s]+)/i.exec(line);
    if (card) cards.add(card[1].replace(/\s+/g, " ").trim());
  }

  const transactions = [];
  for (const line of lines) {
    const match = TRANSACTION_RE.exec(line);
    if (!match) continue;
    const [, day, monthName, year, rest] = match;
    const amount = parseAmount(rest);
    if (amount === null) continue;
    transactions.push({
      date: toIsoDate(day, monthName, year),
      description: rest.trim(),
      amount,
    });
  }
  return { cutoffDate, dueDate, cards: [...cards], transactions };
}

/**
 * Match a merchant description against the compiled service catalog. Returns the
 * first matching service or null. A service's `_patterns` holds compiled RegExps.
 */
export function classifyDescription(description, services) {
  const upper = description.toUpperCase();
  for (const service of services) {
    for (const pattern of service._patterns) {
      if (pattern.test(upper)) return service;
    }
  }
  return null;
}

export function compileServices(services) {
  return services.map((service) => ({
    ...service,
    _patterns: (service.patterns || []).map((pattern) => new RegExp(pattern, "i")),
  }));
}

export { TRANSACTION_RE };
