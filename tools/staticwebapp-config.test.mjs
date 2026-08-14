import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(resolve(repositoryRoot, "public/staticwebapp.config.json"), "utf8"),
);

test("serves the authentication redirect helper to anonymous login pages", () => {
  const route = config.routes.find((candidate) => candidate.route === "/auth-redirects.js");

  assert.deepEqual(route?.allowedRoles, ["anonymous"]);
});
