import { describe, expect, it } from "vitest";
import { isAllowedOwner, parseClientPrincipal } from "../src/lib/auth.js";

const encoded = Buffer.from(
  JSON.stringify({ identityProvider: "github", userDetails: "aserdargun", userRoles: ["authenticated"] }),
).toString("base64");

describe("Static Web Apps owner authorization", () => {
  it("accepts only the configured GitHub identity", () => {
    expect(isAllowedOwner(encoded, "aserdargun")).toBe(true);
    expect(isAllowedOwner(encoded, "someone-else")).toBe(false);
    expect(isAllowedOwner(null, "aserdargun")).toBe(false);
    expect(isAllowedOwner(encoded, undefined)).toBe(false);
  });

  it("rejects malformed principals", () => {
    expect(parseClientPrincipal("not-base64-json")).toBeNull();
  });
});
