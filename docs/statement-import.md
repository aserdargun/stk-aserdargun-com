# Credit-card statement import

Stackfolio detects **digital-service** charges (subscriptions, cloud, AI APIs,
hosting, streaming) from Yapı Kredi credit-card statements and reconciles them
into the cost ledger. Everything else on the statement — groceries, dining,
e-commerce, medical, transport — is deliberately ignored.

For a single digital slip that did not appear on a statement (cutoff, different
card, posted later, or a one-off charge), use the **Single slip** import below.

## How it works

1. **Parse** every PDF in a folder with `pdfjs-dist`, reconstructing the
   `İşlem Tarihi / İşlemler / Tutar(TL)` rows.
2. **Classify** each transaction against the curated catalog in
   `data/card-digital-services.json` (case-insensitive regex on the merchant
   description).
3. **Deduplicate** — identical duplicate PDFs are skipped, and the same charge
   carried over into later statements as an installment/balance line is counted
   once. Two genuinely identical refund lines in one statement are kept as two.
4. **Reconcile** against `data/seed-data.json` using "statements as source of
   truth": for each digital-service item that appears in the statements, its
   ledger entries inside the statement window are *replaced* by the statement
   charges. Entries before/after the window, and items that never appear in the
   statements (annual-only services, a different card, etc.), are preserved.
5. **Report** every added entry, every dropped (replaced) seed entry, and any
   unmapped online merchant for review.

## Monthly workflow

Requirements: Node.js 22+, and the PDFs from Yapı Kredi online banking.

1. Put the month's statement PDFs into `data/statements/` (this folder is
   git-ignored; the PDFs stay local and are never committed). Alternatively pass
   any folder with `--dir`.

2. Preview without changing anything:

   ```bash
   npm run import:statements:dry
   # or: node tools/import-card-statements.mjs --dir /path/to/pdf --dry-run
   ```

   This writes `data/statement-ledger.json` (every detected charge) and
   `data/reconciliation-report.json` (the full diff), and prints a summary.

3. Apply to the seed data:

   ```bash
   npm run import:statements
   ```

   `data/seed-data.json` is backed up to
   `data/seed-data.json.backup-<date>` first, then rewritten. Review the diff
   with `git diff data/seed-data.json`.

4. Review the report — specifically the **"Seed entries replaced by statements"**
   list. Any seed entry that the statements do not confirm (for example an Azure
   charge on a different card, or a partial-month entry) is listed there. If it
   is still valid, re-add it from the Costs page.

5. (Optional) Push only the *new* items and entries to live Azure:

   ```bash
   AZURE_STORAGE_CONNECTION_STRING="..." node tools/import-card-statements.mjs \
     --dir data/statements --apply-azure
   ```

   The Azure step is additive and non-destructive: it upserts new items and new
   entries but never deletes existing Azure rows. The seed file remains the
   authoritative full dataset.

6. Commit `data/seed-data.json` (and the mapping, if you edited it).

## Adding a new digital service

When a statement shows a merchant the catalog does not know, it appears under
"unmapped online-merchant candidates" in the report. Add it to
`data/card-digital-services.json`:

```json
{
  "key": "notion",
  "name": "Notion",
  "itemKey": null,
  "category": "Platform",
  "billingType": "recurring",
  "plan": "Plus",
  "url": "https://www.notion.so/",
  "account": "aserdargun@gmail.com",
  "patterns": ["NOTION"]
}
```

- `itemKey: null` means "create a new item"; use an existing `platform-N` /
  `certificate-N` key to fold the merchant into an item that already exists.
- `billingType` is `recurring` (monthly), `annual`, or `one_time`. `one_time`
  entries keep their exact transaction date; recurring charges are bucketed to
  the first of the month.
- `patterns` are regular expressions matched against the `İşlemler` column.

## Single slip import

A digital POS slip (Yapı Kredi, Garanti, etc.) is a one-page receipt that
documents a single card transaction. Use the **Single slip** tab in the Import
view (or the `--slip` CLI flag) when:

- A charge the statement missed (after the cutoff, on a different card, posted
  late, or excluded from the downloaded statement PDF).
- A one-off purchase that should not be reconciled against any statement.

### What the slip parser reads

A slip is recognised by its shape: an all-caps merchant name on the first
non-empty line, a `CITY/CC` line below it, a `DD/MM/YYYY HH:MM:SS` date, a
`TUTAR: 1.188,00 TL` amount, and the standard reference fields (`SIRA NO`,
`ONAY KODU`, `BANKA REF NO`, `RRN`, `AID`, card `**** 1234`). All of those are
captured into the ledger entry's `note` so the slip stays traceable.

### How the import works

1. **Parse** the slip into `{ merchant, city, date, time, amount, references }`.
2. **Classify** the merchant against the catalog the same way the statement
   flow does. The slip uses `<merchant> <city>` as the description so a catalog
   pattern can match a single token (e.g. `NETFLIX`).
3. **Reuse or create** the matching item by `(name, plan)`. If the catalog
   knows the merchant, the existing item is reused; otherwise the slip is
   surfaced for a one-off manual mapping.
4. **Add** a single ledger entry with `sourceRef = slip:<filename>#<bank-ref>`
   so the slip is traceable in the Costs → Item drawer.
5. **Dedupe** — if a matching entry already exists for `(periodStart, amount)`
   on the resolved item, the import is a no-op.

The slip flow never *replaces* a statement window. It only appends one entry,
so it is safe to run on top of the statement import.

### CLI

```bash
# Dry-run preview, no write
node tools/import-card-statements.mjs --slip path/to/slip.pdf --dry-run

# Import a slip whose merchant is in the catalog (auto-match)
node tools/import-card-statements.mjs --slip path/to/slip.pdf

# Import a slip whose merchant needs a new mapping
node tools/import-card-statements.mjs --slip path/to/slip.pdf \
  --map-name "Nanonoble" --map-category Platform --map-billing one_time \
  --map-pattern "NANONOBLE" --map-url "https://nanonoble.example"
```

`data/seed-data.json` is backed up to
`data/seed-data.json.backup-<date>` first, exactly like the statement flow.

## Caveats

- **Refunds** carry a `+` sign in the statement and are recorded as negative
  amounts, so they net out in the monthly charts.
- **Installments** repeat the same `(date, amount)` across several statements;
  the importer counts them once.
- **Two cards** — the same PDF can contain a physical card and a linked digital
  card. The importer treats every unique charge once regardless of card.
- **Foreign-currency** transactions are already converted to TRY in the
  statement's `Tutar(TL)` column, which is what gets imported.
- **Pre-statement history** (before the earliest PDF) is never touched.
- **Slip vs. statement** — a slip PDF that happens to look like a statement
  (multiple transactions) is not a slip; the slip parser returns `null` and
  the API responds with a clear error. Switch to the **Statement** tab.
