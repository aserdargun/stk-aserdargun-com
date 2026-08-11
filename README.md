# Stackfolio

Stackfolio is a private, English-language web application for tracking digital
investments and recurring costs. It combines platforms, certificates, devices,
and future cost items with monthly and yearly analytics, historical membership
tracking, and an active-recurring 12-month table.

## Architecture

- React and Vite frontend on Azure Static Web Apps
- TypeScript Azure Functions API in `api/`
- Azure Table Storage for durable items, ledger entries, and import metadata
- Azure Static Web Apps GitHub authentication for every app route
- API owner check against the exact `STACKFOLIO_ALLOWED_GITHUB_USER`

The site, API, and storage are designed to stay inside the Azure free or
consumption allowances for a small personal workload. The IHS-managed custom
domain is `stackfolio.aserdargun.com`.

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

Existing ledger rows receive the legacy item `plan` as their entry-level
membership through the one-time, idempotent
`membershipLedgerVersion = "2026-08-11-v1"` storage migration. Fresh seeds set
the same membership while loading the unchanged seed JSON. Membership history
is chronological: Stackfolio chooses the newest `periodStart`, then the highest
entry ID when multiple entries share a date. An explicitly absent membership on
the latest row falls back to the legacy item plan.

## Cost and ledger workflows

- Add Cost records the Membership on both the compatibility `plan` field and
  the initial ledger entry.
- Add Entry defaults Membership from the newest ledger row, then the legacy
  plan, and stores the value with the new entry.
- Ledger rows can edit amount, entry date, entry type, membership, and note.
  Identity, item ownership, source reference, and creation timestamp stay
  unchanged. Ledger deletion is intentionally not available.
- The Costs table fetches summaries once per reload, then applies local search,
  column filters, and sorting without mutating API state. Cost, Category,
  Billing, Membership, Status, Latest Entry, and Lifetime Spend are all
  filterable and sortable on desktop, with equivalent membership information
  and editing on mobile.
- Inline Membership edits update the latest ledger entry. Items without a
  ledger entry instead show “Add an entry first”; no zero-value entry is
  synthesized.
- Cost Detail lazily loads a monthly-only area chart with a year selector.
  Annual, one-time, and reconciliation entries remain in totals and history but
  do not contribute to that chart.

## Table View rules

Table View is owner-only and contains only active items whose billing type is
Recurring. It presents 12 chronological months ending at the latest monthly
ledger month; when no monthly entry exists, the window ends at the current UTC
month. Monthly cells sum monthly entries only. Each cell carries membership
forward from the latest ledger entry at or before that month end, with the item
plan as fallback. Row totals, monthly footer totals, and the 12-month grand
total use the same matrix.

## Local validation

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run typecheck
npm test
npm run build
```

For full local frontend/API development, copy
`api/local.settings.example.json` to `api/local.settings.json`, run Azurite, and
then run the combined application with:

```bash
npx @azure/static-web-apps-cli start dist --api-location api
```

The Static Web Apps CLI serves it at `http://localhost:4280`. `npm run dev`
starts the Vite frontend only.

## Azure settings

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
OAuth login and logout callbacks use fully qualified
`https://stackfolio.aserdargun.com` return URLs.

## Privacy

The repository remains private because the seed contains personal account and
spending metadata. Never put Azure connection strings or authentication tokens
in Git. Storage must disallow anonymous access and require HTTPS. Treat a release
as complete only after checking authentication, data reconciliation, write
persistence, DNS, and the managed TLS certificate on the live custom domain.
