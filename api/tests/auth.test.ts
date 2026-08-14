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
  localProxyMode: "bypass",
  expectedLocalProxyToken: "expected-local-token",
  presentedLocalProxyToken: "expected-local-token",
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

describe("capability-protected local authorization bypass", () => {
  it.each([
    "http://localhost:3001/api/session",
    "http://127.0.0.1:3001/api/session",
    "http://[::1]:3001/api/session",
  ])("accepts an explicitly enabled non-Azure loopback request at %s", (requestUrl) => {
    expect(isAuthorizedRequest(localRequest({ requestUrl }))).toBe(true);
  });

  it.each(rejectedLocalBypassCases)("rejects %s", (_label, overrides) => {
    expect(isAuthorizedRequest(localRequest({ encodedPrincipal: encoded, ...overrides }))).toBe(false);
  });

  it("rejects a forged owner principal when the capability is absent", () => {
    expect(
      isAuthorizedRequest(
        localRequest({
          encodedPrincipal: encoded,
          presentedLocalProxyToken: null,
        }),
      ),
    ).toBe(false);
  });
});

describe("fail-closed local proxy configuration", () => {
  it.each([
    ["missing mode", { localProxyMode: undefined }],
    ["missing expected capability", { expectedLocalProxyToken: undefined }],
    ["missing presented capability", { presentedLocalProxyToken: null }],
    ["unknown mode", { localProxyMode: "owner" }],
    ["empty mode", { localProxyMode: "" }],
    ["empty expected capability", { expectedLocalProxyToken: "", presentedLocalProxyToken: "" }],
    ["same-length mismatch", { presentedLocalProxyToken: "unexpected-local-tok" }],
    ["different-length mismatch", { presentedLocalProxyToken: "short" }],
  ] satisfies Array<[string, Partial<AuthorizationInput>]>)(
    "rejects %s without falling back to a forged owner principal",
    (_label, overrides) => {
      expect(isAuthorizedRequest(localRequest({ encodedPrincipal: encoded, ...overrides }))).toBe(false);
    },
  );
});

describe("SWA local proxy authorization", () => {
  const swaRequest = (overrides: Partial<AuthorizationInput> = {}) =>
    localRequest({
      encodedPrincipal: encoded,
      localAuthBypass: "false",
      localProxyMode: "swa",
      ...overrides,
    });

  it("accepts the configured owner only through the matching local proxy capability", () => {
    expect(isAuthorizedRequest(swaRequest())).toBe(true);
    expect(isAuthorizedRequest(swaRequest({ presentedLocalProxyToken: null }))).toBe(false);
  });

  it("does not activate bypass under a hostile inherited bypass flag", () => {
    expect(
      isAuthorizedRequest(
        swaRequest({
          encodedPrincipal: null,
          localAuthBypass: "true",
          requestUrl: "http://127.0.0.1:7072/api/session",
        }),
      ),
    ).toBe(false);
  });

  it("rejects an unconfigured GitHub identity even with a matching capability", () => {
    expect(
      isAuthorizedRequest(
        swaRequest({
          encodedPrincipal: Buffer.from(
            JSON.stringify({ identityProvider: "github", userDetails: "someone-else" }),
          ).toString("base64"),
        }),
      ),
    ).toBe(false);
  });
});

describe("production authorization", () => {
  it("retains owner-principal fallback when no local proxy configuration exists", () => {
    expect(
      isAuthorizedRequest(
        localRequest({
          encodedPrincipal: encoded,
          requestUrl: "https://stackfolio.aserdargun.com/api/session",
          localAuthBypass: undefined,
          azureSiteName: "stackfolio-production",
          localProxyMode: undefined,
          expectedLocalProxyToken: undefined,
          presentedLocalProxyToken: "attacker-supplied-token",
        }),
      ),
    ).toBe(true);
  });

  it("still rejects a non-owner principal", () => {
    expect(
      isAuthorizedRequest(
        localRequest({
          encodedPrincipal: null,
          localAuthBypass: undefined,
          localProxyMode: undefined,
          expectedLocalProxyToken: undefined,
          presentedLocalProxyToken: "attacker-supplied-token",
        }),
      ),
    ).toBe(false);
  });
});
