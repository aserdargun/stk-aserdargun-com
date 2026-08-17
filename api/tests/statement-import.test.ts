import { describe, expect, it } from "vitest";
import {
  classifyDescription,
  compileServices,
  parseAmount,
  parseStatementLines,
  resolveItem,
} from "../src/lib/statement-import.js";
import type { ItemRecord } from "../src/lib/models.js";

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
});
