import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import type Database from "better-sqlite3";
import { z } from "zod";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.");
const categorySchema = z.enum(["Platform", "Certificate", "Device", "Other"]);
const billingTypeSchema = z.enum(["recurring", "annual", "one_time"]);
const statusSchema = z.enum(["active", "closed"]);
const periodKindSchema = z.enum(["month", "year", "one_time"]);

const entrySchema = z.object({
  amount: z.coerce.number().finite(),
  currency: z.string().trim().min(3).max(3).default("TRY"),
  periodStart: dateSchema,
  periodKind: periodKindSchema,
  note: z.string().trim().max(500).optional().nullable(),
});

const itemSchema = z.object({
  name: z.string().trim().min(1).max(140),
  category: categorySchema,
  billingType: billingTypeSchema,
  plan: z.string().trim().max(120).optional().nullable(),
  url: z.union([z.url(), z.literal("")]).optional().nullable(),
  account: z.string().trim().max(160).optional().nullable(),
  powerWatts: z.coerce.number().nonnegative().optional().nullable(),
  status: statusSchema.default("active"),
  closedAt: dateSchema.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  initialEntry: entrySchema.optional(),
});

const updateItemSchema = itemSchema.omit({ initialEntry: true }).partial();

const emptyToNull = (value: string | null | undefined) => (value ? value : null);
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function parseJson(value: string | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function getDashboard(db: Database.Database, requestedYear?: number) {
  const yearRows = db
    .prepare(
      "SELECT DISTINCT CAST(substr(period_start, 1, 4) AS INTEGER) AS year FROM cost_entries ORDER BY year DESC",
    )
    .all() as Array<{ year: number }>;
  const availableYears = yearRows.map((row) => row.year);
  const year = requestedYear && availableYears.includes(requestedYear) ? requestedYear : availableYears[0];
  const yearText = String(year);

  const lifetime = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entries").get() as {
    total: number;
  };
  const yearSpend = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entries WHERE substr(period_start, 1, 4) = ?")
    .get(yearText) as { total: number };
  const previousYearSpend = db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entries WHERE substr(period_start, 1, 4) = ?")
    .get(String(year - 1)) as { total: number };
  const itemCounts = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed FROM items",
    )
    .get() as { total: number; active: number; closed: number };
  const latestMonth = db
    .prepare("SELECT MAX(substr(period_start, 1, 7)) AS period FROM cost_entries WHERE period_kind = 'month'")
    .get() as { period: string | null };
  const latestMonthlySpend = latestMonth.period
    ? (db
        .prepare(
          "SELECT COALESCE(SUM(amount), 0) AS total FROM cost_entries WHERE period_kind = 'month' AND substr(period_start, 1, 7) = ?",
        )
        .get(latestMonth.period) as { total: number }).total
    : 0;

  const monthlyRows = db
    .prepare(
      `SELECT CAST(substr(period_start, 6, 2) AS INTEGER) AS month, COALESCE(SUM(amount), 0) AS total
       FROM cost_entries
       WHERE substr(period_start, 1, 4) = ? AND period_kind = 'month'
       GROUP BY month ORDER BY month`,
    )
    .all(yearText) as Array<{ month: number; total: number }>;
  const monthlyMap = new Map(monthlyRows.map((row) => [row.month, row.total]));
  const monthlySeries = Array.from({ length: 12 }, (_, index) => ({
    period: `${year}-${String(index + 1).padStart(2, "0")}-01`,
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(Date.UTC(year, index, 1))),
    spend: round(monthlyMap.get(index + 1) || 0),
  }));

  const yearlySeries = (
    db
      .prepare(
        `SELECT CAST(substr(period_start, 1, 4) AS INTEGER) AS year, COALESCE(SUM(amount), 0) AS spend
         FROM cost_entries GROUP BY year ORDER BY year`,
      )
      .all() as Array<{ year: number; spend: number }>
  ).map((row) => ({ year: String(row.year), spend: round(row.spend) }));

  const categorySeries = (
    db
      .prepare(
        `SELECT i.category AS category, COALESCE(SUM(e.amount), 0) AS spend
         FROM items i JOIN cost_entries e ON e.item_id = i.id
         WHERE substr(e.period_start, 1, 4) = ?
         GROUP BY i.category ORDER BY spend DESC`,
      )
      .all(yearText) as Array<{ category: string; spend: number }>
  ).map((row) => ({ ...row, spend: round(row.spend) }));

  const lifetimeCategories = (
    db
      .prepare(
        `SELECT i.category AS category, COALESCE(SUM(e.amount), 0) AS spend
         FROM items i JOIN cost_entries e ON e.item_id = i.id
         GROUP BY i.category ORDER BY spend DESC`,
      )
      .all() as Array<{ category: string; spend: number }>
  ).map((row) => ({ ...row, spend: round(row.spend) }));

  const topItems = (
    db
      .prepare(
        `SELECT i.id, i.name, i.category, i.status, COALESCE(SUM(e.amount), 0) AS spend
         FROM items i JOIN cost_entries e ON e.item_id = i.id
         WHERE substr(e.period_start, 1, 4) = ?
         GROUP BY i.id ORDER BY spend DESC LIMIT 7`,
      )
      .all(yearText) as Array<{ id: number; name: string; category: string; status: string; spend: number }>
  ).map((row) => ({ ...row, spend: round(row.spend) }));

  const allocation = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM cost_entries
       WHERE substr(period_start, 1, 4) = ? AND period_kind IN ('year', 'one_time', 'adjustment')`,
    )
    .get(yearText) as { total: number };
  const sourceTotal = db.prepare("SELECT value FROM app_meta WHERE key = 'sourceGrandTotal'").get() as
    | { value: string }
    | undefined;

  return {
    year,
    availableYears,
    metrics: {
      lifetimeSpend: round(lifetime.total),
      yearSpend: round(yearSpend.total),
      previousYearSpend: round(previousYearSpend.total),
      yearOverYearPercent:
        previousYearSpend.total === 0
          ? null
          : round(((yearSpend.total - previousYearSpend.total) / Math.abs(previousYearSpend.total)) * 100),
      trackedItems: itemCounts.total,
      activeItems: itemCounts.active || 0,
      closedItems: itemCounts.closed || 0,
      latestMonthlySpend: round(latestMonthlySpend),
      latestMonthlyPeriod: latestMonth.period ? `${latestMonth.period}-01` : null,
      annualOnlySpend: round(allocation.total),
      sourceGrandTotal: parseJson(sourceTotal?.value),
    },
    monthlySeries,
    yearlySeries,
    categorySeries,
    lifetimeCategories,
    topItems,
  };
}

function getItem(db: Database.Database, id: number) {
  const item = db
    .prepare(
      `SELECT id, name, category, billing_type AS billingType, plan, url, account,
              power_watts AS powerWatts, status, closed_at AS closedAt, notes,
              created_at AS createdAt, updated_at AS updatedAt
       FROM items WHERE id = ?`,
    )
    .get(id);
  if (!item) return null;
  const entries = db
    .prepare(
      `SELECT id, amount, currency, period_start AS periodStart, period_kind AS periodKind,
              note, source_ref AS sourceRef, created_at AS createdAt
       FROM cost_entries WHERE item_id = ? ORDER BY period_start DESC, id DESC`,
    )
    .all(id);
  return { item, entries };
}

export interface CreateAppOptions {
  serveClient?: boolean;
}

export function createApp(db: Database.Database, options: CreateAppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));

  app.get("/api/health", (_request, response) => {
    const itemCount = db.prepare("SELECT COUNT(*) AS count FROM items").get() as { count: number };
    response.json({ status: "ok", database: "connected", items: itemCount.count });
  });

  app.get("/api/dashboard", (request, response) => {
    const parsedYear = request.query.year ? Number(request.query.year) : undefined;
    response.json(getDashboard(db, Number.isInteger(parsedYear) ? parsedYear : undefined));
  });

  app.get("/api/items", (request, response) => {
    const query = z
      .object({
        search: z.string().trim().max(120).optional(),
        category: categorySchema.optional(),
        status: statusSchema.optional(),
      })
      .parse(request.query);
    const conditions: string[] = [];
    const parameters: string[] = [];
    if (query.search) {
      conditions.push("(i.name LIKE ? OR i.plan LIKE ? OR i.account LIKE ?)");
      parameters.push(`%${query.search}%`, `%${query.search}%`, `%${query.search}%`);
    }
    if (query.category) {
      conditions.push("i.category = ?");
      parameters.push(query.category);
    }
    if (query.status) {
      conditions.push("i.status = ?");
      parameters.push(query.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const items = db
      .prepare(
        `SELECT i.id, i.name, i.category, i.billing_type AS billingType, i.plan, i.url, i.account,
                i.power_watts AS powerWatts, i.status, i.closed_at AS closedAt, i.notes,
                COALESCE(SUM(e.amount), 0) AS lifetimeSpend, COUNT(e.id) AS entryCount,
                MAX(e.period_start) AS latestPeriod
         FROM items i LEFT JOIN cost_entries e ON e.item_id = i.id
         ${where}
         GROUP BY i.id
         ORDER BY CASE i.status WHEN 'active' THEN 0 ELSE 1 END, i.name COLLATE NOCASE`,
      )
      .all(...parameters);
    response.json({ items });
  });

  app.get("/api/items/:id", (request, response) => {
    const item = getItem(db, Number(request.params.id));
    if (!item) return response.status(404).json({ error: "Cost item not found." });
    response.json(item);
  });

  app.post("/api/items", (request, response) => {
    const payload = itemSchema.parse(request.body);
    const create = db.transaction(() => {
      const closedAt = payload.status === "closed" ? payload.closedAt || new Date().toISOString().slice(0, 10) : null;
      const result = db
        .prepare(
          `INSERT INTO items (
             name, category, billing_type, plan, url, account, power_watts, status, closed_at, notes
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payload.name,
          payload.category,
          payload.billingType,
          emptyToNull(payload.plan),
          emptyToNull(payload.url),
          emptyToNull(payload.account),
          payload.powerWatts ?? null,
          payload.status,
          closedAt,
          emptyToNull(payload.notes),
        );
      const id = Number(result.lastInsertRowid);
      if (payload.initialEntry) {
        db.prepare(
          `INSERT INTO cost_entries (item_id, amount, currency, period_start, period_kind, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          id,
          round(payload.initialEntry.amount),
          payload.initialEntry.currency.toUpperCase(),
          payload.initialEntry.periodStart,
          payload.initialEntry.periodKind,
          emptyToNull(payload.initialEntry.note),
        );
      }
      return id;
    });
    const id = create();
    response.status(201).json(getItem(db, id));
  });

  app.patch("/api/items/:id", (request, response) => {
    const id = Number(request.params.id);
    const existing = getItem(db, id);
    if (!existing) return response.status(404).json({ error: "Cost item not found." });
    const payload = updateItemSchema.parse(request.body);
    const current = existing.item as Record<string, unknown>;
    const merged = { ...current, ...payload };
    const closedAt =
      merged.status === "closed"
        ? (merged.closedAt as string | null) || new Date().toISOString().slice(0, 10)
        : null;
    db.prepare(
      `UPDATE items SET name = ?, category = ?, billing_type = ?, plan = ?, url = ?, account = ?,
       power_watts = ?, status = ?, closed_at = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    ).run(
      merged.name,
      merged.category,
      merged.billingType,
      emptyToNull(merged.plan as string | null),
      emptyToNull(merged.url as string | null),
      emptyToNull(merged.account as string | null),
      merged.powerWatts ?? null,
      merged.status,
      closedAt,
      emptyToNull(merged.notes as string | null),
      id,
    );
    response.json(getItem(db, id));
  });

  app.post("/api/items/:id/entries", (request, response) => {
    const id = Number(request.params.id);
    if (!getItem(db, id)) return response.status(404).json({ error: "Cost item not found." });
    const payload = entrySchema.parse(request.body);
    const result = db
      .prepare(
        `INSERT INTO cost_entries (item_id, amount, currency, period_start, period_kind, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        round(payload.amount),
        payload.currency.toUpperCase(),
        payload.periodStart,
        payload.periodKind,
        emptyToNull(payload.note),
      );
    response.status(201).json({ id: Number(result.lastInsertRowid), ...getItem(db, id) });
  });

  if (options.serveClient) {
    const clientPath = path.join(process.cwd(), "dist");
    app.use(express.static(clientPath));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api")) {
        return response.sendFile(path.join(clientPath, "index.html"));
      }
      next();
    });
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      return response.status(400).json({ error: "Validation failed.", details: error.issues });
    }
    console.error(error);
    response.status(500).json({ error: "An unexpected server error occurred." });
  });

  return app;
}
