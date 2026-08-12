import { timingSafeEqual } from "node:crypto";

export interface ClientPrincipal {
  identityProvider?: string;
  userDetails?: string;
  userId?: string;
  userRoles?: string[];
}

export function parseClientPrincipal(encoded: string | null): ClientPrincipal | null {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ClientPrincipal;
  } catch {
    return null;
  }
}

export function isAllowedOwner(encoded: string | null, allowedGithubUser: string | undefined) {
  if (!allowedGithubUser) return false;
  const principal = parseClientPrincipal(encoded);
  return (
    principal?.identityProvider?.toLowerCase() === "github" &&
    principal.userDetails?.toLowerCase() === allowedGithubUser.toLowerCase()
  );
}

export interface AuthorizationInput {
  encodedPrincipal: string | null;
  allowedGithubUser: string | undefined;
  requestUrl: string;
  localAuthBypass: string | undefined;
  azureSiteName: string | undefined;
  localProxyMode: string | undefined;
  expectedLocalProxyToken: string | undefined;
  presentedLocalProxyToken: string | null;
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalAuthBypassAllowed(input: AuthorizationInput) {
  if (input.localAuthBypass !== "true" || input.azureSiteName !== undefined) return false;
  try {
    return loopbackHosts.has(new URL(input.requestUrl).hostname);
  } catch {
    return false;
  }
}

function hasMatchingLocalProxyToken(input: AuthorizationInput) {
  if (!input.expectedLocalProxyToken || !input.presentedLocalProxyToken) return false;
  const expected = Buffer.from(input.expectedLocalProxyToken, "utf8");
  const presented = Buffer.from(input.presentedLocalProxyToken, "utf8");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

export function isAuthorizedRequest(input: AuthorizationInput) {
  const hasLocalProxyConfiguration =
    input.localProxyMode !== undefined || input.expectedLocalProxyToken !== undefined;

  if (!hasLocalProxyConfiguration) {
    return isAllowedOwner(input.encodedPrincipal, input.allowedGithubUser);
  }
  if (!hasMatchingLocalProxyToken(input)) return false;
  if (input.localProxyMode === "bypass") return isLocalAuthBypassAllowed(input);
  if (input.localProxyMode === "swa") {
    return isAllowedOwner(input.encodedPrincipal, input.allowedGithubUser);
  }
  return false;
}
