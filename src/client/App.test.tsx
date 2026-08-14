import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App branding", () => {
  it("links the sidebar signature to the public portfolio", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('href="https://aserdargun.com"');
    expect(markup).toContain('aria-label="Visit A. Serdar Gün’s portfolio"');
  });

  it("returns signed-out users to the canonical stk subdomain", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain(
      'href="/.auth/logout?post_logout_redirect_uri=https%3A%2F%2Fstk.aserdargun.com%2Fsigned-out.html"',
    );
    expect(markup).not.toContain("stackfolio.aserdargun.com");
  });

  it("keeps sign-out on the current Azure deployment hostname", () => {
    vi.stubGlobal("window", {
      location: { origin: "https://calm-stone-123.azurestaticapps.net" },
      setTimeout: vi.fn(),
    });

    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain(
      "post_logout_redirect_uri=https%3A%2F%2Fcalm-stone-123.azurestaticapps.net%2Fsigned-out.html",
    );
  });
});
