# Stackfolio

Stackfolio is a private, English-language web application for tracking digital investments and recurring costs. It combines platforms, certificates, devices, and any future cost items in a SQLite-backed portfolio with monthly and yearly analytics.

## What it does

- Shows lifetime, yearly, and latest monthly spend
- Visualizes monthly trends, annual totals, and category allocation
- Tracks active and closed costs without deleting their history
- Adds new cost items and new ledger entries to existing items
- Filters costs by search, category, and status
- Keeps all application data in a local SQLite database
- Seeds the existing Excel workbook data on first run

## Data migration

The source workbook was imported into `data/seed-data.json` with these controls:

- 51 cost items
- 156 ledger entries
- ₺426,621.77 reconciled lifetime total
- ₺250,539.09 in devices
- ₺71,422.03 in certificates
- ₺104,660.65 in platforms

Monthly platform values remain monthly entries. Certificates and devices only had annual totals in the workbook, so Stackfolio preserves those as annual entries instead of inventing purchase months. Reconciliation entries preserve the workbook's stored yearly platform totals and are excluded from the monthly chart.

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs at `http://127.0.0.1:3001` and creates `data/stackfolio.db` automatically on first start.

## Production-style local run

```bash
npm run build
npm start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001).

## Commands

```bash
npm run typecheck
npm test
npm run build
```

`npm run db:seed` creates a new database only when `data/stackfolio.db` does not already exist. It deliberately refuses to overwrite an existing database.

## Storage and privacy

The SQLite database and its WAL files are git-ignored. The private repository contains the workbook-derived seed data so a clean clone can initialize the same portfolio. Keep the repository private because the seed includes personal account metadata from the source workbook.

Stackfolio does not include authentication in this local-first version. Do not expose it directly to the public internet without adding access control, HTTPS, backups, and secret management.
