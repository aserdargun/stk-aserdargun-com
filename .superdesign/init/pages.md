# Page Dependency Trees

## `/` — Overview

Entry: `src/client/App.tsx` with `view === "overview"`

- `src/client/App.tsx`
  - `src/client/components/Dashboard.tsx`
    - `src/client/lib/api.ts`
    - `src/client/lib/format.ts`
    - `src/client/types.ts`
  - `src/client/components/AddCostModal.tsx`
    - `src/client/lib/api.ts`
    - `src/client/types.ts`
  - `src/client/styles.css`

## `/` — Costs

Entry: `src/client/App.tsx` with `view === "costs"`

- `src/client/App.tsx`
  - `src/client/components/CostsPage.tsx`
    - `src/client/components/ItemDrawer.tsx`
      - `src/client/components/ItemMonthlyChart.tsx`
      - `src/client/lib/api.ts`
      - `src/client/lib/costs.ts`
      - `src/client/lib/format.ts`
      - `src/client/types.ts`
    - `src/client/lib/api.ts`
    - `src/client/lib/costs.ts`
    - `src/client/lib/format.ts`
    - `src/client/types.ts`
  - `src/client/components/AddCostModal.tsx`
  - `src/client/styles.css`

## `/` — Table View

Entry: `src/client/App.tsx` with `view === "table"`

- `src/client/App.tsx`
  - `src/client/components/TableViewPage.tsx`
    - `src/client/lib/api.ts`
    - `src/client/lib/format.ts`
    - `src/client/types.ts`
  - `src/client/components/AddCostModal.tsx`
  - `src/client/styles.css`
