import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../src/server/db.js";

describe("Stackfolio database", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(":memory:");
  });

  afterEach(() => db.close());

  it("imports every workbook item and reconciles the source total", () => {
    const counts = db
      .prepare(
        "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM cost_entries) AS entries, ROUND((SELECT SUM(amount) FROM cost_entries), 2) AS total",
      )
      .get() as { items: number; entries: number; total: number };

    expect(counts).toEqual({ items: 51, entries: 156, total: 426621.77 });
  });

  it("preserves the workbook category controls", () => {
    const totals = db
      .prepare(
        `SELECT i.category, ROUND(SUM(e.amount), 2) AS total
         FROM items i JOIN cost_entries e ON e.item_id = i.id
         GROUP BY i.category ORDER BY i.category`,
      )
      .all() as Array<{ category: string; total: number }>;

    expect(totals).toEqual([
      { category: "Certificate", total: 71422.03 },
      { category: "Device", total: 250539.09 },
      { category: "Platform", total: 104660.65 },
    ]);
  });

  it("keeps annual-only imports out of the monthly series", () => {
    const monthlyNonPlatform = db
      .prepare(
        `SELECT COUNT(*) AS count FROM cost_entries e
         JOIN items i ON i.id = e.item_id
         WHERE e.period_kind = 'month' AND i.category <> 'Platform'`,
      )
      .get() as { count: number };

    expect(monthlyNonPlatform.count).toBe(0);
  });

  it("uses English display names for translated source titles", () => {
    const translated = db
      .prepare("SELECT name, notes FROM items WHERE name = 'Introduction to Clean Code'")
      .get() as { name: string; notes: string };
    expect(translated.name).toBe("Introduction to Clean Code");
    expect(translated.notes).toContain("Display title translated to English");
  });
});
