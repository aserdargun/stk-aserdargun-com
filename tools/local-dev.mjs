import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(moduleDirectory, "..");
const processGroupPlatforms = new Set(["aix", "darwin", "freebsd", "linux", "openbsd", "sunos"]);

export function createServiceDefinitions(rootDir, baseEnv = process.env) {
  const azureDirectory = resolve(rootDir, ".azure");
  const sharedEnv = { ...baseEnv };
  delete sharedEnv.STACKFOLIO_LOCAL_AUTH_BYPASS;

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
      env: { ...sharedEnv },
    },
    {
      name: "API compiler",
      command: "npm",
      args: ["--workspace", "api", "exec", "--", "tsc", "--watch", "--preserveWatchOutput"],
      cwd: rootDir,
      env: { ...sharedEnv },
    },
    {
      name: "Functions",
      command: "func",
      args: ["start", "--port", "3001"],
      cwd: resolve(rootDir, "api"),
      env: { ...sharedEnv, STACKFOLIO_LOCAL_AUTH_BYPASS: "true" },
    },
    {
      name: "Vite",
      command: "npm",
      args: ["run", "dev:frontend"],
      cwd: rootDir,
      env: { ...sharedEnv },
    },
  ];
}

function isProcessGroupAlive(processGroupId) {
  if (!processGroupId) return false;

  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return false;
    return true;
  }
}

function signalProcessTree(processGroupId, signal) {
  if (!processGroupId) return;

  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ESRCH")) throw error;
  }
}

function assertProcessGroupPlatform(platform) {
  if (!processGroupPlatforms.has(platform)) {
    throw new Error(
      `The supervised local stack requires a POSIX platform with process groups; ${platform} is unsupported.`,
    );
  }
}

export function startServiceSupervisor(
  services,
  { gracePeriodMs = 3_000, platform = process.platform, spawnService = spawn } = {},
) {
  assertProcessGroupPlatform(platform);

  const processes = new Set();
  let stopping = false;
  let settled = false;
  let forceStop;
  let livenessCheck;
  let resolveFinished;
  const finished = new Promise((resolveFinishedPromise) => {
    resolveFinished = resolveFinishedPromise;
  });

  const settle = () => {
    if (settled) return;
    settled = true;
    if (forceStop) clearTimeout(forceStop);
    if (livenessCheck) clearInterval(livenessCheck);
    resolveFinished();
  };

  const allProcessGroupsStopped = () => {
    return [...processes].every(({ processGroupId }) => !isProcessGroupAlive(processGroupId));
  };

  const stop = (exitCode) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    for (const { processGroupId } of processes) signalProcessTree(processGroupId, "SIGTERM");

    livenessCheck = setInterval(() => {
      if (allProcessGroupsStopped()) settle();
    }, 25);
    forceStop = setTimeout(() => {
      for (const { processGroupId } of processes) signalProcessTree(processGroupId, "SIGKILL");
      if (allProcessGroupsStopped()) settle();
    }, gracePeriodMs);

    if (allProcessGroupsStopped()) settle();
  };

  for (const service of services) {
    let child;
    try {
      child = spawnService(service.command, service.args, {
        cwd: service.cwd,
        env: service.env,
        stdio: "inherit",
        detached: true,
      });
    } catch (error) {
      stop(1);
      throw error;
    }

    const processRecord = { child, processGroupId: child.pid };
    processes.add(processRecord);
    child.on("error", (error) => {
      console.error(`[local-dev] ${service.name} failed to start: ${error.message}`);
      stop(1);
    });
    child.on("exit", (code, signal) => {
      if (!stopping) {
        console.error(
          `[local-dev] ${service.name} exited (${signal ?? `code ${code ?? 1}`}); stopping local stack.`,
        );
        stop(code === 0 ? 1 : (code ?? 1));
      }
    });
  }

  return { stop, finished };
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

export function startLocalDevelopment(
  rootDir,
  {
    platform = process.platform,
    prepareLocalDevelopment: prepare = prepareLocalDevelopment,
    createServiceDefinitions: createServices = createServiceDefinitions,
    startServiceSupervisor: supervise = startServiceSupervisor,
    registerSignalHandler = process.on.bind(process),
  } = {},
) {
  assertProcessGroupPlatform(platform);
  prepare(rootDir);
  const supervisor = supervise(createServices(rootDir), { platform });

  registerSignalHandler("SIGINT", () => supervisor.stop(0));
  registerSignalHandler("SIGTERM", () => supervisor.stop(0));

  return supervisor;
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
