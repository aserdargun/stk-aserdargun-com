import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);

async function start() {
  root.render(<div className="page-state" role="status">Verifying your private workspace…</div>);
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
    if (response.status === 401 || response.status === 403) {
      window.location.replace(response.status === 401 ? "/login" : "/access-denied.html");
      return;
    }
    if (!response.ok) throw new Error("Session service unavailable.");
    const session = (await response.json()) as { owner?: boolean };
    if (session.owner !== true) {
      window.location.replace("/access-denied.html");
      return;
    }

    root.render(
      <StrictMode>
        <AppErrorBoundary><App /></AppErrorBoundary>
      </StrictMode>,
    );
  } catch {
    root.render(
      <div className="page-state" role="alert">
        <p>Stackfolio could not verify this session.</p>
        <button className="button secondary" onClick={() => void start()}>Try again</button>
        <a href="/login">Return to sign-in</a>
      </div>,
    );
  }
}

void start();
