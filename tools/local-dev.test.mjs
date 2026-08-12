import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as localDev from "./local-dev.mjs";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function waitFor(condition, description) {
  const timeout = Date.now() + 5_000;
  while (Date.now() < timeout) {
    if (condition()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

test("defines the complete loopback development stack", () => {
  const rootDir = resolve("/tmp/stackfolio-plan-test");
  const services = localDev.createServiceDefinitions(rootDir, { PATH: "/usr/bin" });

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
  const [,, functions] = localDev.createServiceDefinitions("/repo", {
    WEBSITE_SITE_NAME: "stackfolio-production",
  });

  assert.equal(functions.env.WEBSITE_SITE_NAME, "stackfolio-production");
});

test("keeps the local bypass exclusive to Functions", () => {
  const services = localDev.createServiceDefinitions("/repo", {
    STACKFOLIO_LOCAL_AUTH_BYPASS: "inherited",
    WEBSITE_SITE_NAME: "stackfolio-production",
  });

  for (const service of services.filter(({ name }) => name !== "Functions")) {
    assert.equal(service.env.STACKFOLIO_LOCAL_AUTH_BYPASS, undefined, service.name);
    assert.equal(service.env.WEBSITE_SITE_NAME, "stackfolio-production", service.name);
  }

  const functions = services.find(({ name }) => name === "Functions");
  assert.equal(functions.env.STACKFOLIO_LOCAL_AUTH_BYPASS, "true");
  assert.equal(functions.env.WEBSITE_SITE_NAME, "stackfolio-production");
});

test("rejects Windows before any child launch", () => {
  let spawnCalls = 0;

  assert.throws(
    () => localDev.startServiceSupervisor([{
      name: "must not start",
      command: "unused",
      args: [],
      cwd: "/repo",
      env: {},
    }], {
      platform: "win32",
      spawnService: () => {
        spawnCalls += 1;
        throw new Error("A Windows child must never start");
      },
    }),
    /requires a POSIX platform with process groups/,
  );

  assert.equal(spawnCalls, 0);
});

test("rejects Windows before the real development entrypoint runs preflight", (t) => {
  const rootDir = mkdtempSync(resolve(tmpdir(), "stackfolio-local-dev-entrypoint-"));
  let preflightCalls = 0;
  let serviceLaunchCalls = 0;
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));

  assert.throws(
    () => localDev.startLocalDevelopment(rootDir, {
      platform: "win32",
      prepareLocalDevelopment: () => {
        preflightCalls += 1;
      },
      startServiceSupervisor: () => {
        serviceLaunchCalls += 1;
      },
    }),
    /requires a POSIX platform with process groups/,
  );

  assert.equal(preflightCalls, 0);
  assert.equal(serviceLaunchCalls, 0);
  assert.deepEqual(readdirSync(rootDir), []);
});

test("force-stops a descendant after its wrapper exits", async (t) => {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "stackfolio-local-dev-"));
  const pidFile = resolve(temporaryDirectory, "descendant.pid");
  const readyFile = `${pidFile}.ready`;
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const supervisor = localDev.startServiceSupervisor([
    {
      name: "fixture wrapper",
      command: process.execPath,
      args: [resolve(fixtureDirectory, "local-dev-spawn-descendant.mjs"), pidFile],
      cwd: temporaryDirectory,
      env: process.env,
    },
  ], { gracePeriodMs: 300 });

  await waitFor(() => {
    try {
      return isProcessAlive(Number(readFileSync(pidFile, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }, "the fixture descendant to start");
  await waitFor(() => {
    try {
      return readFileSync(readyFile, "utf8") === "ready";
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }, "the fixture descendant to install its signal handler");

  const descendantPid = Number(readFileSync(pidFile, "utf8"));
  supervisor.stop(0);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
  assert.equal(isProcessAlive(descendantPid), true, "the descendant must outlive SIGTERM");
  await supervisor.finished;
  await waitFor(() => !isProcessAlive(descendantPid), "the fixture descendant to stop");
});
