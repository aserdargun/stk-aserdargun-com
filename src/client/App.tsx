import { lazy, Suspense, useState } from "react";
import { BarChart3, Cloud, LayoutDashboard, LogOut, Plus, WalletCards } from "lucide-react";
import { AddCostModal } from "./components/AddCostModal";
import { CostsPage } from "./components/CostsPage";

const Dashboard = lazy(() =>
  import("./components/Dashboard").then((module) => ({ default: module.Dashboard })),
);

type View = "overview" | "costs";

export function App() {
  const [view, setView] = useState<View>("overview");
  const [showAddCost, setShowAddCost] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="Go to overview">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>Stackfolio</strong>
            <small>Digital investment tracker</small>
          </span>
        </button>

        <nav className="primary-nav" aria-label="Main navigation">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>
            <LayoutDashboard size={19} /> Overview
          </button>
          <button className={view === "costs" ? "active" : ""} onClick={() => setView("costs")}>
            <WalletCards size={19} /> Costs
          </button>
        </nav>

        <div className="sidebar-foot">
          <div className="privacy-card">
            <Cloud size={18} />
            <div>
              <strong>Private by design</strong>
              <span>GitHub identity and encrypted Azure storage.</span>
            </div>
          </div>
          <span className="version">Stackfolio v1.0</span>
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
          <a
            className="button secondary sign-out"
            href="/.auth/logout?post_logout_redirect_uri=https%3A%2F%2Fstackfolio.aserdargun.com%2Fsigned-out.html"
            aria-label="Sign out"
          >
            <LogOut size={17} /> <span className="button-label">Sign out</span>
          </a>
          <button className="button primary" onClick={() => setShowAddCost(true)}>
            <Plus size={18} /> <span className="button-label">Add cost</span>
          </button>
        </header>

        <Suspense fallback={<div className="page-state">Loading Stackfolio…</div>}>
          {view === "overview" ? (
            <Dashboard key={`dashboard-${refreshKey}`} onOpenCosts={() => setView("costs")} />
          ) : (
            <CostsPage
              key={`costs-${refreshKey}`}
              onChanged={(message) => {
                setRefreshKey((value) => value + 1);
                announce(message);
              }}
            />
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
