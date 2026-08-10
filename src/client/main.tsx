import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

async function start() {
  try {
    const response = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (response.redirected && new URL(response.url).pathname === "/login") {
      window.location.replace("/login");
      return;
    }
    const session = (await response.json()) as { owner?: boolean };

    if (!response.ok || !session.owner) {
      window.location.replace(response.status === 401 ? "/login" : "/access-denied.html");
      return;
    }

    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch {
    root.render(
      <div className="page-state" role="alert">
        Stackfolio could not verify this session. <a href="/login">Return to sign-in</a>
      </div>,
    );
  }
}

void start();
