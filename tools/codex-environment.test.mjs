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
  resolve(repositoryRoot, ".github/workflows/deploy-swa-stk-aserdargun-com.yml"),
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
  assert.match(environment, /command = "npm run stop:local && npm run dev"/);
  assert.match(environment, /command = "npm run stop:local"/);
});

test("cleans stale project services before and after the Full App action", () => {
  const fullAppAction = environment.split("[[actions]]")[1];

  assert.match(fullAppAction, /command = """\nset -e\nnpm run stop:local\n/);
  assert.match(fullAppAction, /cleanup\(\) \{\n  npm run stop:local/);
  assert.doesNotMatch(fullAppAction, /kill "\$azurite_pid"/);
});

test("serializes a validated prebuilt production artifact into the stk Static Web App", () => {
  assert.match(azureWorkflow, /^concurrency:\n  group: swa-stk-aserdargun-com-production\n  cancel-in-progress: false$/m);
  assert.doesNotMatch(azureWorkflow, /pull_request:/);
  assert.match(azureWorkflow, /npm ci/);
  assert.match(azureWorkflow, /npm run typecheck/);
  assert.match(azureWorkflow, /npm test/);
  assert.match(azureWorkflow, /npm run build/);
  assert.match(azureWorkflow, /app_location: dist/);
  assert.match(azureWorkflow, /skip_app_build: true/);
  assert.match(azureWorkflow, /output_location: ""/);
  assert.match(
    azureWorkflow,
    /secrets\.AZURE_STATIC_WEB_APPS_API_TOKEN_SWA_STK_ASERDARGUN_COM/,
  );
  assert.match(azureWorkflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(azureWorkflow, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020/);
  assert.match(azureWorkflow, /Azure\/static-web-apps-deploy@4d27395796ac319302594769cfe812bd207490b1/);
});
