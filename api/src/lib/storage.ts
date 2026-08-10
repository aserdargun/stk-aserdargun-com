import { readFile } from "node:fs/promises";
import { TableClient, type TableEntity } from "@azure/data-tables";
import type { EntryRecord, ItemRecord, SeedPayload } from "./models.js";

interface ItemEntity {
  id: number;
  name: string;
  category: string;
  billingType: string;
  plan?: string;
  url?: string;
  account?: string;
  powerWatts?: number;
  status: string;
  closedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface EntryEntity {
  id: number;
  itemId: number;
  amount: number;
  currency: string;
  periodStart: string;
  periodKind: string;
  note?: string;
  sourceRef?: string;
  createdAt: string;
}

interface MetaEntity {
  value: string;
}

const itemPartition = "portfolio";
const metaPartition = "application";
const key = (id: number) => String(id).padStart(8, "0");
const statusCode = (error: unknown) =>
  typeof error === "object" && error !== null && "statusCode" in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : undefined;

function optional(value: string | null | undefined) {
  return value || undefined;
}

export class TableRepository {
  private readonly items: TableClient;
  private readonly entries: TableClient;
  private readonly meta: TableClient;
  private initialization?: Promise<void>;

  constructor(connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING) {
    if (!connectionString) {
      throw new Error("AZURE_STORAGE_CONNECTION_STRING is required.");
    }
    this.items = TableClient.fromConnectionString(connectionString, "StackfolioItems");
    this.entries = TableClient.fromConnectionString(connectionString, "StackfolioEntries");
    this.meta = TableClient.fromConnectionString(connectionString, "StackfolioMeta");
  }

  initialize() {
    this.initialization ??= this.initializeOnce();
    return this.initialization;
  }

  private async initializeOnce() {
    for (const client of [this.items, this.entries, this.meta]) {
      try {
        await client.createTable();
      } catch (error) {
        if (statusCode(error) !== 409) throw error;
      }
    }

    if (await this.getMeta("seedVersion")) return;
    const payload = JSON.parse(
      await readFile(new URL("../data/seed-data.json", import.meta.url), "utf8"),
    ) as SeedPayload;
    const timestamp = `${String(payload.metadata.importedOn || "2026-08-10")}T00:00:00.000Z`;
    const itemIds = new Map<string, number>();

    for (const [index, item] of payload.items.entries()) {
      const id = index + 1;
      itemIds.set(item.key, id);
      await this.items.upsertEntity(
        this.itemEntity({ ...item, id, createdAt: timestamp, updatedAt: timestamp }),
        "Replace",
      );
    }

    for (const [index, entry] of payload.entries.entries()) {
      const itemId = itemIds.get(entry.itemKey);
      if (!itemId) throw new Error(`Missing seed item for ${entry.itemKey}.`);
      await this.entries.upsertEntity(
        this.entryEntity({ ...entry, id: index + 1, itemId, createdAt: timestamp }),
        "Replace",
      );
    }

    for (const [metaKey, value] of Object.entries(payload.metadata)) {
      await this.setMeta(metaKey, value);
    }
    await this.setMeta("seedVersion", "2026-08-10-v1");
  }

  async getMeta(metaKey: string): Promise<unknown | null> {
    try {
      const entity = await this.meta.getEntity<MetaEntity>(metaPartition, metaKey);
      return JSON.parse(entity.value);
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  private async setMeta(metaKey: string, value: unknown) {
    await this.meta.upsertEntity(
      { partitionKey: metaPartition, rowKey: metaKey, value: JSON.stringify(value) },
      "Replace",
    );
  }

  async listItems(): Promise<ItemRecord[]> {
    const records: ItemRecord[] = [];
    for await (const entity of this.items.listEntities<ItemEntity>({
      queryOptions: { filter: `PartitionKey eq '${itemPartition}'` },
    })) {
      records.push(this.itemRecord(entity));
    }
    return records.sort((a, b) => a.id - b.id);
  }

  async getItem(id: number): Promise<ItemRecord | null> {
    try {
      return this.itemRecord(await this.items.getEntity<ItemEntity>(itemPartition, key(id)));
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }

  async saveItem(item: ItemRecord) {
    await this.items.upsertEntity(this.itemEntity(item), "Replace");
    return item;
  }

  async nextItemId() {
    const items = await this.listItems();
    return Math.max(0, ...items.map((item) => item.id)) + 1;
  }

  async listEntries(): Promise<EntryRecord[]> {
    const records: EntryRecord[] = [];
    for await (const entity of this.entries.listEntities<EntryEntity>()) {
      records.push(this.entryRecord(entity));
    }
    return records.sort((a, b) => a.id - b.id);
  }

  async listEntriesForItem(itemId: number): Promise<EntryRecord[]> {
    const records: EntryRecord[] = [];
    for await (const entity of this.entries.listEntities<EntryEntity>({
      queryOptions: { filter: `PartitionKey eq '${key(itemId)}'` },
    })) {
      records.push(this.entryRecord(entity));
    }
    return records.sort(
      (a, b) => b.periodStart.localeCompare(a.periodStart) || b.id - a.id,
    );
  }

  async saveEntry(entry: EntryRecord) {
    await this.entries.upsertEntity(this.entryEntity(entry), "Replace");
    return entry;
  }

  async nextEntryId() {
    const entries = await this.listEntries();
    return Math.max(0, ...entries.map((entry) => entry.id)) + 1;
  }

  private itemEntity(item: ItemRecord): TableEntity<ItemEntity> {
    return {
      partitionKey: itemPartition,
      rowKey: key(item.id),
      id: item.id,
      name: item.name,
      category: item.category,
      billingType: item.billingType,
      plan: optional(item.plan),
      url: optional(item.url),
      account: optional(item.account),
      powerWatts: item.powerWatts ?? undefined,
      status: item.status,
      closedAt: optional(item.closedAt),
      notes: optional(item.notes),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private entryEntity(entry: EntryRecord): TableEntity<EntryEntity> {
    return {
      partitionKey: key(entry.itemId),
      rowKey: key(entry.id),
      id: entry.id,
      itemId: entry.itemId,
      amount: entry.amount,
      currency: entry.currency,
      periodStart: entry.periodStart,
      periodKind: entry.periodKind,
      note: optional(entry.note),
      sourceRef: optional(entry.sourceRef),
      createdAt: entry.createdAt,
    };
  }

  private itemRecord(entity: ItemEntity): ItemRecord {
    return {
      id: Number(entity.id),
      name: entity.name,
      category: entity.category as ItemRecord["category"],
      billingType: entity.billingType as ItemRecord["billingType"],
      plan: entity.plan || null,
      url: entity.url || null,
      account: entity.account || null,
      powerWatts: entity.powerWatts ?? null,
      status: entity.status as ItemRecord["status"],
      closedAt: entity.closedAt || null,
      notes: entity.notes || null,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private entryRecord(entity: EntryEntity): EntryRecord {
    return {
      id: Number(entity.id),
      itemId: Number(entity.itemId),
      amount: Number(entity.amount),
      currency: entity.currency,
      periodStart: entity.periodStart,
      periodKind: entity.periodKind as EntryRecord["periodKind"],
      note: entity.note || null,
      sourceRef: entity.sourceRef || null,
      createdAt: entity.createdAt,
    };
  }
}
