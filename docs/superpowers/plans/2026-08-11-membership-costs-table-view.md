# Stackfolio Membership, Cost Ledger, and Table View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add historical membership tracking, editable ledger entries, item-level monthly charts, fully sortable/filterable Costs columns, and a rolling 12-month Table View for active recurring services.

**Architecture:** Membership becomes an optional field on each ledger entry and is backfilled once from the legacy item `plan`. API summaries derive the current membership and latest entry ID deterministically from `periodStart`, then entry ID. Pure analytics functions build the active-recurring rolling 12-month matrix; React consumes those API contracts and keeps local table filtering/sorting in a tested helper.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Recharts 3, Azure Functions v4, Azure Table Storage, Zod 4, Vitest 4.

## Global Constraints

- Costs membership edits update the latest ledger entry; they do not create a zero-value entry.
- Items without ledger entries show no editable membership and direct the user to Add Entry.
- Existing ledger entries inherit the item-level `plan` exactly once through an idempotent storage migration.
- Membership chronology is ordered by `periodStart`, then entry ID.
- The detail chart uses the Overview Area Chart visual language and monthly ledger entries only.
- Every data-bearing Costs column is sortable and filterable; the trailing open-detail action is neither.
- Table View contains only `status === "active"` and `billingType === "recurring"` items.
- Table View spans 12 chronological months ending at the latest monthly ledger month; if none exists, it ends at the current UTC month.
- Table View monthly amounts include monthly ledger entries only; membership carries forward from the most recent entry at or before each month end.
- No ledger deletion is included.
- All API routes retain the existing owner-only authorization wrapper and private, no-store responses.
- No new runtime dependencies are introduced.

---

### Task 1: Membership Domain, Summary, and Storage Migration

**Files:**
- Modify: `api/src/lib/models.ts`
- Create: `api/src/lib/costs.ts`
- Modify: `api/src/lib/storage.ts`
- Create: `api/tests/costs.test.ts`

**Interfaces:**
- Produces: `EntryRecord.membership: string | null`.
- Produces: `latestEntry(entries): EntryRecord | null`.
- Produces: `summarizeItems(items, entries): CostItemSummaryRecord[]` with `currentMembership` and `latestEntryId`.
- Produces: idempotent meta key `membershipLedgerVersion = "2026-08-11-v1"`.

- [ ] **Step 1: Write failing membership-summary tests**

```ts
it("uses period date then entry id to derive the current membership", () => {
  const result = summarizeItems([item], [
    entry({ id: 1, periodStart: "2026-01-01", membership: "Basic" }),
    entry({ id: 3, periodStart: "2026-02-01", membership: "Pro" }),
    entry({ id: 2, periodStart: "2026-02-01", membership: "Team" }),
  ])[0];
  expect(result.currentMembership).toBe("Pro");
  expect(result.latestEntryId).toBe(3);
});

it("falls back to the legacy plan when the latest membership is absent", () => {
  expect(summarizeItems([{ ...item, plan: "Legacy" }], [entry({ membership: null })])[0]
    .currentMembership).toBe("Legacy");
});
```

- [ ] **Step 2: Run `npm --workspace api test -- costs.test.ts` and verify RED**

Expected: FAIL because `../src/lib/costs.js` and `EntryRecord.membership` do not exist.

- [ ] **Step 3: Add the minimal domain and summary implementation**

```ts
export function latestEntry(entries: EntryRecord[]) {
  return entries.reduce<EntryRecord | null>((latest, entry) =>
    !latest || entry.periodStart > latest.periodStart ||
    (entry.periodStart === latest.periodStart && entry.id > latest.id) ? entry : latest, null);
}
```

Group entries once by `itemId`, calculate lifetime spend and entry count, and derive `latestPeriod`, `latestEntryId`, and `currentMembership` from the same latest record.

- [ ] **Step 4: Run the targeted tests and verify GREEN**

Run: `npm --workspace api test -- costs.test.ts`
Expected: the two summary tests pass.

- [ ] **Step 5: Extend Azure Table persistence and migration**

Add `membership?: string` to `EntryEntity`, serialize null as an omitted property, and deserialize absent values as null. Change initialization to seed only when `seedVersion` is missing, then run:

```ts
if (!(await this.getMeta("membershipLedgerVersion"))) {
  const itemById = new Map((await this.listItems()).map((item) => [item.id, item]));
  for (const entry of await this.listEntries()) {
    if (!entry.membership) {
      await this.saveEntry({ ...entry, membership: itemById.get(entry.itemId)?.plan || null });
    }
  }
  await this.setMeta("membershipLedgerVersion", "2026-08-11-v1");
}
```

During a fresh seed, set each entry membership from the corresponding seed item's `plan` without rewriting `data/seed-data.json`.

- [ ] **Step 6: Verify types and tests**

Run: `npm --workspace api run typecheck && npm --workspace api test`
Expected: all API tests pass and TypeScript exits 0.

---

### Task 2: Membership and Ledger Update API

**Files:**
- Modify: `api/src/functions/stackfolio.ts`
- Modify: `api/src/lib/storage.ts`
- Modify: `src/client/types.ts`
- Modify: `src/client/lib/api.ts`
- Modify: `src/client/components/AddCostModal.tsx`

**Interfaces:**
- Consumes: `summarizeItems` and `EntryRecord.membership` from Task 1.
- Produces: `PATCH /api/items/{id}/entries/{entryId}`.
- Produces: `api.updateEntry(itemId, entryId, payload)`.
- Produces: `CostItemSummary.currentMembership` and `latestEntryId`.

- [ ] **Step 1: Add a failing merge/update behavior test**

```ts
it("merges editable ledger fields while preserving identity and source metadata", () => {
  expect(updateEntry(existing, {
    amount: 149.9,
    periodStart: "2026-03-01",
    periodKind: "month",
    membership: "Professional",
    note: "Price change",
  })).toEqual({
    ...existing,
    amount: 149.9,
    periodStart: "2026-03-01",
    periodKind: "month",
    membership: "Professional",
    note: "Price change",
  });
});
```

- [ ] **Step 2: Run the targeted test and verify RED**

Run: `npm --workspace api test -- costs.test.ts`
Expected: FAIL because `updateEntry` is not exported.

- [ ] **Step 3: Implement the entry update domain function and repository lookup**

Add `TableRepository.getEntryForItem(itemId, entryId)` using the item partition and padded row key. The domain merge must round amount, uppercase currency, normalize blank membership/note to null, and retain `id`, `itemId`, `sourceRef`, and `createdAt`.

- [ ] **Step 4: Add API validation and route**

Create an entry update schema that permits `adjustment` for existing rows and accepts:

```ts
{
  amount: number;
  currency: string;
  periodStart: string;
  periodKind: "month" | "year" | "one_time" | "adjustment";
  membership?: string | null;
  note?: string | null;
}
```

Register `PATCH items/{id}/entries/{entryId}` under `protectedHandler`. Return 400 for invalid IDs, 404 for an entry outside the item, and the refreshed item detail on success.

- [ ] **Step 5: Extend create/list client contracts and Add Cost**

Include membership in initial-entry and Add Entry payloads. Relabel the old Add Cost “Plan or tier” field as “Membership”, send it both as legacy `plan` and `initialEntry.membership`, and expose `currentMembership` plus `latestEntryId` in `CostItemSummary`.

- [ ] **Step 6: Run API tests and full typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass and both client/API TypeScript checks exit 0.

---

### Task 3: Item Detail Monthly Chart and Editable Ledger History

**Files:**
- Create: `src/client/lib/costs.ts`
- Create: `src/client/lib/costs.test.ts`
- Create: `src/client/components/ItemMonthlyChart.tsx`
- Modify: `src/client/components/ItemDrawer.tsx`
- Modify: `package.json`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: `buildItemMonthlySeries(entries, requestedYear)` returning `{ year, availableYears, series }`.
- Consumes: `api.updateEntry` from Task 2.
- Produces: per-ledger-row Edit → Save/Cancel interaction.

- [ ] **Step 1: Enable the client Vitest command and write a failing chart-series test**

Add `"test:client": "vitest run src/client"` and make root `test` run client then API suites. Test literal January/February totals, 12 zero-filled months, available years descending, and default latest year.

- [ ] **Step 2: Run `npm run test:client` and verify RED**

Expected: FAIL because `buildItemMonthlySeries` does not exist.

- [ ] **Step 3: Implement the monthly-series helper and verify GREEN**

Only `periodKind === "month"` contributes. Return month labels using UTC and round to two decimals. Run `npm run test:client` and confirm the test passes.

- [ ] **Step 4: Build a lazy-loaded detail chart**

`ItemMonthlyChart.tsx` uses `ResponsiveContainer`, `AreaChart`, the same mint gradient, grid, axes, tooltip, and money formatting as Overview. `ItemDrawer` lazy-loads it through `lazy(() => import(...))`, preventing Recharts from entering the initial Costs bundle.

- [ ] **Step 5: Add year selection and ledger edit state**

At the top of Cost Detail, render the chart and year selector. For each ledger row, Edit copies amount, date, entry type, membership, and note into controlled state. Save calls `api.updateEntry`; Cancel restores read-only view. Stop row/button events from closing or opening unrelated UI.

- [ ] **Step 6: Add membership to Add Entry**

Default the Add Entry membership to `detail.entries[0]?.membership || detail.item.plan || ""`. Save it with the entry and refresh detail.

- [ ] **Step 7: Verify client tests, typecheck, and app build**

Run: `npm run test:client && npm run typecheck && npm run build:app`
Expected: tests pass, TypeScript exits 0, and Vite produces separate Dashboard and item-chart chunks.

---

### Task 4: Sortable, Fully Filterable Costs Table and Inline Membership

**Files:**
- Modify: `src/client/lib/costs.ts`
- Modify: `src/client/lib/costs.test.ts`
- Modify: `src/client/components/CostsPage.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: `CostFilters`, `CostSort`, and `filterAndSortCosts(items, filters, sort)`.
- Consumes: `latestEntryId`, `currentMembership`, and `api.updateEntry`.

- [ ] **Step 1: Write failing literal filter/sort tests**

Cover text search, category, billing, membership, status, latest-date from/to, lifetime minimum/maximum, ascending numeric sort, descending date sort, and immutable input order.

- [ ] **Step 2: Run client tests and verify RED**

Run: `npm run test:client`
Expected: FAIL because `filterAndSortCosts` is missing.

- [ ] **Step 3: Implement the pure filter/sort helper and verify GREEN**

Use stable ID tie-breaking, lowercase trimmed text matching, null-safe comparisons, and `toSorted` so API state is not mutated. Run the targeted client test until it passes.

- [ ] **Step 4: Replace server-driven filter state with local table state**

Fetch item summaries once per reload. Keep global search, add a collapsible “Column filters” grid for Cost, Category, Billing, Membership, Status, Latest Entry date range, and Lifetime Spend range. A clear action resets every filter.

- [ ] **Step 5: Make every data header sortable**

Headers are buttons with `aria-sort`, visible ascending/descending icons, and deterministic cycling. The open-detail chevron remains an action-only column.

- [ ] **Step 6: Add inline membership editing**

The Membership cell shows current membership and an Edit button. Save patches the latest ledger entry while preserving its other fields; therefore load detail before patching. If `latestEntryId` is null, render “Add an entry first” and no edit control. Stop propagation so editing does not open the drawer.

- [ ] **Step 7: Keep mobile cards equivalent**

Show current membership in mobile metadata and expose the same edit action without swallowing the card’s detail navigation.

- [ ] **Step 8: Verify tests, typecheck, and build**

Run: `npm test && npm run typecheck && npm run build:app`
Expected: every suite passes and production build exits 0.

---

### Task 5: Active Recurring Rolling 12-Month Table View

**Files:**
- Modify: `api/src/lib/costs.ts`
- Modify: `api/tests/costs.test.ts`
- Modify: `api/src/functions/stackfolio.ts`
- Modify: `src/client/types.ts`
- Modify: `src/client/lib/api.ts`
- Create: `src/client/components/TableViewPage.tsx`
- Modify: `src/client/App.tsx`
- Modify: `src/client/styles.css`

**Interfaces:**
- Produces: `buildRecurringTableView(items, entries, now?)`.
- Produces: owner-only `GET /api/table-view`.
- Produces: `TableViewData` with `periods`, `rows`, `monthlyTotals`, and `grandTotal`.

- [ ] **Step 1: Write failing rolling-window and totals tests**

Use fixtures containing active recurring, closed recurring, active annual, and active one-time items. Assert only active recurring rows remain; the latest monthly record anchors the final month; exactly 12 chronological periods appear; same-month amounts aggregate; membership carries forward; monthly totals and grand total are literal hand-calculated values.

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm --workspace api test -- costs.test.ts`
Expected: FAIL because `buildRecurringTableView` is missing.

- [ ] **Step 3: Implement matrix analytics and verify GREEN**

Build period keys without locale-dependent parsing, index entries by item, sum only monthly entries in each month, and choose each cell membership from the latest entry at or before that month end with item `plan` fallback.

- [ ] **Step 4: Add owner-only API and client contract**

Register `GET table-view` under `protectedHandler`, read items/entries in parallel with `Promise.all`, and return the pure analytics result. Add `api.getTableView()` and matching client interfaces.

- [ ] **Step 5: Build the Table View page and navigation**

Lazy-load `TableViewPage` from `App`. Add a Table View navigation item. Render a horizontally scrollable table with sticky Service column, Current Membership column, 12 month columns, and sticky 12-month Total column. Each monthly cell shows formatted amount and its effective membership. A footer shows monthly totals and the grand total.

- [ ] **Step 6: Add responsive and empty/loading/error states**

Preserve horizontal scrolling on small screens, minimum touch targets, readable sticky-column layering, and an explicit empty state when no active recurring service exists.

- [ ] **Step 7: Run the full automated verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all tests pass; both app and API production builds exit 0.

---

### Task 6: Rendered QA, Documentation, and Remote Delivery Preparation

**Files:**
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml` only if the existing workflow does not run the updated root test/build commands.

**Interfaces:**
- Consumes: all user-visible flows from Tasks 1–5.
- Produces: verified implementation diff ready for GitHub publication.

- [ ] **Step 1: Update behavior documentation**

Document entry-level membership history, the idempotent migration, entry editing, Costs column filters/sorting, and Table View's active-recurring/latest-12-month rules.

- [ ] **Step 2: Start the frontend and define the QA flow**

The flow under test is: Overview → Costs → column filter/sort → inline membership edit → Cost Detail chart and ledger edit → Table View → monthly and 12-month totals.

- [ ] **Step 3: Validate rendered desktop and mobile states**

Use the available Browser path; if unavailable, use the existing Playwright runtime only when present. Intercept API calls with representative fixtures rather than committing test-only backend bypasses. Check page identity, nonblank content, framework overlay, console errors/warnings, interaction state changes, horizontal table scrolling, and responsive clipping.

- [ ] **Step 4: Run fresh final verification**

Run: `npm test && npm run typecheck && npm run build && git diff --check`
Expected: zero failed tests, zero type errors, successful app/API build, and no whitespace errors.

- [ ] **Step 5: Review the requirement checklist and diff**

Confirm membership exists in both add forms, Costs inline edit updates latest entry, detail chart/year selector render, ledger rows edit all requested fields, all Costs data columns filter/sort, Table View includes only active recurring items, 12 periods and all totals render, authorization wrappers remain on all new data routes, and no delete action exists.

