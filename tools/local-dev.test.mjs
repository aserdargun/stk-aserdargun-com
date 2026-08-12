import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createServiceDefinitions } from "./local-dev.mjs";

test("defines the complete loopback development stack", () => {
  const rootDir = resolve("/tmp/stackfolio-plan-test");
  const services = createServiceDefinitions(rootDir, { PATH: "/usr/bin" });

  assert.deepEqual(
    services.map(({ name }) => name),
    ["Azurite", "API compiler", "Functions", "Vite"],
  );

  const azurite = services.find(({ name }) => name === "Azurite");
  assert.equal(azurite.command, "npx");
  assert.deepEqual(azurite.args.slice(0, 3), ["--yes", "azurite@3.36.0", "--silent"]);

  const functions = services.find(({ name }) => name === "Functions");
  assert.equal(functions.cwd, resolve(rootDir, "api"));
  assert.deepEqual(functions.args, ["start", "--port", "3001"]);
  assert.equal(functions.env.STACKFOLIO_LOCAL_AUTH_BYPASS, "true");
  assert.equal(functions.env.PATH, "/usr/bin");
  assert.equal(functions.env.WEBSITE_SITE_NAME, undefined);

  const vite = services.find(({ name }) => name === "Vite");
  assert.equal(vite.cwd, rootDir);
  assert.deepEqual(vite.args, ["run", "dev:frontend"]);
});

test("does not erase an inherited Azure marker", () => {
  const [,, functions] = createServiceDefinitions("/repo", {
    WEBSITE_SITE_NAME: "stackfolio-production",
  });

  assert.equal(functions.env.WEBSITE_SITE_NAME, "stackfolio-production");
});
