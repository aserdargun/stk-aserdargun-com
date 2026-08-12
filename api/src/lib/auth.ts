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

export function isAuthorizedRequest(input: AuthorizationInput) {
  return (
    isLocalAuthBypassAllowed(input) ||
    isAllowedOwner(input.encodedPrincipal, input.allowedGithubUser)
  );
}
