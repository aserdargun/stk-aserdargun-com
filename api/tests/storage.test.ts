import { describe, expect, it } from "vitest";
import {
  backfillEntryMembership,
  type MembershipBackfillClient,
  type MembershipBackfillEntity,
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
