import { createServer } from "node:http";

const port = Number(process.argv[2]);
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end('{"status":"ok"}');
});

server.listen(port, "127.0.0.1");
