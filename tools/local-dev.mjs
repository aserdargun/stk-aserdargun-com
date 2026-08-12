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
