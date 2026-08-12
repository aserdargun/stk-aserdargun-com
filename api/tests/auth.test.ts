import { describe, expect, it } from "vitest";
import {
  isAllowedOwner,
  isAuthorizedRequest,
  parseClientPrincipal,
  type AuthorizationInput,
} from "../src/lib/auth.js";

const encoded = Buffer.from(
  JSON.stringify({
    identityProvider: "github",
    userDetails: "aserdargun",
    userRoles: ["authenticated", "stackfolio_owner"],
  }),
).toString("base64");
const authenticatedOnly = Buffer.from(
  JSON.stringify({
    identityProvider: "github",
    userDetails: "aserdargun",
    userRoles: ["authenticated"],
  }),
).toString("base64");

const localRequest = (overrides: Partial<AuthorizationInput> = {}): AuthorizationInput => ({
  encodedPrincipal: null,
  allowedGithubUser: "aserdargun",
  requestUrl: "http://127.0.0.1:3001/api/session",
  localAuthBypass: "true",
  azureSiteName: undefined,
  ...overrides,
});

describe("Static Web Apps owner authorization", () => {
  it("accepts only the configured GitHub identity", () => {
    expect(isAllowedOwner(encoded, "aserdargun")).toBe(true);
    expect(isAllowedOwner(encoded, "someone-else")).toBe(false);
    expect(isAllowedOwner(authenticatedOnly, "aserdargun")).toBe(true);
    expect(isAllowedOwner(null, "aserdargun")).toBe(false);
    expect(isAllowedOwner(encoded, undefined)).toBe(false);
  });

  it("rejects malformed principals", () => {
    expect(parseClientPrincipal("not-base64-json")).toBeNull();
  });
});

const rejectedLocalBypassCases: Array<[string, Partial<AuthorizationInput>]> = [
  ["missing flag", { localAuthBypass: undefined }],
  ["case-variant flag", { localAuthBypass: "TRUE" }],
  ["public host", { requestUrl: "https://stackfolio.aserdargun.com/api/session" }],
  ["private LAN host", { requestUrl: "http://192.168.1.10:3001/api/session" }],
  ["malformed URL", { requestUrl: "not-a-url" }],
  ["empty Azure host marker", { azureSiteName: "" }],
  ["Azure host marker", { azureSiteName: "stackfolio-production" }],
];

describe("local authorization bypass", () => {
  it.each([
    "http://localhost:3001/api/session",
    "http://127.0.0.1:3001/api/session",
    "http://[::1]:3001/api/session",
  ])("accepts an explicitly enabled non-Azure loopback request at %s", (requestUrl) => {
    expect(isAuthorizedRequest(localRequest({ requestUrl }))).toBe(true);
  });

  it.each(rejectedLocalBypassCases)("rejects %s", (_label, overrides) => {
    expect(isAuthorizedRequest(localRequest(overrides))).toBe(false);
  });

  it("keeps GitHub owner authorization when the bypass does not qualify", () => {
    expect(
      isAuthorizedRequest(
        localRequest({
          encodedPrincipal: encoded,
          requestUrl: "https://stackfolio.aserdargun.com/api/session",
          azureSiteName: "stackfolio-production",
        }),
      ),
    ).toBe(true);
  });
});
