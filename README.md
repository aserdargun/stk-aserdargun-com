# Stackfolio

Stackfolio is a private, English-language web application for tracking digital
investments and recurring costs. It combines platforms, certificates, devices,
and future cost items with monthly and yearly analytics.

## Architecture

- React and Vite frontend on Azure Static Web Apps
- TypeScript Azure Functions API in `api/`
- Azure Table Storage for durable items, ledger entries, and import metadata
- Azure Static Web Apps GitHub authentication for every app route
- API owner check against the exact `STACKFOLIO_ALLOWED_GITHUB_USER`

The site, API, and storage are designed to stay inside the Azure free or
consumption allowances for a small personal workload. The IHS-managed custom
domain is `stk.aserdargun.com`.

## Imported data

The source workbook was imported into `data/seed-data.json` with these controls:

- 51 cost items
- 156 ledger entries
- ₺426,621.77 reconciled lifetime total
- ₺250,539.09 in devices
- ₺71,422.03 in certificates
- ₺104,660.65 in platforms

The API seeds empty Azure tables idempotently on first access. Monthly platform
values remain monthly entries. Certificates and devices only had annual totals,
so those values remain annual rather than receiving invented purchase months.

## Cost and membership workflows

- Membership is stored on each ledger entry so plan changes remain historical.
- Existing Azure ledger rows are backfilled once from the legacy item `plan`
  through the idempotent `membershipLedgerVersion` migration.
- Add Cost and Add Entry both accept membership. Costs always shows the
  membership from the latest entry, ordered by entry date and then entry ID.
- Membership can be updated directly from Costs; the update modifies the latest
  ledger row and never creates a zero-value record.
- Cost Detail includes a year-selectable 12-month Area Chart. Amount, entry
  date, entry type, membership, and note are editable in Ledger History.

## Portfolio views

- **Overview:** lifetime/year metrics and portfolio analytics.
- **Costs:** all data columns are sortable and filterable, including membership,
  latest-entry date range, and lifetime-spend range.
- **Table View:** only active recurring services, across the 12 months ending at
  the latest monthly ledger month. Each cell shows actual monthly spend and the
  membership effective in that month. The footer contains monthly totals and
  the rightmost column contains rolling 12-month totals.

## Local validation

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

For full local frontend/API development without GitHub authentication, run:

```bash
npm run dev
```

This command starts Azurite, compiles and watches the API, runs Azure Functions
on port `3001`, and serves Vite at the strict endpoint
`http://127.0.0.1:5173`. A fresh private capability is shared only by Vite and
the Functions child for that run. Vite overwrites the capability header while
proxying `/api`; direct requests to the raw Functions listener remain
unauthorized even if they spoof localhost or a Static Web Apps principal.

To exercise production-like Static Web Apps routing and authentication instead,
run the Codex `Full App` action. It builds the app, puts a capability-gated API
proxy on `127.0.0.1:7071`, and serves the SWA emulator at
`http://localhost:4280`; unauthenticated users are redirected to `/login`.
The raw Functions listener uses a separate internal port and does not trust an
inherited development-bypass flag.

## Azure settings

The production naming map is:

- Resource group: `rg-stk-aserdargun-com`
- Static Web App: `swa-stk-aserdargun-com`
- Storage account: `ststkaserdarguncom`
- GitHub deployment secret: `AZURE_STATIC_WEB_APPS_API_TOKEN_STK`

The Static Web App requires these application settings:

- `AZURE_STORAGE_CONNECTION_STRING`: connection string for the private storage account
- `STACKFOLIO_ALLOWED_GITHUB_USER`: `aserdargun`

`public/staticwebapp.config.json` requires a GitHub-authenticated session for
every app and API route except the minimal `/api/healthz` probe and public access
pages. The API independently matches the GitHub identity to the configured
`aserdargun` owner before returning personal data. This avoids relying on a
custom role that may not be reflected in an existing Static Web Apps session.
Unauthenticated requests go to the public `/login` page rather than starting an
automatic GitHub OAuth round trip. GitHub sign-in begins only after the user
selects the button, and sign-out remains on a public signed-out page. Before the
React application mounts, `/api/session` confirms that the signed-in GitHub
identity matches the configured owner. Other authenticated accounts are sent to
the access-denied page, while all data endpoints retain the same owner check.
OAuth login and logout callbacks are generated from the current deployment
origin. This keeps the Azure-provided hostname usable before
`https://stk.aserdargun.com` is attached and keeps the user on that custom
domain after it is enabled.

## Privacy

The repository remains private because the seed contains personal account and
spending metadata. Never put Azure connection strings or authentication tokens
in Git. Storage must disallow anonymous access and require HTTPS. Treat a release
as complete only after checking authentication, data reconciliation, write
persistence, DNS, and the managed TLS certificate on the live custom domain.
