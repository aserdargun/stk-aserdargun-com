import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(toolsDirectory, "fixtures/local-port-listener.mjs");
const stopScriptPath = resolve(toolsDirectory, "stop-local.mjs");

async function waitFor(condition, description) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
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

test("stops every listener selected for Stackfolio local development", async (t) => {
  const temporaryDirectory = mkdtempSync(resolve(tmpdir(), "stackfolio-stop-local-"));
  const listeners = ["first", "second"].map((name, index) => {
    const readyFile = resolve(temporaryDirectory, `${name}.port`);
    const args = [fixturePath, readyFile];
    if (index === 1) args.push("--linger-after-close");
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
    });
    return { child, readyFile };
  });

  t.after(() => {
    for (const { child } of listeners) {
      if (isProcessAlive(child.pid)) process.kill(-child.pid, "SIGKILL");
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  await waitFor(
    () => listeners.every(({ readyFile }) => existsSync(readyFile)),
    "the listener fixtures to become ready",
  );
  const ports = listeners.map(({ readyFile }) => Number(readFileSync(readyFile, "utf8")));

  const result = spawnSync(process.execPath, [stopScriptPath], {
    encoding: "utf8",
    env: { ...process.env, STACKFOLIO_LOCAL_PORTS: ports.join(",") },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  await waitFor(
    () => listeners.every(({ child }) => !isProcessAlive(child.pid)),
    "all selected listeners to stop",
  );
  assert.equal(result.stdout, `Stopped Stackfolio local ports: ${ports.join(", ")}\n`);
});
