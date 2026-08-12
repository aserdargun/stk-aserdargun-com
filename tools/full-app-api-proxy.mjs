import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, request as requestHttp } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startServiceSupervisor } from "./local-dev.mjs";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");
const loopbackHost = "127.0.0.1";
const localProxyHeader = "x-stackfolio-local-proxy-token";
const defaultProxyPort = 7071;
const defaultRawFunctionsPort = 7072;

export function generateFullAppLocalProxyToken() {
  return randomBytes(32).toString("base64url");
}

export function createFullAppFunctionsDefinition(
  rootDir,
  {
    baseEnv = process.env,
    localProxyToken,
    rawFunctionsPort = defaultRawFunctionsPort,
  } = {},
) {
  if (!localProxyToken) throw new Error("A per-run local proxy capability is required.");

  return {
    name: "Full App Functions",
    command: "func",
    args: ["start", "--port", String(rawFunctionsPort)],
    cwd: resolve(rootDir, "api"),
    env: {
      ...baseEnv,
      STACKFOLIO_LOCAL_AUTH_BYPASS: "false",
      STACKFOLIO_LOCAL_PROXY_MODE: "swa",
      STACKFOLIO_LOCAL_PROXY_TOKEN: localProxyToken,
    },
  };
}

function upstreamHeaders(incomingHeaders, localProxyToken, rawFunctionsPort) {
  const headers = {};
  for (const [name, value] of Object.entries(incomingHeaders)) {
    if (name.toLowerCase() !== localProxyHeader && name.toLowerCase() !== "host") {
      headers[name] = value;
    }
  }
  headers.host = `${loopbackHost}:${rawFunctionsPort}`;
  headers[localProxyHeader] = localProxyToken;
  return headers;
}

export function createLocalApiProxyServer({
  localProxyToken,
  rawFunctionsPort = defaultRawFunctionsPort,
  requestUpstream = requestHttp,
} = {}) {
  if (!localProxyToken) throw new Error("A per-run local proxy capability is required.");

  return createServer((incoming, response) => {
    const upstream = requestUpstream(
      {
        hostname: loopbackHost,
        port: rawFunctionsPort,
        method: incoming.method,
        path: incoming.url,
        headers: upstreamHeaders(incoming.headers, localProxyToken, rawFunctionsPort),
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.statusMessage,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );

    upstream.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "application/json" });
      }
      response.end(JSON.stringify({ error: `Local Functions proxy failed: ${error.message}` }));
    });
    incoming.on("aborted", () => upstream.destroy());
    incoming.pipe(upstream);
  });
}

function probeFunctionsHost(rawFunctionsPort) {
  return new Promise((resolveProbe) => {
    const probe = requestHttp(
      {
        hostname: loopbackHost,
        port: rawFunctionsPort,
        method: "GET",
        path: "/api/healthz",
      },
      (response) => {
        response.resume();
        resolveProbe(response.statusCode === 200);
      },
    );
    probe.once("error", () => resolveProbe(false));
    probe.end();
  });
}

export async function waitForFunctionsHost(
  rawFunctionsPort,
  { timeoutMs = 30_000, retryDelayMs = 100 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeFunctionsHost(rawFunctionsPort)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
  }
  throw new Error(
    `Functions did not become ready on ${loopbackHost}:${rawFunctionsPort} within ${timeoutMs}ms.`,
  );
}

function listenOnLoopback(server, port) {
  return new Promise((resolveListening, rejectListening) => {
    const reject = (error) => {
      server.off("listening", accept);
      rejectListening(error);
    };
    const accept = () => {
      server.off("error", reject);
      resolveListening(server.address());
    };
    server.once("error", reject);
    server.once("listening", accept);
    server.listen(port, loopbackHost);
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
    server.closeAllConnections?.();
  });
}

export async function startFullAppApiBoundary(
  rootDir,
  {
    baseEnv = process.env,
    localProxyToken = generateFullAppLocalProxyToken(),
    rawFunctionsPort = defaultRawFunctionsPort,
    proxyPort = defaultProxyPort,
    readinessTimeoutMs = 30_000,
    gracePeriodMs = 3_000,
    platform = process.platform,
    spawnService = spawn,
    supervise = startServiceSupervisor,
    createProxyServer = createLocalApiProxyServer,
    waitForReady = waitForFunctionsHost,
    registerSignalHandler = process.on.bind(process),
    unregisterSignalHandler = process.off.bind(process),
  } = {},
) {
  let supervisor;
  let proxyServer;
  let proxyAddress;
  let stopRequested = false;
  let stopPromise;
  let resolveFinished;
  const finished = new Promise((resolveFinishedPromise) => {
    resolveFinished = resolveFinishedPromise;
  });

  const removeSignalHandlers = () => {
    unregisterSignalHandler("SIGINT", stopForSignal);
    unregisterSignalHandler("SIGTERM", stopForSignal);
  };
  const stop = (exitCode = 0) => {
    if (stopPromise) return stopPromise;
    stopRequested = true;
    process.exitCode = exitCode;
    stopPromise = (async () => {
      await closeServer(proxyServer);
      if (supervisor) {
        supervisor.stop(exitCode);
        await supervisor.finished;
      }
      removeSignalHandlers();
    })().finally(resolveFinished);
    return stopPromise;
  };
  function stopForSignal() {
    void stop(0);
  }

  registerSignalHandler("SIGINT", stopForSignal);
  registerSignalHandler("SIGTERM", stopForSignal);

  try {
    if (stopRequested) {
      return { stop, finished, proxyAddress };
    }

    const functions = createFullAppFunctionsDefinition(rootDir, {
      baseEnv,
      localProxyToken,
      rawFunctionsPort,
    });
    supervisor = supervise([functions], { gracePeriodMs, platform, spawnService });
    const exitedBeforeReadiness = supervisor.finished.then(() => {
      if (!stopRequested) throw new Error("Functions exited before the Full App API proxy was ready.");
    });
    await Promise.race([
      waitForReady(rawFunctionsPort, { timeoutMs: readinessTimeoutMs }),
      exitedBeforeReadiness,
    ]);
    if (stopRequested) {
      await stop();
      return { stop, finished, proxyAddress };
    }

    proxyServer = createProxyServer({ localProxyToken, rawFunctionsPort });
    proxyAddress = await listenOnLoopback(proxyServer, proxyPort);
    console.log(
      `[full-app-api] Ready on http://${loopbackHost}:${proxyAddress.port}; raw Functions port ${rawFunctionsPort}.`,
    );

    void supervisor.finished.then(() => {
      if (!stopRequested) void stop(1);
    });
    return { stop, finished, proxyAddress };
  } catch (error) {
    await stop(1);
    throw error;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const boundary = await startFullAppApiBoundary(repositoryRoot);
    await boundary.finished;
  } catch (error) {
    console.error(`[full-app-api] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
