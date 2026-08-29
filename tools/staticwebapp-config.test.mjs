import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(resolve(repositoryRoot, "public/staticwebapp.config.json"), "utf8"),
);
const authPages = ["login.html", "access-denied.html", "signed-out.html"].map((file) => ({
  file,
  html: readFileSync(resolve(repositoryRoot, "public", file), "utf8"),
}));

test("serves the authentication redirect helper to anonymous login pages", () => {
  const route = config.routes.find((candidate) => candidate.route === "/auth-redirects.js");

  assert.deepEqual(route?.allowedRoles, ["anonymous"]);
});

test("declares the managed Functions runtime for prebuilt API deployment", () => {
  assert.deepEqual(config.platform, { apiRuntime: "node:22" });
});

test("keeps every public authentication card inside narrow viewports", () => {
  for (const page of authPages) {
    assert.match(
      page.html,
      /\*, \*::before, \*::after \{ box-sizing: border-box; \}/,
      `${page.file} must include padding in its declared width`,
    );
  }
});
