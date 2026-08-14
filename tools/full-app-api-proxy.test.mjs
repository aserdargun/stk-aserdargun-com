import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer, request as requestHttp } from "node:http";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createFullAppFunctionsDefinition,
  createLocalApiProxyServer,
  startFullAppApiBoundary,
} from "./full-app-api-proxy.mjs";

const fixtureDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");

function listen(server, port = 0) {
  return new Promise((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", rejectListening);
      resolveListening(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function request({ port, path = "/api/session", headers = {} }) {
  return new Promise((resolveRequest, rejectRequest) => {
    const outgoing = requestHttp({ hostname: "127.0.0.1", port, path, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolveRequest({
        statusCode: response.statusCode,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("error", rejectRequest);
    outgoing.end();
  });
}

function isProcessAlive(pid) {
  const result = spawnSync("ps", ["-o", "state=", "-p", String(pid)], { encoding: "utf8" });
  const state = result.stdout.trim();
  return Boolean(state) && !state.startsWith("Z");
}

test("launches raw Functions in exact SWA capability mode without inheriting bypass", () => {
  const definition = createFullAppFunctionsDefinition("/repo", {
    baseEnv: {
      PATH: "/usr/bin",
      STACKFOLIO_LOCAL_AUTH_BYPASS: "true",
      STACKFOLIO_LOCAL_PROXY_MODE: "inherited",
      STACKFOLIO_LOCAL_PROXY_TOKEN: "inherited-token",
    },
    localProxyToken: "per-run-full-app-token",
    rawFunctionsPort: 7072,
  });

  assert.equal(definition.command, "func");
  assert.deepEqual(definition.args, ["start", "--port", "7072"]);
  assert.equal(definition.cwd, resolve("/repo", "api"));
  assert.equal(definition.env.PATH, "/usr/bin");
  assert.equal(definition.env.STACKFOLIO_LOCAL_AUTH_BYPASS, "false");
  assert.equal(definition.env.STACKFOLIO_LOCAL_PROXY_MODE, "swa");
  assert.equal(definition.env.STACKFOLIO_LOCAL_PROXY_TOKEN, "per-run-full-app-token");
  assert.equal(definition.args.includes("per-run-full-app-token"), false);
});

test("overwrites a client capability while preserving the SWA principal and upstream Host", async (t) => {
  let receivedHeaders;
  const upstream = createServer((incoming, response) => {
    receivedHeaders = incoming.headers;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"owner":true}');
  });
  const upstreamAddress = await listen(upstream);
  const proxy = createLocalApiProxyServer({
    localProxyToken: "per-run-full-app-token",
    rawFunctionsPort: upstreamAddress.port,
  });
  const proxyAddress = await listen(proxy);
  t.after(async () => {
    if (proxy.listening) await close(proxy);
    if (upstream.listening) await close(upstream);
  });

  const result = await request({
    port: proxyAddress.port,
    headers: {
      "x-stackfolio-local-proxy-token": "attacker-token",
      "x-ms-client-principal": "legitimate-swa-principal",
    },
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body, '{"owner":true}');
  assert.equal(receivedHeaders["x-stackfolio-local-proxy-token"], "per-run-full-app-token");
  assert.equal(receivedHeaders["x-ms-client-principal"], "legitimate-swa-principal");
  assert.equal(receivedHeaders.host, `127.0.0.1:${upstreamAddress.port}`);
});

test("registers signals before launch and cleans up the Functions process group and proxy", async (t) => {
  const portProbe = createServer();
  const rawAddress = await listen(portProbe);
  const rawFunctionsPort = rawAddress.port;
  await close(portProbe);

  const signalHandlers = new Map();
  let childPid;
  let boundary;
  t.after(async () => {
    if (boundary) {
      await boundary.stop(0);
    } else if (childPid && isProcessAlive(childPid)) {
      process.kill(-childPid, "SIGKILL");
    }
  });
  boundary = await startFullAppApiBoundary(resolve(fixtureDirectory, "../.."), {
    baseEnv: {},
    localProxyToken: "per-run-full-app-token",
    rawFunctionsPort,
    proxyPort: 0,
    readinessTimeoutMs: 5_000,
    gracePeriodMs: 500,
    registerSignalHandler: (signal, handler) => signalHandlers.set(signal, handler),
    unregisterSignalHandler: (signal) => signalHandlers.delete(signal),
    spawnService: (_command, _args, options) => {
      assert.equal(signalHandlers.has("SIGINT"), true);
      assert.equal(signalHandlers.has("SIGTERM"), true);
      const child = spawn(
        process.execPath,
        [resolve(fixtureDirectory, "full-app-api-host.mjs"), String(rawFunctionsPort)],
        { ...options, stdio: "ignore" },
      );
      childPid = child.pid;
      return child;
    },
  });

  assert.equal(boundary.proxyAddress.address, "127.0.0.1");
  assert.equal((await request({ port: boundary.proxyAddress.port, path: "/api/healthz" })).statusCode, 200);
  assert.equal(isProcessAlive(childPid), true);

  signalHandlers.get("SIGTERM")();
  await boundary.finished;

  assert.equal(isProcessAlive(childPid), false);
  assert.equal(signalHandlers.size, 0);
  await assert.rejects(request({ port: boundary.proxyAddress.port, path: "/api/healthz" }));
});
