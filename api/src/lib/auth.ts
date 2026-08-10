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
