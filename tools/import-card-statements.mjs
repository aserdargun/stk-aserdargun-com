import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  compileServices,
  classifyDescription,
  extractPdfLines,
  parseStatementLines,
} from "./lib/statements.mjs";
import { reconcile, round2 } from "./lib/reconcile.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const DEFAULT_MAPPING = path.join(ROOT, "data", "card-digital-services.json");
const DEFAULT_SEED = path.join(ROOT, "data", "seed-data.json");
const DEFAULT_DIR = path.join(ROOT, "data", "statements");
const LEDGER_OUT = path.join(ROOT, "data", "statement-ledger.json");
const REPORT_OUT = path.join(ROOT, "data", "reconciliation-report.json");

function parseArgs(argv) {
  const args = { dir: null, seed: DEFAULT_SEED, dryRun: false, applyAzure: false, ledgerOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dir" || arg === "-d") args.dir = argv[++index];
    else if (arg === "--seed") args.seed = argv[++index];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply-azure") args.applyAzure = true;
    else if (arg === "--ledger-only") args.ledgerOnly = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function help() {
  return [
    "Usage: node tools/import-card-statements.mjs [options]",
    "",
    "Parses Yapı Kredi credit-card statement PDFs, detects digital-service charges",
    "via data/card-digital-services.json, and reconciles them into data/seed-data.json.",
    "",
    "Options:",
    "  --dir <path>       Directory containing statement PDFs (default data/statements/)",
    "  --seed <path>      Seed JSON to merge into (default data/seed-data.json)",
    "  --dry-run          Report only; do not modify seed-data.json",
    "  --ledger-only      Write the statement ledger + report, skip seed merge",
    "  --apply-azure      Upsert new items/entries to Azure (needs AZURE_STORAGE_CONNECTION_STRING)",
    "  --help             Show this help",
  ].join("\n");
}

function loadJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function roundDateNow() {
  return new Date().toISOString().slice(0, 10);
}

function isCandidateDescription(description) {
  // Flag unmapped transactions that look like an online/digital merchant for review.
  return /\.(com|io|dev|ai|app|net|org|co|cloud|tech)\b/i.test(description) || /(SUBSCR|BILL|CLOUD|PREMIUM)/i.test(description);
}

async function parseDirectory(dir) {
  const files = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort();
  if (files.length === 0) throw new Error(`No PDF files found in ${dir}`);

  const statements = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const lines = await extractPdfLines(filePath);
    const parsed = parseStatementLines(lines);
    const signature = createHash("sha1").update(lines.join("\n")).digest("hex");
    statements.push({ file, signature, ...parsed });
  }
  return statements;
}

function buildCharges(statements, services) {
  const charges = [];
  const unmapped = [];
  const seenStatements = new Set();
  const perStatementCount = new Map();
  const crossStatementSigs = new Map();

  for (const statement of statements) {
    // Skip identical duplicate PDFs (same content downloaded twice).
    if (seenStatements.has(statement.signature)) continue;
    seenStatements.add(statement.signature);

    for (const transaction of statement.transactions) {
      const service = classifyDescription(transaction.description, services);
      if (!service) {
        if (isCandidateDescription(transaction.description)) {
          unmapped.push({
            date: transaction.date,
            amount: transaction.amount,
            description: transaction.description,
            statementFile: statement.file,
          });
        }
        continue;
      }

      const baseKey = `${transaction.date}|${service.key}|${round2(transaction.amount)}`;
      const statementKey = `${statement.signature}|${baseKey}`;
      const occurrence = (perStatementCount.get(statementKey) ?? 0) + 1;
      perStatementCount.set(statementKey, occurrence);

      if (!crossStatementSigs.has(baseKey)) crossStatementSigs.set(baseKey, new Set());
      const signatures = crossStatementSigs.get(baseKey);

      // Keep the first sighting, and also keep distinct duplicate lines within the
      // same statement (e.g. two identical refunds). Skip the same charge when it is
      // carried over into a later statement as an installment/balance line.
      if (signatures.size === 0 || signatures.has(statement.signature)) {
        signatures.add(statement.signature);
        charges.push({
          date: transaction.date,
          amount: transaction.amount,
          description: transaction.description,
          service,
          statementFile: statement.file,
          cutoffDate: statement.cutoffDate,
          occurrence,
        });
      }
    }
  }

  charges.sort((a, b) => a.service.key.localeCompare(b.service.key) || a.date.localeCompare(b.date));
  return { charges, unmapped };
}

async function applyToAzure({ newItems, addedEntries, seed }) {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is required for --apply-azure.");
  }
  const { TableClient } = await import("@azure/data-tables");
  const items = TableClient.fromConnectionString(connectionString, "StackfolioItems");
  const entries = TableClient.fromConnectionString(connectionString, "StackfolioEntries");
  await items.createTable().catch(() => {});
  await entries.createTable().catch(() => {});

  const pad = (id) => String(id).padStart(8, "0");
  const now = new Date().toISOString();

  // Name -> Azure item id (names may collide, e.g. two "Claude" items).
  const idsByName = new Map();
  let maxItemId = 0;
  for await (const entity of items.listEntities({ queryOptions: { filter: "PartitionKey eq 'portfolio'" } })) {
    maxItemId = Math.max(maxItemId, Number(entity.id));
    const ids = idsByName.get(entity.name) ?? [];
    ids.push(Number(entity.id));
    idsByName.set(entity.name, ids);
  }

  let nextItemId = maxItemId + 1;
  const idByKey = new Map();
  for (const item of newItems) {
    const id = nextItemId++;
    idByKey.set(item.key, id);
    await items.upsertEntity(
      {
        partitionKey: "portfolio",
        rowKey: pad(id),
        id,
        name: item.name,
        category: item.category,
        billingType: item.billingType,
        plan: item.plan || undefined,
        url: item.url || undefined,
        account: item.account || undefined,
        powerWatts: undefined,
        status: item.status,
        closedAt: undefined,
        notes: item.notes || undefined,
        createdAt: now,
        updatedAt: now,
      },
      "Replace",
    );
    const ids = idsByName.get(item.name) ?? [];
    ids.push(id);
    idsByName.set(item.name, ids);
  }

  // Existing seed items keep their id by their position (seed ids are index+1).
  for (const [index, item] of seed.items.entries()) idByKey.set(item.key, index + 1);

  let maxEntryId = 0;
  for await (const entity of entries.listEntities()) {
    maxEntryId = Math.max(maxEntryId, Number(entity.id));
  }

  const keyToName = new Map();
  for (const item of seed.items) keyToName.set(item.key, item.name);
  for (const item of newItems) keyToName.set(item.key, item.name);

  let entryId = maxEntryId + 1;
  const skipped = [];
  for (const entry of addedEntries) {
    const itemId = idByKey.get(entry.itemKey);
    const name = keyToName.get(entry.itemKey);
    if (!itemId) {
      skipped.push({ reason: "unknown itemKey", itemKey: entry.itemKey });
      continue;
    }
    const ids = idsByName.get(name);
    if (ids && ids.length > 1 && !idByKey.has(entry.itemKey)) {
      skipped.push({ reason: "ambiguous item name", name, itemKey: entry.itemKey });
      continue;
    }
    await entries.upsertEntity(
      {
        partitionKey: pad(itemId),
        rowKey: pad(entryId),
        id: entryId,
        itemId,
        amount: entry.amount,
        currency: entry.currency,
        periodStart: entry.periodStart,
        periodKind: entry.periodKind,
        membership: entry.membership || undefined,
        note: entry.note || undefined,
        sourceRef: entry.sourceRef || undefined,
        createdAt: now,
      },
      "Replace",
    );
    entryId += 1;
  }

  return { upsertedItems: newItems.length, upsertedEntries: entryId - maxEntryId - 1, skipped };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help());
    return;
  }

  const dir = args.dir ?? DEFAULT_DIR;
  if (!existsSync(dir)) throw new Error(`Statements directory not found: ${dir}`);

  const mapping = loadJson(DEFAULT_MAPPING);
  const services = compileServices(mapping.services);
  const seed = loadJson(args.seed);

  console.log(`Parsing statements from ${dir}…`);
  const statements = await parseDirectory(dir);
  const { charges, unmapped } = buildCharges(statements, services);

  const ledger = {
    generatedAt: new Date().toISOString(),
    statementCount: statements.length,
    statements: statements.map((statement) => ({
      file: statement.file,
      cutoffDate: statement.cutoffDate,
      cards: statement.cards,
      transactionCount: statement.transactions.length,
    })),
    charges,
    unmappedCandidates: unmapped,
  };
  writeFileSync(LEDGER_OUT, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, LEDGER_OUT)} (${charges.length} digital-service charges).`);

  const now = roundDateNow();
  const { mergedSeed, report, addedEntries, newItems } = reconcile({ seed, charges, now });
  report.summary.statements = statements.length;
  report.unmappedCandidates = unmapped;
  writeFileSync(REPORT_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, REPORT_OUT)}.`);

  const created = report.newItems.map((item) => `${item.name} (${item.key})`);
  console.log("\n=== Reconciliation summary ===");
  console.log(`Statements parsed : ${statements.length}`);
  console.log(`Digital charges   : ${charges.length}`);
  console.log(`New items         : ${created.length ? created.join(", ") : "none"}`);
  console.log(`Added entries     : ${addedEntries.length}`);
  console.log(`Replaced (dropped seed entries in window): ${report.droppedEntries.length}`);

  for (const item of report.services) {
    if (item.isNew || item.droppedInWindow || item.addedFromStatements) {
      console.log(
        `  - ${item.name.padEnd(16)} added=${item.addedFromStatements} ` +
          `dropped=${item.droppedInWindow} kept-before-window=${item.keptBeforeWindow}`,
      );
    }
  }

  if (report.droppedEntries.length) {
    console.log("\nSeed entries replaced by statements (review — re-add via UI if still valid):");
    for (const entry of report.droppedEntries) {
      console.log(`  ${entry.name} ${entry.periodStart}: ${entry.amount}`);
    }
  }

  if (unmapped.length) {
    console.log(`\n${unmapped.length} unmapped online-merchant candidates (not classified):`);
    for (const candidate of unmapped) {
      console.log(`  ${candidate.date} ${candidate.amount} ${candidate.description.slice(0, 60)}`);
    }
  }

  if (args.ledgerOnly || args.dryRun) {
    console.log("\nDry run (or --ledger-only): seed-data.json was NOT modified.");
    return;
  }

  const backup = `${args.seed}.backup-${now}`;
  copyFileSync(args.seed, backup);
  writeFileSync(args.seed, `${JSON.stringify(mergedSeed, null, 2)}\n`);
  console.log(`\nBackup written to ${path.relative(ROOT, backup)}`);
  console.log(`Merged ${path.relative(ROOT, args.seed)} (${newItems.length} new items, ${addedEntries.length} new entries).`);

  if (args.applyAzure) {
    const result = await applyToAzure({ newItems, addedEntries, seed });
    console.log(
      `Azure: upserted ${result.upsertedItems} items, ${result.upsertedEntries} entries.`,
    );
    if (result.skipped.length) {
      console.log(`Azure: skipped ${result.skipped.length} entries (see report).`);
      for (const skip of result.skipped) console.log(`  - ${skip.reason}: ${skip.name ?? skip.itemKey}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
