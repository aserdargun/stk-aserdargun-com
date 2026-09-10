import { describe, expect, it } from "vitest";
import { entrySchema, itemSchema, updateEntrySchema, updateItemSchema } from "../src/lib/validation.js";

const entry = { amount: 120, periodStart: "2026-09-10", periodKind: "month" };
const item = { name: "Service", category: "Platform", billingType: "recurring" };

describe("ledger input integrity", () => {
  it("does not reactivate a closed item when patching an unrelated field", () => {
    expect(updateItemSchema.parse({ name: "Renamed" })).toEqual({ name: "Renamed" });
  });
  it.each([null, "", "120", true, Infinity, 1e20])("rejects invalid amounts: %s", (amount) => {
    expect(entrySchema.safeParse({ ...entry, amount }).success).toBe(false);
    expect(updateEntrySchema.safeParse({ amount }).success).toBe(false);
  });
  it("retains refunds and normalizes TRY while rejecting unconverted currencies", () => {
    expect(entrySchema.parse({ ...entry, amount: -29.99, currency: "try" })).toMatchObject({ amount: -29.99, currency: "TRY" });
    expect(entrySchema.safeParse({ ...entry, currency: "USD" }).success).toBe(false);
  });
  it.each(["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd"])("rejects non-web URLs: %s", (url) => {
    expect(itemSchema.safeParse({ ...item, url }).success).toBe(false);
  });
  it("accepts ordinary URLs and rejects impossible dates", () => {
    expect(itemSchema.safeParse({ ...item, url: "https://example.com" }).success).toBe(true);
    expect(entrySchema.safeParse({ ...entry, periodStart: "2026-02-30" }).success).toBe(false);
  });
});
