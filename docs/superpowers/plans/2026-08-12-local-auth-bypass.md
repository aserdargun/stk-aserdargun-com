# Local Authentication Bypass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm run dev` run Stackfolio locally at `http://127.0.0.1:5173` without GitHub authentication while preserving all Azure and remote authentication checks.

**Architecture:** Centralize authorization in a request-context decision that permits the existing GitHub owner or an explicitly enabled, non-Azure loopback request. A small Node.js supervisor will prepare and run Azurite, the Azure Functions host on port `3001`, an API TypeScript watcher, and Vite on port `5173`, forwarding output and cleaning up every child process together.

**Tech Stack:** Node.js 22, TypeScript 5.9, Vitest 4, Node.js built-in test runner, Azure Functions Core Tools 4, Azurite 3.36, Vite 8, React 19.

## Global Constraints

- `STACKFOLIO_LOCAL_AUTH_BYPASS` must be exactly `true`; no case folding or truthy aliases.
- Bypass hosts are only `localhost`, `127.0.0.1`, and `::1`.
- Bypass must be rejected whenever `WEBSITE_SITE_NAME` is present.
- The development supervisor injects the bypass flag only into its Functions child process.
- `public/staticwebapp.config.json` and the Codex `Full App` action retain production-like authentication behavior.
- Do not add third-party runtime or development dependencies.
- Do not commit `api/local.settings.json`, `.azure/`, `dist/`, `api/dist/`, logs, or test artifacts.
- Preserve the configured GitHub owner comparison for all requests that do not qualify for the local bypass.

## File Map

- Modify `api/tests/auth.test.ts`: specify loopback bypass and production fail-closed behavior.
- Modify `api/src/lib/auth.ts`: own the pure authorization decision and URL/hosting guards.
- Modify `api/src/functions/stackfolio.ts`: use one request authorization adapter for `/api/session` and protected handlers.
- Create `tools/local-dev.mjs`: prepare and supervise the complete local development stack.
- Create `tools/local-dev.test.mjs`: verify service definitions, ports, working directories, and environment isolation.
- Modify `package.json`: separate the frontend child script, expose the supervisor as `npm run dev`, and include its tests in `npm test`.
- Modify `README.md`: document bypass-enabled development and production-like SWA emulation separately.

---

### Task 1: Fail-Closed Local Authorization Decision

**Files:**
- Modify: `api/tests/auth.test.ts`
- Modify: `api/src/lib/auth.ts`
- Modify: `api/src/functions/stackfolio.ts:1-130`

**Interfaces:**
- Consumes: Azure's base64 `x-ms-client-principal`, `HttpRequest.url`, `STACKFOLIO_ALLOWED_GITHUB_USER`, `STACKFOLIO_LOCAL_AUTH_BYPASS`, and `WEBSITE_SITE_NAME`.
- Produces: `AuthorizationInput` and `isAuthorizedRequest(input: AuthorizationInput): boolean` from `api/src/lib/auth.ts`.

- [ ] **Step 1: Add failing tests for the local authorization contract**

Replace `api/tests/auth.test.ts` with tests that preserve the existing owner checks and define the new request-level behavior:

```ts
import { describe, expect, it } from "vitest";
import {
  isAllowedOwner,
  isAuthorizedRequest,
  parseClientPrincipal,
  type AuthorizationInput,
} from "../src/lib/auth.js";

const encoded = Buffer.from(
  JSON.stringify({
    identityProvider: "github",
    userDetails: "aserdargun",
    userRoles: ["authenticated", "stackfolio_owner"],
  }),
).toString("base64");
const authenticatedOnly = Buffer.from(
  JSON.stringify({
    identityProvider: "github",
    userDetails: "aserdargun",
    userRoles: ["authenticated"],
  }),
).toString("base64");

const localRequest = (overrides: Partial<AuthorizationInput> = {}): AuthorizationInput => ({
  encodedPrincipal: null,
  allowedGithubUser: "aserdargun",
  requestUrl: "http://127.0.0.1:3001/api/session",
  localAuthBypass: "true",
  azureSiteName: undefined,
  ...overrides,
});

describe("Static Web Apps owner authorization", () => {
  it("accepts only the configured GitHub identity", () => {
    expect(isAllowedOwner(encoded, "aserdargun")).toBe(true);
    expect(isAllowedOwner(encoded, "someone-else")).toBe(false);
    expect(isAllowedOwner(authenticatedOnly, "aserdargun")).toBe(true);
    expect(isAllowedOwner(null, "aserdargun")).toBe(false);
    expect(isAllowedOwner(encoded, undefined)).toBe(false);
  });

  it("rejects malformed principals", () => {
    expect(parseClientPrincipal("not-base64-json")).toBeNull();
  });
});

const rejectedLocalBypassCases: Array<[string, Partial<AuthorizationInput>]> = [
  ["missing flag", { localAuthBypass: undefined }],
  ["case-variant flag", { localAuthBypass: "TRUE" }],
  ["public host", { requestUrl: "https://stackfolio.aserdargun.com/api/session" }],
  ["private LAN host", { requestUrl: "http://192.168.1.10:3001/api/session" }],
  ["malformed URL", { requestUrl: "not-a-url" }],
  ["empty Azure host marker", { azureSiteName: "" }],
  ["Azure host marker", { azureSiteName: "stackfolio-production" }],
];

describe("local authorization bypass", () => {
  it.each([
    "http://localhost:3001/api/session",
    "http://127.0.0.1:3001/api/session",
    "http://[::1]:3001/api/session",
  ])("accepts an explicitly enabled non-Azure loopback request at %s", (requestUrl) => {
    expect(isAuthorizedRequest(localRequest({ requestUrl }))).toBe(true);
  });

  it.each(rejectedLocalBypassCases)("rejects %s", (_label, overrides) => {
    expect(isAuthorizedRequest(localRequest(overrides))).toBe(false);
  });

  it("keeps GitHub owner authorization when the bypass does not qualify", () => {
    expect(
      isAuthorizedRequest(
        localRequest({
          encodedPrincipal: encoded,
          requestUrl: "https://stackfolio.aserdargun.com/api/session",
          azureSiteName: "stackfolio-production",
        }),
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the targeted test and verify the expected RED state**

Run:

```bash
npm --workspace api test -- tests/auth.test.ts
```

Expected: FAIL during TypeScript transform/import because `AuthorizationInput` and `isAuthorizedRequest` are not exported by `api/src/lib/auth.ts`.

- [ ] **Step 3: Implement the minimal pure authorization decision**

Append the request-level contract to `api/src/lib/auth.ts` while leaving `parseClientPrincipal` and `isAllowedOwner` behavior unchanged:

```ts
export interface AuthorizationInput {
  encodedPrincipal: string | null;
  allowedGithubUser: string | undefined;
  requestUrl: string;
  localAuthBypass: string | undefined;
  azureSiteName: string | undefined;
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalAuthBypassAllowed(input: AuthorizationInput) {
  if (input.localAuthBypass !== "true" || input.azureSiteName !== undefined) return false;
  try {
    return loopbackHosts.has(new URL(input.requestUrl).hostname);
  } catch {
    return false;
  }
}

export function isAuthorizedRequest(input: AuthorizationInput) {
  return (
    isLocalAuthBypassAllowed(input) ||
    isAllowedOwner(input.encodedPrincipal, input.allowedGithubUser)
  );
}
```

- [ ] **Step 4: Run the targeted test and verify GREEN**

Run:

```bash
npm --workspace api test -- tests/auth.test.ts
```

Expected: the auth test file passes with zero failures.

- [ ] **Step 5: Wire both API authorization sites to the same decision**

In `api/src/functions/stackfolio.ts`, replace the `isAllowedOwner` import with `isAuthorizedRequest`, then add this adapter beside the existing JSON helper:

```ts
const isAuthorized = (request: HttpRequest) =>
  isAuthorizedRequest({
    encodedPrincipal: request.headers.get("x-ms-client-principal"),
    allowedGithubUser: process.env.STACKFOLIO_ALLOWED_GITHUB_USER,
    requestUrl: request.url,
    localAuthBypass: process.env.STACKFOLIO_LOCAL_AUTH_BYPASS,
    azureSiteName: process.env.WEBSITE_SITE_NAME,
  });
```

Use it in the protected wrapper:

```ts
function protectedHandler(handler: HttpHandler): HttpHandler {
  return async (request, context) => {
    if (!isAuthorized(request)) {
      return json({ error: "This Stackfolio account is private." }, 403);
    }
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return json({ error: "Validation failed.", details: error.issues }, 400);
      }
      context.error(error);
      return json({ error: "An unexpected server error occurred." }, 500);
    }
  };
}
```

Use the same adapter in the session handler:

```ts
app.http("session", {
  route: "session",
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request) => json({ owner: isAuthorized(request) }),
});
```

- [ ] **Step 6: Run API tests and typecheck**

Run:

```bash
npm --workspace api test
npm --workspace api run typecheck
```

Expected: all API test files pass and TypeScript exits with status 0.

- [ ] **Step 7: Commit the authorization boundary**

```bash
git add api/tests/auth.test.ts api/src/lib/auth.ts api/src/functions/stackfolio.ts
git diff --cached --check
git commit -m "Allow fail-closed local auth bypass"
```

---

### Task 2: Supervised Full Local Development Command

**Files:**
- Create: `tools/local-dev.mjs`
- Create: `tools/local-dev.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: globally installed `func`, npm/npx, the tracked `api/local.settings.example.json`, and the authorization flag defined in Task 1.
- Produces: `createServiceDefinitions(rootDir: string, baseEnv?: NodeJS.ProcessEnv): ServiceDefinition[]` and the user command `npm run dev`.

- [ ] **Step 1: Write the failing service-definition test**

Create `tools/local-dev.test.mjs`:

```js
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
```

The second test ensures the supervisor cannot make an Azure-marked environment qualify for bypass by deleting its marker.

- [ ] **Step 2: Run the test and verify the expected RED state**

Run:

```bash
node --test tools/local-dev.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` because `tools/local-dev.mjs` does not exist.

- [ ] **Step 3: Implement the service definitions and supervisor**

Create `tools/local-dev.mjs`:

```js
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");

export function createServiceDefinitions(rootDir, baseEnv = process.env) {
  const azureDirectory = resolve(rootDir, ".azure");
  return [
    {
      name: "Azurite",
      command: "npx",
      args: [
        "--yes",
        "azurite@3.36.0",
        "--silent",
        "--location",
        resolve(azureDirectory, "azurite"),
        "--debug",
        resolve(azureDirectory, "azurite-debug.log"),
      ],
      cwd: rootDir,
      env: { ...baseEnv },
    },
    {
      name: "API compiler",
      command: "npm",
      args: ["--workspace", "api", "exec", "--", "tsc", "--watch", "--preserveWatchOutput"],
      cwd: rootDir,
      env: { ...baseEnv },
    },
    {
      name: "Functions",
      command: "func",
      args: ["start", "--port", "3001"],
      cwd: resolve(rootDir, "api"),
      env: { ...baseEnv, STACKFOLIO_LOCAL_AUTH_BYPASS: "true" },
    },
    {
      name: "Vite",
      command: "npm",
      args: ["run", "dev:frontend"],
      cwd: rootDir,
      env: { ...baseEnv },
    },
  ];
}

function runPreflight(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0) {
    const detail = result.error ? `: ${result.error.message}` : "";
    throw new Error(`${command} ${args.join(" ")} failed${detail}`);
  }
}

function prepareLocalDevelopment(rootDir) {
  const settingsPath = resolve(rootDir, "api/local.settings.json");
  if (!existsSync(settingsPath)) {
    copyFileSync(resolve(rootDir, "api/local.settings.example.json"), settingsPath);
  }
  mkdirSync(resolve(rootDir, ".azure/azurite"), { recursive: true });

  const functionsCheck = spawnSync("func", ["--version"], { stdio: "ignore" });
  if (functionsCheck.error || functionsCheck.status !== 0) {
    throw new Error(
      "Azure Functions Core Tools is required. Run the Codex environment setup or install azure-functions-core-tools@4.13.0 globally.",
    );
  }

  runPreflight("npm", ["--workspace", "api", "run", "build"], { cwd: rootDir });
}

function startLocalDevelopment(rootDir) {
  prepareLocalDevelopment(rootDir);
  const children = new Set();
  let stopping = false;

  const stop = (exitCode) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    }
    const forceStop = setTimeout(() => {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }, 3_000);
    forceStop.unref();
  };

  for (const service of createServiceDefinitions(rootDir)) {
    const child = spawn(service.command, service.args, {
      cwd: service.cwd,
      env: service.env,
      stdio: "inherit",
    });
    children.add(child);
    child.on("error", (error) => {
      console.error(`[local-dev] ${service.name} failed to start: ${error.message}`);
      stop(1);
    });
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (!stopping) {
        console.error(
          `[local-dev] ${service.name} exited (${signal ?? `code ${code ?? 1}`}); stopping local stack.`,
        );
        stop(code === 0 ? 1 : (code ?? 1));
      }
    });
  }

  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    startLocalDevelopment(repositoryRoot);
  } catch (error) {
    console.error(`[local-dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Run the service-definition test and verify GREEN**

Run:

```bash
node --test tools/local-dev.test.mjs
```

Expected: 2 tests pass with zero failures.

- [ ] **Step 5: Connect the supervisor to npm scripts and the full test gate**

Update the root `package.json` scripts to:

```json
{
  "dev": "node tools/local-dev.mjs",
  "dev:frontend": "vite --host 127.0.0.1",
  "build": "npm run build:app && npm --workspace api run build",
  "build:app": "tsc --noEmit && vite build",
  "typecheck": "tsc --noEmit && npm --workspace api run typecheck",
  "test": "npm run test:client && npm run test:local-dev && npm --workspace api test",
  "test:client": "vitest run src/client",
  "test:local-dev": "node --test tools/local-dev.test.mjs"
}
```

Do not modify dependencies or `package-lock.json`; the implementation uses Node.js built-ins and the tools already required by the repository-local Codex environment.

- [ ] **Step 6: Run local-dev tests through npm and verify package metadata stability**

Run:

```bash
npm run test:local-dev
git diff --exit-code -- package-lock.json
```

Expected: 2 tests pass and `package-lock.json` has no diff.

- [ ] **Step 7: Commit the supervised development command**

```bash
git add package.json tools/local-dev.mjs tools/local-dev.test.mjs
git diff --cached --check
git commit -m "Run complete local development stack"
```

---

### Task 3: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md:55-78`
- Verify only: `.codex/environments/environment.toml`
- Verify only: `public/staticwebapp.config.json`

**Interfaces:**
- Consumes: `npm run dev` from Task 2 and the unchanged Codex `Full App` command.
- Produces: documented local bypass workflow plus runtime evidence for both bypass-enabled Vite development and production-like SWA authentication.

- [ ] **Step 1: Document the two distinct local workflows**

Replace the current README local-development paragraph with:

````markdown
For full local frontend/API development without GitHub authentication, run:

```bash
npm run dev
```

This command starts Azurite, compiles and watches the API, runs Azure Functions
on `127.0.0.1:3001`, and serves Vite at `http://127.0.0.1:5173`. The API bypass
is injected only into the local Functions child process and is accepted only
for loopback requests outside Azure.

To exercise production-like Static Web Apps routing and authentication instead,
run the Codex `Full App` action. It builds the app and serves the SWA emulator at
`http://localhost:4280`; unauthenticated users are redirected to `/login`.
````

Keep the Node.js 22 requirement and the existing validation commands above this section.

- [ ] **Step 2: Run the complete static quality gate**

Run:

```bash
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: typecheck exits 0; all frontend, local-dev, and API tests pass; Vite and API builds exit 0; diff check reports no errors.

- [ ] **Step 3: Free only the verified Stackfolio development ports**

Inspect listeners before stopping anything:

```bash
for port in 5173 3001 4280 7071 10000 10001 10002; do
  lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
done
```

For every listener, verify its command and working directory with `ps -p <pid> -o pid=,ppid=,command=` and `lsof -a -p <pid> -d cwd -Fn`. Stop only processes whose command or working directory resolves to this Stackfolio checkout or its previously started Azurite/SWA tooling. Do not terminate unrelated listeners.

- [ ] **Step 4: Start the bypass-enabled stack and verify API behavior**

Run `npm run dev` in a persistent terminal. Wait until Vite reports port `5173` and Functions reports port `3001`, then run:

```bash
curl --silent --show-error --fail-with-body http://127.0.0.1:5173/api/healthz
curl --silent --show-error --fail-with-body http://127.0.0.1:5173/api/session
curl --silent --show-error --fail-with-body http://127.0.0.1:5173/api/dashboard
```

Expected:

- Health response is `{"status":"ok"}`.
- Session response is `{"owner":true}` without an auth header.
- Dashboard returns HTTP 200 with JSON data sourced from local Azurite.

- [ ] **Step 5: Verify the rendered bypass-enabled application**

Use the in-app Browser at `http://127.0.0.1:5173/` and verify:

- URL and title identify Stackfolio.
- The DOM contains a meaningful application screen, not login or access denied.
- There is no Vite/framework error overlay.
- Console errors and warnings contain no relevant app failure.
- A dashboard navigation or year-selection interaction changes visible UI state.
- A viewport screenshot shows the rendered private application.

- [ ] **Step 6: Stop the bypass stack and smoke-test production-like auth**

Stop `npm run dev` with `Ctrl+C` and verify ports `5173`, `3001`, and `10000`-`10002` no longer have listeners from that process tree. Run the unchanged Codex `Full App` command, then verify:

```bash
curl --silent --show-error --output /dev/null \
  --write-out 'HTTP %{http_code} redirect=%{redirect_url}\n' \
  http://127.0.0.1:4280/
curl --silent --show-error --fail-with-body http://127.0.0.1:4280/api/healthz
```

Expected: root returns HTTP 302 with a `/login` redirect, while `/api/healthz` returns `{"status":"ok"}`. Stop the Full App process and confirm its listeners are gone.

- [ ] **Step 7: Commit documentation after final verification**

```bash
git add README.md docs/superpowers/plans/2026-08-12-local-auth-bypass.md
git diff --cached --check
git commit -m "Document local bypass workflow"
```

- [ ] **Step 8: Perform final repository verification**

Run:

```bash
git status -sb
git log -4 --oneline --decorate
git diff main...HEAD --check
git diff --stat main...HEAD
```

Expected: the working tree is clean on `codex/local-auth-bypass`; the branch contains the design, authorization, local supervisor, and documentation commits; the diff has no whitespace errors and contains only the scoped files listed in this plan.
