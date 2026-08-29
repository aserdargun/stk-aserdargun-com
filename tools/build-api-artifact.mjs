import { spawn } from "node:child_process";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(repositoryRoot, "api");
const artifactRoot = resolve(repositoryRoot, "api-dist");

if (dirname(artifactRoot) !== repositoryRoot || basename(artifactRoot) !== "api-dist") {
  throw new Error("Refusing to clean an API artifact outside this repository.");
}

await access(resolve(apiRoot, "dist/functions/stackfolio.js"));
await access(resolve(apiRoot, "package-lock.artifact.json"));

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });
await cp(resolve(apiRoot, "dist"), resolve(artifactRoot, "dist"), { recursive: true });
await cp(resolve(apiRoot, "host.json"), resolve(artifactRoot, "host.json"));
await cp(resolve(apiRoot, "package.artifact.json"), resolve(artifactRoot, "package.json"));
await cp(resolve(apiRoot, "package-lock.artifact.json"), resolve(artifactRoot, "package-lock.json"));

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const install = spawn(
  npmCommand,
  ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: artifactRoot, stdio: "inherit" },
);
const exitCode = await new Promise((resolveExit) => install.once("exit", resolveExit));

if (exitCode !== 0) {
  throw new Error(`Production dependency installation failed with exit code ${exitCode ?? "unknown"}.`);
}

await access(resolve(artifactRoot, "node_modules/@azure/functions/package.json"));
