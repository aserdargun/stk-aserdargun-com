export const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

const CATEGORY_PREFIX = {
  Platform: "platform",
  Certificate: "certificate",
  Device: "device",
  Other: "other",
};
const CATEGORY_PLURAL = {
  Platform: "Platforms",
  Certificate: "Certificates",
  Device: "Devices",
  Other: "Other",
};

const monthOf = (periodStart) => periodStart.slice(0, 7);

function nextKey(items, category, reserved = new Set()) {
  const prefix = CATEGORY_PREFIX[category] ?? "other";
  const numbers = items
    .filter((item) => item.key.startsWith(`${prefix}-`))
    .map((item) => Number(item.key.split("-")[1]))
    .filter(Number.isFinite);
  let number = Math.max(0, ...numbers);
  let key;
  do {
    number += 1;
    key = `${prefix}-${number}`;
  } while (reserved.has(key));
  return key;
}

function chargeToEntry(charge, service, itemKey) {
  const oneTime = service.billingType === "one_time";
  const membership =
    service.plan && service.plan !== "-" && service.plan !== "None" ? service.plan : null;
  return {
    itemKey,
    amount: round2(charge.amount),
    currency: "TRY",
    periodStart: oneTime ? charge.date : `${charge.date.slice(0, 7)}-01`,
    periodKind: oneTime ? "one_time" : "month",
    membership,
    note: `Card: ${charge.description}`,
    sourceRef: charge.statementFile,
  };
}

function recomputeMetadata(seed, now, report) {
  const entries = seed.entries;
  const categoryTotals = {};
  for (const entry of entries) {
    const item = seed.items.find((candidate) => candidate.key === entry.itemKey);
    const plural = CATEGORY_PLURAL[item?.category] ?? "Other";
    categoryTotals[plural] = round2((categoryTotals[plural] ?? 0) + entry.amount);
  }
  const grandTotal = round2(entries.reduce((total, entry) => total + entry.amount, 0));
  return {
    ...seed.metadata,
    importedOn: now,
    sourceGrandTotal: grandTotal,
    importedGrandTotal: grandTotal,
    sourceCategoryTotals: categoryTotals,
    importPolicy:
      "Digital-service ledger entries are sourced from credit-card statements for the " +
      "statement-covered window. Non-digital categories and pre-statement history are preserved.",
    statementImport: {
      runDate: now,
      windowStart: report.window.start,
      windowEnd: report.window.end,
      addedEntryCount: report.summary.addedEntries,
      droppedEntryCount: report.summary.droppedEntries,
      newItemCount: report.summary.newItems,
    },
  };
}

/**
 * Reconcile statement-derived digital-service charges against the current seed using
 * "statements as source of truth": for each digital-service item that appears in the
 * statements, its ledger entries inside the statement-covered window are REPLACED by
 * the statement charges. Entries before/after the window, and items that never appear
 * in the statements, are preserved. Every dropped entry is reported for review.
 */
export function reconcile({ seed, charges, now = new Date().toISOString().slice(0, 10) }) {
  const items = [...seed.items];
  const entries = [...seed.entries];

  const keyAssignments = new Map();
  const reservedKeys = new Set();
  for (const charge of charges) {
    const service = charge.service;
    if (!service.itemKey && !keyAssignments.has(service.key)) {
      const key = nextKey(items, service.category, reservedKeys);
      reservedKeys.add(key);
      keyAssignments.set(service.key, key);
    }
  }

  const newItems = [];
  for (const [serviceKey, itemKey] of keyAssignments) {
    const service = charges.find((charge) => charge.service.key === serviceKey).service;
    newItems.push({
      key: itemKey,
      name: service.name,
      category: service.category,
      billingType: service.billingType,
      plan: service.plan && service.plan !== "-" ? service.plan : null,
      url: service.url || null,
      account: service.account || null,
      powerWatts: null,
      status: "active",
      closedAt: null,
      notes: "Imported from credit-card statements.",
    });
  }

  const chargesByService = new Map();
  for (const charge of charges) {
    const key = charge.service.key;
    if (!chargesByService.has(key)) chargesByService.set(key, []);
    chargesByService.get(key).push(charge);
  }

  const entriesByItem = new Map();
  for (const entry of entries) {
    if (!entriesByItem.has(entry.itemKey)) entriesByItem.set(entry.itemKey, []);
    entriesByItem.get(entry.itemKey).push(entry);
  }

  const cutoffMonths = charges
    .map((charge) => charge.cutoffDate?.slice(0, 7))
    .filter(Boolean)
    .sort();
  const window = { start: cutoffMonths[0] ?? null, end: cutoffMonths[cutoffMonths.length - 1] ?? null };
  const inWindow = (periodStart) =>
    window.start && window.end && monthOf(periodStart) >= window.start && monthOf(periodStart) <= window.end;

  const droppedEntries = [];
  const addedEntries = [];
  const report = {
    window,
    newItems: [],
    services: [],
    droppedEntries,
    addedEntries,
    summary: { charges: charges.length, addedEntries: 0, droppedEntries: 0, newItems: 0 },
  };

  for (const [serviceKey, serviceCharges] of chargesByService) {
    const service = serviceCharges[0].service;
    const itemKey = service.itemKey ?? keyAssignments.get(serviceKey);
    const isNew = !service.itemKey;

    const existing = entriesByItem.get(itemKey) ?? [];
    const statementEntries = serviceCharges.map((charge) =>
      chargeToEntry(charge, service, itemKey),
    );

    const kept = existing.filter((entry) => !inWindow(entry.periodStart));
    const dropped = existing.filter((entry) => inWindow(entry.periodStart));

    for (const entry of dropped) {
      droppedEntries.push({
        name: service.name,
        itemKey,
        periodStart: entry.periodStart,
        amount: entry.amount,
        note: entry.note,
        sourceRef: entry.sourceRef,
      });
    }
    addedEntries.push(...statementEntries);

    report.services.push({
      name: service.name,
      itemKey,
      isNew,
      keptBeforeWindow: kept.length,
      droppedInWindow: dropped.length,
      addedFromStatements: statementEntries.length,
      finalEntryCount: kept.length + statementEntries.length,
    });
  }

  for (const item of newItems) report.newItems.push(item);

  // Drop replaced entries (by reference) and append the statement entries.
  const droppedRefs = new Set();
  const coveredItemKeys = new Set(
    [...chargesByService.keys()].map(
      (serviceKey) => chargesByService.get(serviceKey)[0].service.itemKey ?? keyAssignments.get(serviceKey),
    ),
  );
  const finalEntries = entries.filter((entry) => {
    const shouldDrop = coveredItemKeys.has(entry.itemKey) && inWindow(entry.periodStart);
    if (shouldDrop) droppedRefs.add(entry);
    return !shouldDrop;
  });

  const mergedItems = [...items, ...newItems];
  const mergedEntries = [...finalEntries, ...addedEntries].sort(
    (a, b) => a.itemKey.localeCompare(b.itemKey) || a.periodStart.localeCompare(b.periodStart),
  );

  const mergedSeed = { ...seed, items: mergedItems, entries: mergedEntries };

  report.summary = {
    charges: charges.length,
    addedEntries: addedEntries.length,
    droppedEntries: droppedRefs.size,
    newItems: newItems.length,
  };
  mergedSeed.metadata = recomputeMetadata(mergedSeed, now, report);

  return { mergedSeed, report, addedEntries, newItems };
}
