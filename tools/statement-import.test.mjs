import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount,
  parseSlipLines,
  parseStatementLines,
  classifyDescription,
  compileServices,
} from "./lib/statements.mjs";
import { reconcile, reconcileSlip, round2 } from "./lib/reconcile.mjs";

test("parseAmount reads Turkish-formatted amounts and refund signs", () => {
  assert.equal(parseAmount("TR 300,00"), 300);
  assert.equal(parseAmount("TR 1.300,00"), 1300);
  assert.equal(parseAmount("GBGB 159,99"), 159.99);
  assert.equal(parseAmount("TR +109,96 -2"), -109.96);
  assert.equal(parseAmount("TR +864,70"), -864.7);
  assert.equal(parseAmount("no amount here"), null);
});

test("parseStatementLines extracts cutoff date and transactions", () => {
  const lines = [
    "Hesap Kesim Tarihi : 27 Şubat 2026",
    "Son Ödeme Tarihi : 9 Mart 2026",
    "Kart Numarası : 4506 34** **** 7512",
    "03 Şubat 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR 89,14 2",
    "13 Şubat 2026 CAPCUT SINGAPORE SG 72,79",
    "19 Şubat 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR +109,96 -2",
  ];
  const statement = parseStatementLines(lines);
  assert.equal(statement.cutoffDate, "2026-02-27");
  assert.equal(statement.dueDate, "2026-03-09");
  assert.equal(statement.cards.length, 1);
  assert.equal(statement.transactions.length, 3);
  assert.deepEqual(statement.transactions[1], {
    date: "2026-02-13",
    description: "CAPCUT SINGAPORE SG 72,79",
    amount: 72.79,
  });
});

test("classifyDescription matches the curated digital-service catalog", () => {
  const services = compileServices([
    { key: "netflix", patterns: ["NETFLIX"] },
    { key: "amazon-prime", patterns: ["AMZNPRIMETR"] },
    { key: "apple", patterns: ["APPLE\\.COM/BILL"] },
  ]);
  assert.equal(classifyDescription("NETFLIX.COM AMSTERDAM NL 379,99", services)?.key, "netflix");
  assert.equal(classifyDescription("IYZICO *AMZNPRIMETR ISTANBUL TR 69,90", services)?.key, "amazon-prime");
  assert.equal(classifyDescription("APPLE.COM/BILL CORK IRIR 249,99", services)?.key, "apple");
  assert.equal(classifyDescription("SARDUNYA GIDA-HADIMKOY TR 300,00", services), null);
});

test("reconcile adds new items and replaces in-window seed entries with statement truth", () => {
  const seed = {
    metadata: { sourceGrandTotal: 0, importedGrandTotal: 0, sourceCategoryTotals: {} },
    items: [
      {
        key: "platform-4",
        name: "Netflix",
        category: "Platform",
        billingType: "recurring",
        plan: "Premium",
        url: null,
        account: null,
        powerWatts: null,
        status: "active",
        closedAt: null,
        notes: null,
      },
    ],
    entries: [
      { itemKey: "platform-4", amount: 379.99, currency: "TRY", periodStart: "2025-05-01", periodKind: "month", membership: "Premium", note: null, sourceRef: null },
      { itemKey: "platform-4", amount: 379.99, currency: "TRY", periodStart: "2025-08-01", periodKind: "month", membership: "Premium", note: null, sourceRef: null },
    ],
  };
  const netflix = { key: "netflix", name: "Netflix", itemKey: "platform-4", billingType: "recurring", plan: "Premium", patterns: [] };
  const apple = { key: "apple", name: "Apple", itemKey: null, category: "Platform", billingType: "recurring", plan: "iCloud", url: "https://apple.com", account: null, patterns: [] };
  const charges = [
    { date: "2025-08-25", amount: 379.99, description: "NETFLIX.COM", service: netflix, statementFile: "aug.pdf", cutoffDate: "2025-08-28" },
    { date: "2026-02-11", amount: 249.99, description: "APPLE.COM/BILL", service: apple, statementFile: "feb.pdf", cutoffDate: "2026-02-27" },
  ];

  const { mergedSeed, report } = reconcile({ seed, charges, now: "2026-08-17" });

  // May 2025 entry is before the statement window and is preserved.
  const netflixMay = mergedSeed.entries.find((e) => e.itemKey === "platform-4" && e.periodStart === "2025-05-01");
  assert.ok(netflixMay, "pre-window Netflix entry is preserved");

  // August 2025 is replaced by the statement charge (sourceRef now points to the PDF).
  const netflixAug = mergedSeed.entries.find((e) => e.itemKey === "platform-4" && e.periodStart === "2025-08-01");
  assert.equal(netflixAug.amount, 379.99);
  assert.equal(netflixAug.sourceRef, "aug.pdf");

  // Apple is created as a new item with its charge entry.
  const appleItem = mergedSeed.items.find((item) => item.name === "Apple");
  assert.ok(appleItem, "Apple item is created");
  assert.equal(appleItem.category, "Platform");
  const appleEntry = mergedSeed.entries.find((e) => e.itemKey === appleItem.key);
  assert.equal(appleEntry.amount, 249.99);
  assert.equal(appleEntry.periodStart, "2026-02-01");

  // The August seed entry was replaced, so it appears in the dropped list.
  assert.equal(report.summary.droppedEntries, 1);
  assert.equal(report.summary.newItems, 1);
});

test("round2 keeps two-decimal precision for refunds", () => {
  assert.equal(round2(-4686.48), -4686.48);
  assert.equal(round2(69.9), 69.9);
});

test("parseSlipLines reads merchant, date, amount, and bank references", () => {
  const lines = [
    "NANONOBLE PTE. LTD.",
    "SINGAPORE/SG",
    "İŞYERİ NO:JGS8BUIW5Z0G7HY TERMİNAL NO:20JHL4DY",
    "18/08/2026 17:01:15 540062******2627",
    "TUTAR: 1.188,00 TL",
    "SIRA NO:212220 ONAY KODU:503441",
    "BANKA REF NO:7700189719503441",
    "RRN:081841212220",
    "AID:- / MasterCard",
  ];
  const slip = parseSlipLines(lines);
  assert.ok(slip, "slip should be parsed");
  assert.equal(slip.merchant, "NANONOBLE PTE. LTD.");
  assert.equal(slip.city, "SINGAPORE/SG");
  assert.equal(slip.date, "2026-08-18");
  assert.equal(slip.amount, 1188);
  assert.equal(slip.references.bankRefNo, "7700189719503441");
  assert.equal(slip.references.rrn, "081841212220");
  assert.equal(slip.references.cardLast4, "2627");
  assert.equal(slip.references.network, "MASTERCARD");
});

test("reconcileSlip adds an entry to the existing item when the merchant is in the catalog", () => {
  const seed = {
    metadata: { importedOn: "2026-08-10" },
    items: [
      {
        key: "platform-4",
        name: "Netflix",
        category: "Platform",
        billingType: "recurring",
        plan: "Premium",
        url: null,
        account: null,
        powerWatts: null,
        status: "active",
        closedAt: null,
        notes: null,
      },
    ],
    entries: [],
  };
  const slip = {
    merchant: "NETFLIX",
    city: null,
    date: "2026-08-25",
    time: null,
    amount: 379.99,
    description: "NETFLIX",
    references: { bankRefNo: "111", rrn: null, sequenceNo: null, cardLast4: "0000", network: "VISA" },
  };
  const netflix = { key: "netflix", name: "Netflix", itemKey: "platform-4", category: "Platform", billingType: "recurring", plan: "Premium", url: null, account: null, patterns: ["NETFLIX"] };
  const { mergedSeed, report } = reconcileSlip({ seed, slip, service: netflix, fileName: "aug-slip.pdf" });
  assert.equal(report.summary.addedEntries, 1);
  assert.equal(report.summary.newItems, 0);
  assert.equal(mergedSeed.items.length, 1);
  assert.equal(mergedSeed.entries.length, 1);
  assert.equal(mergedSeed.entries[0].itemKey, "platform-4");
  assert.equal(mergedSeed.entries[0].amount, 379.99);
  assert.equal(mergedSeed.entries[0].sourceRef, "slip:aug-slip.pdf#111");
});

test("reconcileSlip creates a new item when the slip merchant needs a manual mapping", () => {
  const seed = {
    metadata: { importedOn: "2026-08-10" },
    items: [],
    entries: [],
  };
  const slip = {
    merchant: "NANONOBLE PTE. LTD.",
    city: "SINGAPORE/SG",
    date: "2026-08-18",
    time: "17:01:15",
    amount: 1188,
    description: "NANONOBLE PTE. LTD. SINGAPORE/SG",
    references: { bankRefNo: "7700189719503441", rrn: "081841212220", sequenceNo: "212220", cardLast4: "2627", network: "MASTERCARD" },
  };
  const { mergedSeed, report } = reconcileSlip({
    seed,
    slip,
    service: null,
    fileName: "aug-slip.pdf",
    manualMapping: {
      name: "Nanonoble",
      category: "Platform",
      billingType: "one_time",
      plan: null,
      url: "https://nanonoble.example",
      account: null,
      pattern: "NANONOBLE",
    },
  });
  assert.equal(report.summary.addedEntries, 1);
  assert.equal(report.summary.newItems, 1);
  assert.equal(report.newItem.name, "Nanonoble");
  assert.match(report.newItem.key, /^platform-\d+$/);
  assert.equal(mergedSeed.entries[0].itemKey, report.newItem.key);
  assert.equal(mergedSeed.entries[0].amount, 1188);
  assert.equal(mergedSeed.entries[0].periodStart, "2026-08-18");
  assert.equal(mergedSeed.entries[0].periodKind, "one_time");
  assert.equal(mergedSeed.entries[0].sourceRef, "slip:aug-slip.pdf#7700189719503441");
});
