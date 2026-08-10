import fs from "node:fs";
import { getDefaultDatabasePath, openDatabase } from "../src/server/db.js";

const databasePath = getDefaultDatabasePath();
if (fs.existsSync(databasePath)) {
  throw new Error(
    `Database already exists at ${databasePath}. Move it aside before reseeding to avoid accidental data loss.`,
  );
}

const db = openDatabase(databasePath);
const counts = db
  .prepare(
    "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM cost_entries) AS entries, (SELECT ROUND(SUM(amount), 2) FROM cost_entries) AS total",
  )
  .get() as { items: number; entries: number; total: number };
console.log({ databasePath, ...counts });
db.close();
