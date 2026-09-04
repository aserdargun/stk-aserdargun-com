import { describe, expect, it } from "vitest";
import { createApiProxyOptions } from "../vite.config";

describe("Vite private API proxy capability", () => {
  it("overwrites the private request header with the supervisor-provided capability", () => {
    const proxy = createApiProxyOptions("per-run-local-token", "3002");

    expect(proxy.target).toBe("http://127.0.0.1:3002");
    expect(proxy.headers).toEqual({
      "x-stackfolio-local-proxy-token": "per-run-local-token",
    });
  });

  it("does not invent or expose a browser-facing capability when none is provided", () => {
    const proxy = createApiProxyOptions(undefined);

    expect(proxy.headers).toEqual({});
    expect(JSON.stringify(proxy)).not.toContain("VITE_");
  });
});
