import { useEffect, useState } from "react";
import { ChevronRight, Filter, Search, WalletCards } from "lucide-react";
import { api } from "../lib/api";
import { formatBillingType, formatDate, formatMoney } from "../lib/format";
import type { CostItemSummary } from "../types";
import { ItemDrawer } from "./ItemDrawer";

export function CostsPage({ onChanged }: { onChanged: (message: string) => void }) {
  const [items, setItems] = useState<CostItemSummary[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      api
        .getItems({ search, category, status })
        .then(({ items: responseItems }) => {
          setItems(responseItems);
          setError(null);
        })
        .catch((reason: Error) => setError(reason.message))
        .finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [search, category, status, reloadKey]);

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Cost portfolio</span>
          <h1>Every commitment, one ledger.</h1>
          <p>Search your stack, inspect its history, record new entries, or close costs you no longer carry.</p>
        </div>
      </section>

      <section className="panel costs-panel">
        <div className="cost-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search costs, plans, or accounts"
              aria-label="Search costs"
            />
          </label>
          <div className="filter-group">
            <Filter size={17} />
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              <option>Platform</option>
              <option>Certificate</option>
              <option>Device</option>
              <option>Other</option>
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <div className="result-meta">
          <span>{loading ? "Updating…" : `${items.length} cost${items.length === 1 ? "" : "s"}`}</span>
          {(search || category || status) && (
            <button onClick={() => { setSearch(""); setCategory(""); setStatus(""); }}>Clear filters</button>
          )}
        </div>

        {error ? (
          <div className="page-state error">{error}</div>
        ) : items.length === 0 && !loading ? (
          <div className="empty-state">
            <WalletCards size={28} />
            <strong>No costs match these filters.</strong>
            <span>Try a different search or clear the filters.</span>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="cost-table">
              <thead>
                <tr>
                  <th>Cost</th>
                  <th>Category</th>
                  <th>Billing</th>
                  <th>Status</th>
                  <th>Latest entry</th>
                  <th className="numeric">Lifetime spend</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} onClick={() => setSelectedId(item.id)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && setSelectedId(item.id)}>
                    <td>
                      <strong>{item.name}</strong>
                      <span>{item.plan || `${item.entryCount} ledger ${item.entryCount === 1 ? "entry" : "entries"}`}</span>
                    </td>
                    <td><span className={`category-pill category-${item.category.toLowerCase()}`}>{item.category}</span></td>
                    <td>{formatBillingType(item.billingType)}</td>
                    <td><span className={`status-pill ${item.status}`}>{item.status}</span></td>
                    <td>{formatDate(item.latestPeriod, { month: "short", year: "numeric" })}</td>
                    <td className="numeric"><strong>{formatMoney(item.lifetimeSpend)}</strong></td>
                    <td><ChevronRight size={17} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedId && (
        <ItemDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={(message) => {
            setReloadKey((value) => value + 1);
            onChanged(message);
          }}
        />
      )}
    </div>
  );
}
