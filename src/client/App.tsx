import { lazy, Suspense, useState } from "react";
import { BarChart3, Cloud, ExternalLink, FileUp, LayoutDashboard, LogOut, Plus, TableProperties, WalletCards } from "lucide-react";
import { AddCostModal } from "./components/AddCostModal";
import { CostsPage } from "./components/CostsPage";

const Dashboard = lazy(() =>
  import("./components/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const TableViewPage = lazy(() =>
  import("./components/TableViewPage").then((module) => ({ default: module.TableViewPage })),
);
const ImportStatementsPage = lazy(() =>
  import("./components/ImportStatementsPage").then((module) => ({
    default: module.ImportStatementsPage,
  })),
);

type View = "overview" | "costs" | "table" | "import";

export function App() {
  const [view, setView] = useState<View>("overview");
  const [showAddCost, setShowAddCost] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const deploymentOrigin = typeof window === "undefined" ? "https://stk.aserdargun.com" : window.location.origin;
  const signedOutUrl = encodeURIComponent(`${deploymentOrigin}/signed-out.html`);

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Go to overview">
          <span className="brand-mark" aria-hidden="true">
            <span>AS</span>
          </span>
          <span>
            <strong>Stackfolio</strong>
            <small>by A. Serdar Gün</small>
          </span>
        </button>

        <nav className="primary-nav" aria-label="Workspace navigation">
          <span className="nav-section-label">Workspace</span>
          <button
            className={view === "overview" ? "active" : ""}
            onClick={() => setView("overview")}
            aria-current={view === "overview" ? "page" : undefined}
          >
            <LayoutDashboard size={19} /> <span>Overview</span>
          </button>
          <button
            className={view === "costs" ? "active" : ""}
            onClick={() => setView("costs")}
            aria-current={view === "costs" ? "page" : undefined}
          >
            <WalletCards size={19} /> <span>Costs</span>
          </button>
          <button
            className={view === "table" ? "active" : ""}
            onClick={() => setView("table")}
            aria-current={view === "table" ? "page" : undefined}
          >
            <TableProperties size={19} /> <span>Table View</span>
          </button>
          <button
            className={view === "import" ? "active" : ""}
            onClick={() => setView("import")}
            aria-current={view === "import" ? "page" : undefined}
          >
            <FileUp size={19} /> <span>Import</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          <a
            className="portfolio-link"
            href="https://aserdargun.com"
            target="_blank"
            rel="noreferrer"
            aria-label="Visit A. Serdar Gün’s portfolio"
          >
            <span>
              <small>Part of the</small>
              <strong>aserdargun.com</strong>
            </span>
            <ExternalLink size={15} />
          </a>
          <div className="privacy-card">
            <Cloud size={18} />
            <div>
              <strong>Private by design</strong>
              <span>GitHub owner access and private Azure storage.</span>
            </div>
          </div>
          <span className="version">Owner-only financial workspace</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="mobile-brand">
            <BarChart3 size={21} /> <strong>Stackfolio</strong>
          </div>
          <div className="topbar-copy">
            <span className="eyebrow">Your digital stack, measured</span>
            <span className="topbar-date">
              {new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date())}
            </span>
          </div>
          <div className="topbar-actions">
            <a
              className="button secondary sign-out"
              href={`/.auth/logout?post_logout_redirect_uri=${signedOutUrl}`}
              aria-label="Sign out"
            >
              <LogOut size={17} /> <span className="button-label">Sign out</span>
            </a>
            <button className="button primary" onClick={() => setShowAddCost(true)}>
              <Plus size={18} /> <span className="button-label">Add cost</span>
            </button>
          </div>
        </header>

        <Suspense fallback={<div className="page-state">Loading Stackfolio…</div>}>
          {view === "overview" ? (
            <Dashboard
              key={`dashboard-${refreshKey}`}
              onOpenCosts={() => setView("costs")}
              onOpenImport={() => setView("import")}
            />
          ) : view === "costs" ? (
            <CostsPage
              onChanged={(message) => {
                setRefreshKey((value) => value + 1);
                announce(message);
              }}
            />
          ) : view === "import" ? (
            <ImportStatementsPage
              onImported={(message) => {
                setRefreshKey((value) => value + 1);
                announce(message);
              }}
            />
          ) : (
            <TableViewPage key={`table-${refreshKey}`} />
          )}
        </Suspense>
      </main>

      {showAddCost && (
        <AddCostModal
          onClose={() => setShowAddCost(false)}
          onCreated={() => {
            setShowAddCost(false);
            setRefreshKey((value) => value + 1);
            setView("costs");
            announce("Cost added to your portfolio.");
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
