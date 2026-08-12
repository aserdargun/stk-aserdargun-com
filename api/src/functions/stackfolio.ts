import {
  app,
  type HttpHandler,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import { z } from "zod";
import { buildDashboard } from "../lib/analytics.js";
import { isAuthorizedRequest } from "../lib/auth.js";
import { buildRecurringTableView, summarizeItems, updateEntry } from "../lib/costs.js";
import { isValidIsoDate } from "../lib/dates.js";
import type { EntryRecord, ItemRecord } from "../lib/models.js";
import { TableRepository } from "../lib/storage.js";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.")
  .refine(isValidIsoDate, "Use a valid calendar date.");
const categorySchema = z.enum(["Platform", "Certificate", "Device", "Other"]);
const billingTypeSchema = z.enum(["recurring", "annual", "one_time"]);
const statusSchema = z.enum(["active", "closed"]);
const periodKindSchema = z.enum(["month", "year", "one_time"]);
const editablePeriodKindSchema = z.enum(["month", "year", "one_time", "adjustment"]);
const entrySchema = z.object({
  amount: z.coerce.number().finite(),
  currency: z.string().trim().min(3).max(3).default("TRY"),
  periodStart: dateSchema,
  periodKind: periodKindSchema,
  membership: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});
const updateEntrySchema = z
  .object({
    amount: z.coerce.number().finite(),
    currency: z.string().trim().min(3).max(3),
    periodStart: dateSchema,
    periodKind: editablePeriodKindSchema,
    membership: z.string().trim().max(120).nullable(),
    note: z.string().trim().max(500).nullable(),
  })
  .partial();
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
const filtersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  category: categorySchema.optional(),
  status: statusSchema.optional(),
});

let repository: TableRepository | undefined;
const getRepository = async () => {
  repository ??= new TableRepository();
  await repository.initialize();
  return repository;
};
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const emptyToNull = (value: string | null | undefined) => value || null;
const json = (jsonBody: unknown, status = 200): HttpResponseInit => ({
  status,
  jsonBody,
  headers: { "Cache-Control": "private, no-store" },
});
const isAuthorized = (request: HttpRequest) =>
  isAuthorizedRequest({
    encodedPrincipal: request.headers.get("x-ms-client-principal"),
    allowedGithubUser: process.env.STACKFOLIO_ALLOWED_GITHUB_USER,
    requestUrl: request.url,
    localAuthBypass: process.env.STACKFOLIO_LOCAL_AUTH_BYPASS,
    azureSiteName: process.env.WEBSITE_SITE_NAME,
    localProxyMode: process.env.STACKFOLIO_LOCAL_PROXY_MODE,
    expectedLocalProxyToken: process.env.STACKFOLIO_LOCAL_PROXY_TOKEN,
    presentedLocalProxyToken: request.headers.get("x-stackfolio-local-proxy-token"),
  });

function protectedHandler(handler: HttpHandler): HttpHandler {
  return async (request, context) => {
    if (!isAuthorized(request)) {
      return json({ error: "This Stackfolio account is private." }, 403);
    }
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ error: "Validation failed.", details: error.issues }, 400);
      }
      context.error(error);
      return json({ error: "An unexpected server error occurred." }, 500);
    }
  };
}

const parseId = (request: HttpRequest, parameter = "id") => {
  const id = Number(request.params[parameter]);
  return Number.isInteger(id) && id > 0 ? id : null;
};

async function itemDetail(repo: TableRepository, id: number) {
  const item = await repo.getItem(id);
  if (!item) return null;
  return { item, entries: await repo.listEntriesForItem(id) };
}

app.http("healthz", {
  route: "healthz",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async () => json({ status: "ok" }),
});

app.http("session", {
  route: "session",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request) => json({ owner: isAuthorized(request) }),
});

app.http("health", {
  route: "health",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: protectedHandler(async () => {
    const repo = await getRepository();
    return json({ status: "ok", storage: "connected", items: (await repo.listItems()).length });
  }),
});

app.http("dashboard", {
  route: "dashboard",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: protectedHandler(async (request) => {
    const repo = await getRepository();
    const requestedYear = request.query.get("year") ? Number(request.query.get("year")) : undefined;
    const sourceGrandTotal = await repo.getMeta("sourceGrandTotal");
    return json(
      buildDashboard(
        await repo.listItems(),
        await repo.listEntries(),
        typeof sourceGrandTotal === "number" ? sourceGrandTotal : null,
        Number.isInteger(requestedYear) ? requestedYear : undefined,
      ),
    );
  }),
});

app.http("tableView", {
  route: "table-view",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: protectedHandler(async () => {
    const repo = await getRepository();
    const [items, entries] = await Promise.all([repo.listItems(), repo.listEntries()]);
    return json(buildRecurringTableView(items, entries));
  }),
});

app.http("items", {
  route: "items",
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: protectedHandler(async (request) => {
    const repo = await getRepository();
    if (request.method === "POST") {
      const payload = itemSchema.parse(await request.json());
      const id = await repo.nextItemId();
      const now = new Date().toISOString();
      const item: ItemRecord = {
        id,
        name: payload.name,
        category: payload.category,
        billingType: payload.billingType,
        plan: emptyToNull(payload.plan),
        url: emptyToNull(payload.url),
        account: emptyToNull(payload.account),
        powerWatts: payload.powerWatts ?? null,
        status: payload.status,
        closedAt:
          payload.status === "closed"
            ? payload.closedAt || new Date().toISOString().slice(0, 10)
            : null,
        notes: emptyToNull(payload.notes),
        createdAt: now,
        updatedAt: now,
      };
      await repo.saveItem(item);
      if (payload.initialEntry) {
        await repo.saveEntry({
          id: await repo.nextEntryId(),
          itemId: id,
          amount: round(payload.initialEntry.amount),
          currency: payload.initialEntry.currency.toUpperCase(),
          periodStart: payload.initialEntry.periodStart,
          periodKind: payload.initialEntry.periodKind,
          membership: emptyToNull(payload.initialEntry.membership),
          note: emptyToNull(payload.initialEntry.note),
          sourceRef: null,
          createdAt: now,
        });
      }
      return json(await itemDetail(repo, id), 201);
    }

    const filters = filtersSchema.parse({
      search: request.query.get("search") || undefined,
      category: request.query.get("category") || undefined,
      status: request.query.get("status") || undefined,
    });
    const [allItems, entries] = await Promise.all([repo.listItems(), repo.listEntries()]);
    const normalizedSearch = filters.search?.toLowerCase();
    const items = summarizeItems(allItems, entries)
      .filter((item) => !filters.category || item.category === filters.category)
      .filter((item) => !filters.status || item.status === filters.status)
      .filter(
        (item) =>
          !normalizedSearch ||
          [item.name, item.currentMembership, item.account].some((value) =>
            value?.toLowerCase().includes(normalizedSearch),
          ),
      )
      .sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || a.name.localeCompare(b.name));
    return json({ items });
  }),
});

app.http("item", {
  route: "items/{id}",
  methods: ["GET", "PATCH"],
  authLevel: "anonymous",
  handler: protectedHandler(async (request) => {
    const id = parseId(request);
    if (!id) return json({ error: "Invalid cost item id." }, 400);
    const repo = await getRepository();
    const existing = await repo.getItem(id);
    if (!existing) return json({ error: "Cost item not found." }, 404);
    if (request.method === "PATCH") {
      const payload = updateItemSchema.parse(await request.json());
      const merged = { ...existing, ...payload } as ItemRecord;
      merged.plan = emptyToNull(merged.plan);
      merged.url = emptyToNull(merged.url);
      merged.account = emptyToNull(merged.account);
      merged.notes = emptyToNull(merged.notes);
      merged.closedAt =
        merged.status === "closed"
          ? merged.closedAt || new Date().toISOString().slice(0, 10)
          : null;
      merged.updatedAt = new Date().toISOString();
      await repo.saveItem(merged);
    }
    return json(await itemDetail(repo, id));
  }),
});

app.http("itemEntries", {
  route: "items/{id}/entries",
  methods: ["POST"],
  authLevel: "anonymous",
  handler: protectedHandler(async (request) => {
    const id = parseId(request);
    if (!id) return json({ error: "Invalid cost item id." }, 400);
    const repo = await getRepository();
    if (!(await repo.getItem(id))) return json({ error: "Cost item not found." }, 404);
    const payload = entrySchema.parse(await request.json());
    const entry: EntryRecord = {
      id: await repo.nextEntryId(),
      itemId: id,
      amount: round(payload.amount),
      currency: payload.currency.toUpperCase(),
      periodStart: payload.periodStart,
      periodKind: payload.periodKind,
      membership: emptyToNull(payload.membership),
      note: emptyToNull(payload.note),
      sourceRef: null,
      createdAt: new Date().toISOString(),
    };
    await repo.saveEntry(entry);
    return json({ id: entry.id, ...(await itemDetail(repo, id)) }, 201);
  }),
});

app.http("itemEntry", {
  route: "items/{id}/entries/{entryId}",
  methods: ["PATCH"],
  authLevel: "anonymous",
  handler: protectedHandler(async (request) => {
    const id = parseId(request);
    const entryId = parseId(request, "entryId");
    if (!id || !entryId) return json({ error: "Invalid ledger entry id." }, 400);
    const repo = await getRepository();
    const existing = await repo.getEntryForItem(id, entryId);
    if (!existing) return json({ error: "Ledger entry not found." }, 404);
    const payload = updateEntrySchema.parse(await request.json());
    await repo.saveEntry(
      updateEntry(existing, {
        amount: payload.amount ?? existing.amount,
        currency: payload.currency ?? existing.currency,
        periodStart: payload.periodStart ?? existing.periodStart,
        periodKind: payload.periodKind ?? existing.periodKind,
        membership:
          payload.membership === undefined ? existing.membership : payload.membership,
        note: payload.note === undefined ? existing.note : payload.note,
      }),
    );
    return json(await itemDetail(repo, id));
  }),
});
