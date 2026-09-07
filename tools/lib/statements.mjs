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

// --- Single-charge digital slip (POS) parser --------------------------------
// Mirrors api/src/lib/statement-import.ts so the local CLI can import a single
// slip the same way the API can. The two implementations must stay in sync.

const SLIP_DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\b/;
const SLIP_DATE_ONLY_RE = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
const SLIP_AMOUNT_RE = /TUTAR\s*[:=]?\s*([\d.]+,\d{2})/i;
const SLIP_TERMINAL_RE = /TERMİNAL\s*NO\s*[:=]?\s*([A-Z0-9]+)/i;
const SLIP_WORKPLACE_RE = /İŞYERİ\s*NO\s*[:=]?\s*([A-Z0-9]+)/i;
const SLIP_APPROVAL_RE = /ONAY\s*KODU\s*[:=]?\s*(\d+)/i;
const SLIP_SEQUENCE_RE = /SIRA\s*NO\s*[:=]?\s*(\d+)/i;
const SLIP_BANKREF_RE = /BANKA\s*REF\s*NO\s*[:=]?\s*(\d+)/i;
const SLIP_RRN_RE = /\bRRN\s*[:=]?\s*(\d+)/i;
const SLIP_AID_RE = /AID\s*[:=]?\s*([A-Z0-9]+)/i;
const SLIP_CARD_RE = /\b(\d{0,6})\*+(\d{4})\b/;
const SLIP_NETWORK_RE = /\b(VISA|MASTERCARD|MAESTRO|AMEX|TROY)\b/i;

const _isoSlipDate = (day, month, year) => `${year}-${month}-${day}`;

function _firstMatch(re, text) {
  const m = re.exec(text);
  return m ? m[1] : null;
}

function _cleanLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

function _pickMerchant(lines) {
  for (const raw of lines) {
    const line = _cleanLine(raw);
    if (!line) continue;
    if (SLIP_DATE_RE.test(line)) continue;
    if (SLIP_AMOUNT_RE.test(line)) continue;
    if (/^[\d*]+$/.test(line)) continue;
    if (/^SIRA NO|^ONAY KODU|^BANKA REF|^RRN|^AID|^TUTAR|^GRUP NO/i.test(line)) continue;
    if (/^[A-ZÇĞİÖŞÜ][A-Z0-9 .ÇĞİÖŞÜ&'/-]{1,}$/.test(line)) return line;
  }
  return null;
}

function _pickCity(lines, merchantIndex) {
  for (let index = merchantIndex + 1; index < Math.min(merchantIndex + 5, lines.length); index += 1) {
    const line = _cleanLine(lines[index] ?? "");
    if (!line) continue;
    if (SLIP_DATE_RE.test(line)) return null;
    if (/^[\d*]+$/.test(line)) return null;
    if (/^[A-Z]{2,}\/[A-Z]{2,3}$/.test(line)) return line;
    return null;
  }
  return null;
}

export function parseSlipLines(lines) {
  if (lines.length === 0) return null;
  const merchantIndex = lines.findIndex((raw) => {
    const line = _cleanLine(raw);
    return Boolean(
      line &&
        /^[A-ZÇĞİÖŞÜ][A-Z0-9 .ÇĞİÖŞÜ&'/-]{1,}$/.test(line) &&
        !SLIP_DATE_RE.test(line) &&
        !SLIP_AMOUNT_RE.test(line),
    );
  });
  const merchant = merchantIndex >= 0 ? _cleanLine(lines[merchantIndex]) : null;
  if (!merchant) return null;

  const city = _pickCity(lines, merchantIndex);
  const flattened = lines.map(_cleanLine).filter(Boolean).join(" \u00b7 ");

  const dateTimeMatch = SLIP_DATE_RE.exec(flattened);
  let date = null;
  let time = null;
  if (dateTimeMatch) {
    date = _isoSlipDate(dateTimeMatch[1], dateTimeMatch[2], dateTimeMatch[3]);
    time = `${dateTimeMatch[4]}:${dateTimeMatch[5]}:${dateTimeMatch[6]}`;
  } else {
    const dateOnlyMatch = SLIP_DATE_ONLY_RE.exec(flattened);
    if (dateOnlyMatch) date = _isoSlipDate(dateOnlyMatch[1], dateOnlyMatch[2], dateOnlyMatch[3]);
  }
  if (!date) return null;

  const amountMatch = SLIP_AMOUNT_RE.exec(flattened);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const cardMatch = SLIP_CARD_RE.exec(flattened);
  const networkMatch = SLIP_NETWORK_RE.exec(flattened);

  const references = {
    terminalNo: _firstMatch(SLIP_TERMINAL_RE, flattened),
    workplaceNo: _firstMatch(SLIP_WORKPLACE_RE, flattened),
    approvalCode: _firstMatch(SLIP_APPROVAL_RE, flattened),
    sequenceNo: _firstMatch(SLIP_SEQUENCE_RE, flattened),
    bankRefNo: _firstMatch(SLIP_BANKREF_RE, flattened),
    rrn: _firstMatch(SLIP_RRN_RE, flattened),
    aid: _firstMatch(SLIP_AID_RE, flattened),
    cardLast4: cardMatch ? cardMatch[2] : null,
    network: networkMatch ? networkMatch[1].toUpperCase() : null,
  };

  return {
    merchant,
    city,
    date,
    time,
    amount,
    description: city ? `${merchant} ${city}` : merchant,
    references,
  };
}
