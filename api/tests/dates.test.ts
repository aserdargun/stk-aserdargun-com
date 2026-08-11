import { describe, expect, it } from "vitest";
import { isValidIsoDate } from "../src/lib/dates.js";

describe("ISO calendar dates", () => {
  it("accepts real dates, including leap days", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-08-11")).toBe(true);
  });

  it("rejects impossible calendar dates", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-99-01")).toBe(false);
  });

  it("rejects values outside the exact YYYY-MM-DD format", () => {
    expect(isValidIsoDate("2026-8-11")).toBe(false);
    expect(isValidIsoDate("2026-08-11T00:00:00Z")).toBe(false);
  });
});
