import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { SeedPayload } from "./types.js";

const schema = `
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('Platform', 'Certificate', 'Device', 'Other')),
    billing_type TEXT NOT NULL CHECK (billing_type IN ('recurring', 'annual', 'one_time')),
    plan TEXT,
    url TEXT,
    account TEXT,
    power_watts REAL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    closed_at TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS cost_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'TRY',
    period_start TEXT NOT NULL,
    period_kind TEXT NOT NULL CHECK (period_kind IN ('month', 'year', 'one_time', 'adjustment')),
    note TEXT,
    source_ref TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_entries_item ON cost_entries(item_id);
  CREATE INDEX IF NOT EXISTS idx_entries_period ON cost_entries(period_start);
  CREATE INDEX IF NOT EXISTS idx_items_status_category ON items(status, category);
`;

export interface OpenDatabaseOptions {
  seed?: boolean;
  seedPath?: string;
}

export function openDatabase(
  databasePath = process.env.STACKFOLIO_DB_PATH || path.join(process.cwd(), "data", "stackfolio.db"),
  options: OpenDatabaseOptions = {},
) {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  if (databasePath !== ":memory:") db.pragma("journal_mode = WAL");
  db.exec(schema);

  if (options.seed !== false) {
    const count = db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number };
    if (count.count === 0) {
      seedDatabase(db, options.seedPath);
    }
  }

  applyDataMigrations(db);

  return db;
}

function applyDataMigrations(db: Database.Database) {
  const migrationKey = "migration_english_display_titles_v2";
  const applied = db.prepare("SELECT 1 FROM app_meta WHERE key = ?").get(migrationKey);
  if (applied) return;

  const translations = [
    [
      ".NET ile REST API Geliştirme",
      "REST API Development with .NET",
      "Imported from the Certificates worksheet. Only annual totals were available. Display title translated to English.",
    ],
    [
      "Yapay Zeka Destekli Java ile Programlamaya Giriş",
      "Introduction to AI-Assisted Java Programming",
      "Imported from the Certificates worksheet. Only annual totals were available. Display title translated to English.",
    ],
    [
      ".NET ile Mikroservis Mimarisi",
      "Microservices Architecture with .NET",
      "Imported from the Certificates worksheet. Only annual totals were available. Display title translated to English.",
    ],
    [
      "Temiz Kod’a Giriş",
      "Introduction to Clean Code",
      "Imported from the Certificates worksheet. Only annual totals were available. Display title translated to English.",
    ],
    [
      "Macbook Pro 14 M4 Pro 1Tb + Fiba Sigorta",
      "MacBook Pro 14 M4 Pro 1TB + Fiba Insurance",
      "Imported from the Devices worksheet. Display label translated to English.",
    ],
  ] as const;

  const update = db.prepare(
    "UPDATE items SET name = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE name IN (?, ?)",
  );
  const migrate = db.transaction(() => {
    for (const [originalName, translatedName, notes] of translations) {
      update.run(translatedName, notes, originalName, translatedName);
    }
    db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?)").run(migrationKey, JSON.stringify(true));
  });
  migrate();
}

export function seedDatabase(db: Database.Database, seedPath?: string) {
  const resolvedSeedPath = seedPath || path.join(process.cwd(), "data", "seed-data.json");
  const payload = JSON.parse(fs.readFileSync(resolvedSeedPath, "utf8")) as SeedPayload;

  const insertItem = db.prepare(`
    INSERT INTO items (
      name, category, billing_type, plan, url, account, power_watts, status, closed_at, notes
    ) VALUES (
      @name, @category, @billingType, @plan, @url, @account, @powerWatts, @status, @closedAt, @notes
    )
  `);
  const insertEntry = db.prepare(`
    INSERT INTO cost_entries (
      item_id, amount, currency, period_start, period_kind, note, source_ref
    ) VALUES (
      @itemId, @amount, @currency, @periodStart, @periodKind, @note, @sourceRef
    )
  `);
  const insertMeta = db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)");

  const runSeed = db.transaction(() => {
    const itemIds = new Map<string, number>();
    for (const item of payload.items) {
      const result = insertItem.run(item);
      itemIds.set(item.key, Number(result.lastInsertRowid));
    }
    for (const entry of payload.entries) {
      const itemId = itemIds.get(entry.itemKey);
      if (!itemId) throw new Error(`Missing seed item for ${entry.itemKey}`);
      insertEntry.run({ ...entry, itemId });
    }
    for (const [key, value] of Object.entries(payload.metadata)) {
      insertMeta.run(key, JSON.stringify(value));
    }
  });

  runSeed();
}

export function getDefaultDatabasePath() {
  return process.env.STACKFOLIO_DB_PATH || path.join(process.cwd(), "data", "stackfolio.db");
}
