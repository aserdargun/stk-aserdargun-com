export function buildAuthRedirect(authPath, parameter, returnPath, origin) {
  const returnUrl = new URL(returnPath, `${origin}/`).toString();
  return `${authPath}?${parameter}=${encodeURIComponent(returnUrl)}`;
}

if (typeof document !== "undefined") {
  for (const link of document.querySelectorAll("[data-auth-return]")) {
    link.href = buildAuthRedirect(
      link.getAttribute("href"),
      link.dataset.authParameter,
      link.dataset.authReturn,
      window.location.origin,
    );
  }
}
