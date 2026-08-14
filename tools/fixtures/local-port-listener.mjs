import { writeFileSync } from "node:fs";
import { createServer } from "node:net";

const readyFile = process.argv[2];
if (!readyFile) throw new Error("A ready-file path is required.");
const lingerAfterClose = process.argv[3] === "--linger-after-close";
if (lingerAfterClose) setInterval(() => {}, 1_000);

const server = createServer();
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address.");
  writeFileSync(readyFile, String(address.port));
});

const stop = () => server.close(() => {
  if (!lingerAfterClose) process.exit(0);
});
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
