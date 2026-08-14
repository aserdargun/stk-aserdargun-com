import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environment = readFileSync(
  resolve(repositoryRoot, ".codex/environments/environment.toml"),
  "utf8",
);
const azureWorkflow = readFileSync(
  resolve(repositoryRoot, ".github/workflows/azure-static-web-apps-stackfolio.yml"),
  "utf8",
);

test("uses the current stk project identity and accurate Codex action names", () => {
  assert.match(environment, /^name = "stk\.aserdargun\.com"$/m);

  const actionNames = environment
    .split("[[actions]]")
    .slice(1)
    .map((block) => block.match(/^name = "([^"]+)"$/m)?.[1]);

  assert.deepEqual(actionNames, [
    "Full App (SWA)",
    "Local Development",
    "Stop All Ports",
    "Validate",
  ]);
  assert.match(environment, /command = "npm run dev"/);
  assert.match(environment, /command = "npm run stop:local"/);
});

test("uses SWA CLI-compatible workflow job keys without changing check labels", () => {
  assert.match(azureWorkflow, /^  build_and_deploy_job:\n    name: build_and_deploy$/m);
  assert.match(azureWorkflow, /^  close_pull_request_job:\n    name: close_pull_request$/m);
});
