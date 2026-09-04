import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatMembership,
  formatPeriodDate,
  formatServiceName,
  normalizeMembership,
} from "./format";

describe("display formatting", () => {
  it("does not invent a day when only a month and year are requested", () => {
    expect(formatDate("2026-07-01", { month: "long", year: "numeric" })).toBe("July 2026");
  });

  it("formats ledger periods according to their precision", () => {
    expect(formatPeriodDate("2026-07-01", "month")).toBe("Jul 2026");
    expect(formatPeriodDate("2026-01-01", "year")).toBe("2026");
    expect(formatPeriodDate("2026-07-18", "one_time")).toBe("Jul 18, 2026");
  });

  it("repairs known legacy brand labels at render time", () => {
    expect(formatServiceName("Github")).toBe("GitHub");
    expect(formatServiceName("Huggingface")).toBe("Hugging Face");
    expect(formatServiceName("iPad Wifi 128GB A16 + Apple Pencil USB-C")).toBe(
      "iPad Wi-Fi 128GB A16 + Apple Pencil USB-C",
    );
  });

  it("treats legacy dash placeholders as missing membership data", () => {
    expect(normalizeMembership("-")).toBeNull();
    expect(formatMembership("—")).toBe("Not set");
    expect(formatMembership("Github Pro")).toBe("GitHub Pro");
    expect(formatMembership("Premium(2TB)")).toBe("Premium (2 TB)");
  });
});
