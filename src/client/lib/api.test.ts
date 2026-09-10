import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("API failures", () => {
  it("turns proxy HTML into a useful service error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Unavailable</html>", { status: 502 })));
    await expect(api.getItems()).rejects.toThrow("temporarily unavailable (HTTP 502)");
  });
  it("shows the field validation failure returned by the API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Validation failed.", details: [{ path: ["initialEntry", "periodStart"], message: "Use a valid calendar date." }] }, { status: 400 })));
    await expect(api.getItems()).rejects.toThrow("initialEntry / periodStart: Use a valid calendar date.");
  });
  it("redirects expired sessions before parsing a non-JSON response", async () => {
    const replace = vi.fn();
    vi.stubGlobal("window", { location: { replace } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(api.getItems()).rejects.toThrow("Authentication required");
    expect(replace).toHaveBeenCalledWith("/login");
  });
});
