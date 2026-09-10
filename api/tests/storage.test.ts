import { describe, expect, it } from "vitest";
import type { EntryRecord, ItemRecord } from "../src/lib/models.js";
import {
  backfillEntryMembership,
  moveLedgerEntries,
  type MembershipBackfillClient,
  type MembershipBackfillEntity,
  type MoveEntriesClient,
} from "../src/lib/storage.js";

describe("membership ledger migration", () => {
  it("retries a stale ETag with a membership-only merge", async () => {
    let stored = {
      partitionKey: "00000001",
      rowKey: "00000007",
      etag: "v1",
      amount: 99,
      note: "Before concurrent edit",
      membership: undefined as string | undefined,
    };
    const updates: Array<{
      entity: { partitionKey: string; rowKey: string; membership: string };
      mode: "Merge";
      etag: string;
    }> = [];

    const client: MembershipBackfillClient = {
      async getEntity() {
        return { ...stored };
      },
      async updateEntity(entity, mode, options) {
        updates.push({ entity, mode, etag: options.etag });

        if (updates.length === 1) {
          stored = {
            ...stored,
            amount: 149,
            note: "Saved by a concurrent PATCH",
            etag: "v2",
          };
          throw Object.assign(new Error("Precondition failed"), { statusCode: 412 });
        }

        expect(options.etag).toBe(stored.etag);
        stored = { ...stored, ...entity, etag: "v3" };
      },
    };

    await backfillEntryMembership(
      client,
      {
        partitionKey: stored.partitionKey,
        rowKey: stored.rowKey,
        etag: stored.etag,
      },
      "Legacy plan",
    );

    expect(updates.map(({ mode, etag }) => ({ mode, etag }))).toEqual([
      { mode: "Merge", etag: "v1" },
      { mode: "Merge", etag: "v2" },
    ]);
    expect(updates.every(({ entity }) => Object.keys(entity).length === 3)).toBe(true);
    expect(stored).toMatchObject({
      amount: 149,
      note: "Saved by a concurrent PATCH",
      membership: "Legacy plan",
    });
  });

  it("preserves membership supplied by a concurrent PATCH", async () => {
    let updateCalls = 0;
    const client: MembershipBackfillClient = {
      async getEntity(partitionKey, rowKey) {
        return {
          partitionKey,
          rowKey,
          etag: "v2",
          membership: "Concurrent plan",
        };
      },
      async updateEntity() {
        updateCalls += 1;
        throw Object.assign(new Error("Precondition failed"), { statusCode: 412 });
      },
    };

    await backfillEntryMembership(
      client,
      {
        partitionKey: "00000001",
        rowKey: "00000007",
        etag: "v1",
      },
      "Legacy plan",
    );

    expect(updateCalls).toBe(1);
  });
});

const baseItem = (overrides: Partial<ItemRecord>): ItemRecord => ({
  id: 1,
  name: "Apple",
  category: "Platform",
  billingType: "recurring",
  plan: null,
  url: null,
  account: "aserdargun@gmail.com",
  powerWatts: null,
  status: "active",
  closedAt: null,
  notes: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  ...overrides,
});

const baseEntry = (overrides: Partial<EntryRecord>): EntryRecord => ({
  id: 1,
  itemId: 1,
  amount: 100,
  currency: "TRY",
  periodStart: "2026-08-01",
  periodKind: "month",
  membership: null,
  note: "Card: APPLE.COM/BILL",
  sourceRef: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  ...overrides,
});

function makeClient(overrides: Partial<MoveEntriesClient>): MoveEntriesClient {
  const items = new Map<number, ItemRecord>();
  const entries = new Map<string, EntryRecord>();
  return {
    getItem: async (id) => items.get(id) ?? null,
    listEntriesForItem: async (itemId) =>
      [...entries.values()].filter((entry) => entry.itemId === itemId),
    deleteEntry: async (itemId, entryId) => {
      entries.delete(`${itemId}:${entryId}`);
    },
    deleteItem: async (id) => {
      items.delete(id);
    },
    saveEntry: async (entry) => {
      entries.set(`${entry.itemId}:${entry.id}`, entry);
      return entry;
    },
    saveItem: async (item) => {
      items.set(item.id, item);
      return item;
    },
    ...overrides,
  };
}

describe("moveLedgerEntries", () => {
  it("moves every entry and removes the source cost when it ends up empty", async () => {
    const source = baseItem({ id: 31, name: "Apple" });
    const target = baseItem({ id: 9, name: "ChatGPT" });
    const a = baseEntry({ id: 1, itemId: 31, amount: 249.99, periodStart: "2026-04-01" });
    const b = baseEntry({ id: 2, itemId: 31, amount: 599, periodStart: "2026-05-01" });
    const client = makeClient({});
    await client.saveItem(source);
    await client.saveItem(target);
    await client.saveEntry(a);
    await client.saveEntry(b);

    const result = await moveLedgerEntries(client, 31, 9, () => "2026-09-07T10:00:00.000Z");

    expect(result.moved).toBe(2);
    expect(result.removed).toBe(true);
    expect(result.fallbackClosed).toBe(false);
    expect(await client.getItem(31)).toBeNull();
    const targetEntries = await client.listEntriesForItem(9);
    expect(targetEntries.map((entry) => entry.id).sort()).toEqual([1, 2]);
    expect(await client.listEntriesForItem(31)).toEqual([]);
  });

  it("rejects when source and target are the same", async () => {
    const client = makeClient({});
    await expect(moveLedgerEntries(client, 9, 9)).rejects.toThrow(/must be different/);
  });

  it("rejects when target is closed", async () => {
    const client = makeClient({});
    await client.saveItem(baseItem({ id: 31 }));
    await client.saveItem(baseItem({ id: 9, status: "closed", closedAt: "2026-08-30" }));
    await expect(moveLedgerEntries(client, 31, 9)).rejects.toThrow(/closed/);
  });

  it("rejects when source does not exist", async () => {
    const client = makeClient({});
    await client.saveItem(baseItem({ id: 9 }));
    await expect(moveLedgerEntries(client, 31, 9)).rejects.toThrow(/Source/);
  });

  it("falls back to closing the source when entries remain after the move", async () => {
    const source = baseItem({ id: 31, name: "Apple" });
    const target = baseItem({ id: 9, name: "ChatGPT" });
    const a = baseEntry({ id: 1, itemId: 31 });
    const b = baseEntry({ id: 2, itemId: 31 });
    let sourceListingCalls = 0;
    const client = makeClient({
      // First listing: return both entries so the function plans to move them.
      // Second listing: simulate a stale entry that survived, forcing the
      // fallback close path instead of a delete.
      listEntriesForItem: async (itemId) => {
        if (itemId === 31) {
          sourceListingCalls += 1;
          return sourceListingCalls === 1 ? [a, b] : [a];
        }
        return [b];
      },
    });
    await client.saveItem(source);
    await client.saveItem(target);
    await client.saveEntry(a);
    await client.saveEntry(b);

    const result = await moveLedgerEntries(client, 31, 9, () => "2026-09-07T10:00:00.000Z");

    expect(result.moved).toBe(2);
    expect(result.removed).toBe(false);
    expect(result.fallbackClosed).toBe(true);
    const afterSource = await client.getItem(31);
    expect(afterSource?.status).toBe("closed");
    expect(afterSource?.closedAt).toBe("2026-09-07");
    expect(afterSource?.notes).toContain("Moved ledger to cost #9 (ChatGPT).");
  });
});

import { vi } from "vitest";
import { TableClient } from "@azure/data-tables";
import { TableRepository } from "../src/lib/storage.js";

describe("concurrent ID reservations", () => {
  it("reserves unique IDs across repository instances and retains the persisted counter", async () => {
    const counters = new Map<string, { value: string; etag: string }>();
    const conflict = (statusCode: number) => Object.assign(new Error("Storage conflict"), { statusCode });
    const client = {
      async getEntity(_partition: string, key: string) {
        const entity = counters.get(key);
        if (!entity) throw conflict(404);
        return { ...entity };
      },
      async createEntity(entity: { rowKey: string; value: string }) {
        if (counters.has(entity.rowKey)) throw conflict(409);
        counters.set(entity.rowKey, { value: entity.value, etag: "1" });
      },
      async updateEntity(entity: { rowKey: string; value: string }, _mode: string, options: { etag: string }) {
        const current = counters.get(entity.rowKey)!;
        if (options.etag !== current.etag) throw conflict(412);
        counters.set(entity.rowKey, { value: entity.value, etag: String(Number(current.etag) + 1) });
      },
      async *listEntities() { yield { id: 54 }; },
    };
    const factory = vi.spyOn(TableClient, "fromConnectionString").mockReturnValue(client as unknown as TableClient);
    try {
      const ids = await Promise.all(Array.from({ length: 10 }, () => new TableRepository("test").nextItemId()));
      expect([...ids].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, index) => 55 + index));
      expect(await new TableRepository("test").nextItemId()).toBe(65);
    } finally { factory.mockRestore(); }
  });
  it("allows initialization to recover after a transient storage outage", async () => {
    const client = { createTable: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined), getEntity: vi.fn().mockResolvedValue({ value: '"ready"' }) };
    const factory = vi.spyOn(TableClient, "fromConnectionString").mockReturnValue(client as unknown as TableClient);
    try {
      const repo = new TableRepository("test");
      await expect(repo.initialize()).rejects.toThrow("Offline");
      await expect(repo.initialize()).resolves.toBeUndefined();
    } finally { factory.mockRestore(); }
  });
});
