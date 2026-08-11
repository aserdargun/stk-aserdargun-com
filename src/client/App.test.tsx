import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App branding", () => {
  it("links the sidebar signature to the public portfolio", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain('href="https://aserdargun.com"');
    expect(markup).toContain('aria-label="Visit A. Serdar Gün\u2019s portfolio"');
  });
});
