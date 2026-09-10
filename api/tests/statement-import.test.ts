import { describe, expect, it } from "vitest";
import {
  classifyDescription,
  compileServices,
  extractLearnedPattern,
  parseAmount,
  parseSlipLines,
  parseStatementLines,
  resolveItem,
} from "../src/lib/statement-import.js";
import type { ItemRecord, LearnedMapping } from "../src/lib/models.js";

describe("statement import parsing", () => {
  it("parses Turkish-formatted amounts and refund signs", () => {
    expect(parseAmount("TR 300,00")).toBe(300);
    expect(parseAmount("TR 1.300,00")).toBe(1300);
    expect(parseAmount("GBGB 159,99")).toBe(159.99);
    expect(parseAmount("TR +109,96 -2")).toBe(-109.96);
    expect(parseAmount("TR +864,70")).toBe(-864.7);
    expect(parseAmount("no amount")).toBeNull();
  });

  it("extracts the statement cutoff date and transactions", () => {
    const statement = parseStatementLines([
      "Hesap Kesim Tarihi : 27 Şubat 2026",
      "Kart Numarası : 4506 34** **** 7512",
      "13 Şubat 2026 CAPCUT SINGAPORE SG 72,79",
      "19 Şubat 2026 HEPSIPAY *HEPSIBURADA ISTANBUL TR +109,96 -2",
    ]);
    expect(statement.cutoffDate).toBe("2026-02-27");
    expect(statement.transactions).toHaveLength(2);
    expect(statement.transactions[0]).toEqual({
      date: "2026-02-13",
      description: "CAPCUT SINGAPORE SG 72,79",
      amount: 72.79,
    });
    expect(statement.transactions[1].amount).toBe(-109.96);
  });

  it("resolves a statement service to an existing, missing, or ambiguous item", () => {
    const makeItem = (id: number, name: string, plan: string | null, account: string | null): ItemRecord => ({
      id,
      name,
      category: "Platform",
      billingType: "recurring",
      plan,
      url: null,
      account,
      powerWatts: null,
      status: "active",
      closedAt: null,
      notes: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    const items = [
      makeItem(4, "Netflix", "Premium", "aserdargun@gmail.com"),
      makeItem(13, "Claude", "Pro", "aserdargun@gmail.com"),
      makeItem(28, "Claude", "Team", "serdargundogdu@leanviser.com"),
    ];
    const netflix = { key: "netflix", name: "Netflix", itemKey: "platform-4", category: "Platform" as const, billingType: "recurring" as const, plan: "Premium", url: null, account: null, patterns: [] };
    const claudePro = { key: "claude", name: "Claude", itemKey: "platform-13", category: "Platform" as const, billingType: "recurring" as const, plan: "Pro", url: null, account: "aserdargun@gmail.com", patterns: [] };
    const notion = { key: "notion", name: "Notion", itemKey: null, category: "Platform" as const, billingType: "recurring" as const, plan: "Plus", url: null, account: null, patterns: [] };

    expect(resolveItem(items, netflix)).toEqual({ id: 4, missing: false });
    expect(resolveItem(items, claudePro)).toEqual({ id: 13, missing: false });
    expect(resolveItem(items, notion)).toEqual({ id: null, missing: true });
  });

  it("classifies merchants against the digital-service catalog", () => {
    const services = compileServices([
      {
        key: "netflix",
        name: "Netflix",
        itemKey: "platform-4",
        category: "Platform",
        billingType: "recurring",
        plan: "Premium",
        url: null,
        account: null,
        patterns: ["NETFLIX"],
      },
      {
        key: "apple",
        name: "Apple",
        itemKey: null,
        category: "Platform",
        billingType: "recurring",
        plan: "iCloud",
        url: null,
        account: null,
        patterns: ["APPLE\\.COM/BILL"],
      },
    ]);
    expect(classifyDescription("NETFLIX.COM AMSTERDAM NL 379,99", services)?.key).toBe("netflix");
    expect(classifyDescription("APPLE.COM/BILL CORK IRIR 249,99", services)?.key).toBe("apple");
    expect(classifyDescription("SARDUNYA GIDA-HADIMKOY TR 300,00", services)).toBeNull();
  });

  it("extracts a pattern token from a raw merchant description", () => {
    expect(extractLearnedPattern("CAPCUT SINGAPORE SG 72,79")).toBe("CAPCUT");
    expect(extractLearnedPattern("HEPSIPAY *HEPSIBURADA ISTANBUL TR 109,96")).toBe("HEPSIPAY");
    expect(extractLearnedPattern("APPLE.COM/BILL CORK IRIR 249,99")).toBe("APPLE.COM");
    expect(extractLearnedPattern("NETFLIX.COM AMSTERDAM NL 379,99")).toBe("NETFLIX.COM");
    expect(extractLearnedPattern("10 02 2026 SPOTIFY AB STOCKHOLM SE 89,99")).toBe("SPOTIFY");
  });

  it("classifies previously-unmapped merchants after a learned mapping is registered", () => {
    const learned: LearnedMapping = {
      id: "uuid-1",
      pattern: "HEPSIPAY",
      name: "Hepsiburada",
      category: "Platform",
      billingType: "recurring",
      plan: "Plus",
      url: "https://www.hepsiburada.com",
      account: "aserdargun@gmail.com",
      createdAt: "2026-08-26T00:00:00.000Z",
    };
    const services = compileServices([
      ...[],
      {
        key: `learned:${learned.id}`,
        name: learned.name,
        itemKey: null,
        category: learned.category,
        billingType: learned.billingType,
        plan: learned.plan,
        url: learned.url,
        account: learned.account,
        patterns: [learned.pattern],
      },
    ]);
    const match = classifyDescription(
      "HEPSIPAY *HEPSIBURADA ISTANBUL TR +109,96 -2",
      services,
    );
    expect(match?.name).toBe("Hepsiburada");
    expect(match?.plan).toBe("Plus");
  });

  it("parses a single-charge slip into a structured charge with bank references", () => {
    const lines = [
      "NANONOBLE PTE. LTD.",
      "SINGAPORE/SG",
      "İŞYERİ NO:JGS8BUIW5Z0G7HY TERMİNAL NO:20JHL4DY",
      "Peşin Satış - E-ticaret",
      "Müşteri Nüshası",
      "18/08/2026 17:01:15 540062******2627",
      "TUTAR: 1.188,00 TL",
      '"TUTAR KARŞILIĞI MAL/HİZMET ALDIM"',
      "SIRA NO:212220 ONAY KODU:503441",
      "BANKA REF NO:7700189719503441",
      "RRN:081841212220",
      "AID:- / MasterCard",
    ];
    const slip = parseSlipLines(lines);
    expect(slip).not.toBeNull();
    expect(slip!.merchant).toBe("NANONOBLE PTE. LTD.");
    expect(slip!.city).toBe("SINGAPORE/SG");
    expect(slip!.date).toBe("2026-08-18");
    expect(slip!.time).toBe("17:01:15");
    expect(slip!.amount).toBe(1188);
    expect(slip!.description).toBe("NANONOBLE PTE. LTD. SINGAPORE/SG");
    expect(slip!.references.bankRefNo).toBe("7700189719503441");
    expect(slip!.references.rrn).toBe("081841212220");
    expect(slip!.references.sequenceNo).toBe("212220");
    expect(slip!.references.approvalCode).toBe("503441");
    expect(slip!.references.cardLast4).toBe("2627");
    expect(slip!.references.network).toBe("MASTERCARD");
  });

  it("returns null when the PDF does not look like a slip", () => {
    expect(parseSlipLines([])).toBeNull();
    expect(parseSlipLines(["Random header", "No amount here"])).toBeNull();
    expect(
      parseSlipLines(["MERCHANT NAME", "18/08/2026 17:01:15 540062******2627"]),
    ).toBeNull();
  });

  it("falls back to the date-only form when the slip omits the time", () => {
    const lines = [
      "EXAMPLE MERCHANT",
      "ISTANBUL/TR",
      "01/09/2026",
      "TUTAR: 49,90 TL",
    ];
    const slip = parseSlipLines(lines);
    expect(slip?.date).toBe("2026-09-01");
    expect(slip?.time).toBeNull();
    expect(slip?.amount).toBe(49.9);
  });
});

// Apply against a memory repository to exercise persistence and safe retries.
import { applyStatementPreview, manualMappingToEntry, type ManualMappingPayload, type StatementImportPreview } from "../src/lib/statement-import.js";
import type { EntryRecord } from "../src/lib/models.js";
import type { TableRepository } from "../src/lib/storage.js";

const mapping: ManualMappingPayload = {
  date: "2026-09-05", amount: -25, description: "NEWCLOUD REFUND +25,00", name: "New Cloud",
  category: "Platform", billingType: "recurring", plan: "Pro", url: null, account: null, pattern: "NEWCLOUD",
};
const preview: StatementImportPreview = {
  fileName: "statement.pdf", cutoffDate: "2026-09-10", charges: [], newItems: [], newEntries: [], matchedCount: 0,
  unclassified: [mapping], summary: { charges: 0, newItems: 0, newEntries: 0, matched: 0 },
};
function memoryRepository() {
  const items: ItemRecord[] = [];
  const entries: EntryRecord[] = [];
  const repo = {
    listItems: async () => [...items], listEntries: async () => [...entries],
    nextItemId: async () => items.length + 1, nextEntryId: async () => entries.length + 1,
    saveItem: async (item: ItemRecord) => { items.push(item); return item; },
    saveEntry: async (entry: EntryRecord) => { entries.push(entry); return entry; },
    addLearnedMapping: async (learned: LearnedMapping) => learned,
  } as unknown as TableRepository;
  return { repo, items, entries };
}
describe("manual statement persistence", () => {
  it("keeps the refund sign", () => {
    expect(manualMappingToEntry(1, mapping, "id", "2026-09-10").amount).toBe(-25);
  });
  it("counts new manual items and does not duplicate a repeated mapping or retry", async () => {
    const { repo, items, entries } = memoryRepository();
    const first = await applyStatementPreview(repo, preview, [mapping, mapping]);
    expect(first).toMatchObject({ itemsCreated: 1, entriesCreated: 1, manualMappingsApplied: 1 });
    expect(entries[0].amount).toBe(-25);
    const second = await applyStatementPreview(repo, preview, [mapping]);
    expect(second).toMatchObject({ itemsCreated: 0, entriesCreated: 0 });
    expect(items).toHaveLength(1);
    expect(entries).toHaveLength(1);
  });
  it("rejects fabricated mappings before making any writes", async () => {
    const { repo, items, entries } = memoryRepository();
    await expect(applyStatementPreview(repo, preview, [{ ...mapping, amount: 999 }])).rejects.toThrow("not present in this statement");
    expect(items).toHaveLength(0);
    expect(entries).toHaveLength(0);
  });
  it("reuses a service for multiple manually mapped charges", async () => {
    const { repo, items, entries } = memoryRepository();
    const second = { ...mapping, date: "2026-09-07", amount: 75, description: "NEWCLOUD 75,00" };
    const result = await applyStatementPreview(repo, { ...preview, unclassified: [mapping, second] }, [mapping, second]);
    expect(result).toMatchObject({ itemsCreated: 1, entriesCreated: 2 });
    expect(items).toHaveLength(1);
    expect(entries.map(e => e.amount)).toEqual([-25, 75]);
  });
});
