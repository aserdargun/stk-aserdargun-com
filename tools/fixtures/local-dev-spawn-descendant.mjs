import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const [pidFile] = process.argv.slice(2);
const descendant = spawn(
  process.execPath,
  [
    "-e",
    "const { writeFileSync } = require('node:fs'); process.on('SIGTERM', () => {}); writeFileSync(process.env.DESCENDANT_READY_FILE, 'ready'); setInterval(() => {}, 1_000)",
  ],
  { stdio: "ignore", env: { ...process.env, DESCENDANT_READY_FILE: `${pidFile}.ready` } },
);

writeFileSync(pidFile, String(descendant.pid));
setInterval(() => {}, 1_000);
