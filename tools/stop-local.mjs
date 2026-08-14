import { spawnSync } from "node:child_process";

const defaultLocalPorts = [5173, 3001, 4280, 7071, 7072, 10000, 10001, 10002];

function parsePorts(value) {
  const values = value ? value.split(",") : defaultLocalPorts;
  const ports = values.map((port) => Number(String(port).trim()));
  if (ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) {
    throw new Error("STACKFOLIO_LOCAL_PORTS must contain comma-separated TCP ports.");
  }
  return [...new Set(ports)];
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

function listeningPids(port) {
  const result = run("lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"]);
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `lsof failed while checking port ${port}.`);
  }
  return result.stdout
    .split(/\s+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger);
}

function processGroupId(pid) {
  const result = run("ps", ["-o", "pgid=", "-p", String(pid)]);
  if (result.status !== 0) return undefined;
  const processGroup = Number(result.stdout.trim());
  return Number.isInteger(processGroup) && processGroup > 0 ? processGroup : undefined;
}

function processIdsInGroup(processGroup) {
  const result = run("ps", ["-axo", "pid=,pgid=,state="]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "ps failed.");
  return result.stdout
    .split("\n")
    .map((line) => {
      const [pid, pgid, state] = line.trim().split(/\s+/);
      return [Number(pid), Number(pgid), state];
    })
    .filter(([pid, pgid, state]) => (
      Number.isInteger(pid) && pgid === processGroup && !state?.startsWith("Z")
    ))
    .map(([pid]) => pid);
}

function findTargets(ports) {
  const currentProcessGroup = processGroupId(process.pid);
  const activePorts = [];
  const targets = new Map();

  for (const port of ports) {
    const pids = listeningPids(port);
    if (pids.length > 0) activePorts.push(port);
    for (const pid of pids) {
      const processGroup = processGroupId(pid);
      const useProcessGroup = processGroup && processGroup !== currentProcessGroup;
      const key = useProcessGroup ? `group:${processGroup}` : `pid:${pid}`;
      targets.set(key, {
        pid,
        processGroup: useProcessGroup ? processGroup : undefined,
      });
    }
  }

  return { activePorts, targets: [...targets.values()] };
}

function targetProcessIds(target) {
  return target.processGroup ? processIdsInGroup(target.processGroup) : [target.pid];
}

function signalTargets(targets, signal) {
  const processIds = new Set(targets.flatMap(targetProcessIds));
  for (const pid of processIds) {
    if (pid === process.pid) continue;
    try {
      process.kill(pid, signal);
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ESRCH")) throw error;
    }
  }
}

function isTargetAlive(target) {
  if (target.processGroup) return targetProcessIds(target).length > 0;
  const result = run("ps", ["-o", "state=", "-p", String(target.pid)]);
  const state = result.stdout.trim();
  return Boolean(state) && !state.startsWith("Z");
}

function targetDiagnostics(targets) {
  return targets.flatMap(targetProcessIds).map((pid) => {
    const result = run("ps", ["-o", "state=", "-p", String(pid)]);
    return `${pid}:${result.stdout.trim() || "gone"}`;
  });
}

async function waitUntilStopped(ports, targets, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const portsClosed = ports.every((port) => listeningPids(port).length === 0);
    if (portsClosed && targets.every((target) => !isTargetAlive(target))) return true;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  return (
    ports.every((port) => listeningPids(port).length === 0) &&
    targets.every((target) => !isTargetAlive(target))
  );
}

export async function stopLocalPorts(ports = parsePorts(process.env.STACKFOLIO_LOCAL_PORTS)) {
  const initial = findTargets(ports);
  if (initial.activePorts.length === 0) {
    console.log("No Stackfolio local ports are in use.");
    return;
  }

  signalTargets(initial.targets, "SIGTERM");
  if (!(await waitUntilStopped(initial.activePorts, initial.targets, 3_000))) {
    signalTargets(initial.targets, "SIGKILL");
    if (!(await waitUntilStopped(initial.activePorts, initial.targets, 1_000))) {
      throw new Error(
        `Could not fully stop Stackfolio local services for ports: ${initial.activePorts.join(", ")} ` +
          `(remaining ${targetDiagnostics(initial.targets).join(", ") || "none"}).`,
      );
    }
  }

  console.log(`Stopped Stackfolio local ports: ${initial.activePorts.join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await stopLocalPorts();
  } catch (error) {
    console.error(`[stop-local] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
