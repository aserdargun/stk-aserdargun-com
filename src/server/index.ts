import { createApp } from "./app.js";
import { getDefaultDatabasePath, openDatabase } from "./db.js";

const port = Number(process.env.PORT || 3001);
const db = openDatabase();
const app = createApp(db, { serveClient: process.env.NODE_ENV === "production" });

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Stackfolio is running at http://127.0.0.1:${port}`);
  console.log(`SQLite database: ${getDefaultDatabasePath()}`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
