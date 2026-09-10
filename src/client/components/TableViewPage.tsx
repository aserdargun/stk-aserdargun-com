import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, AlertTriangle, CalendarRange, RefreshCcw, TableProperties } from "lucide-react";
import { api } from "../lib/api";
import { formatDate, formatMembership, formatMoney, formatServiceName, normalizeMembership } from "../lib/format";
import type { CostItemSummary, TableViewData } from "../types";

interface TableReconciliation {
  activeCount: number;
  missingFromTable: CostItemSummary[];
  checkedAt: string;
}

export function TableViewPage() {
  const [data, setData] = useState<TableViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<TableReconciliation | null>(null);
  const loadVersion = useRef(0);
  const [resyncing, setResyncing] = useState(false);

  // Run on every mount: fetch the table-view data and cross-check it against
  // the active items list. If the two diverge, surface a banner so the user
  // can re-sync without leaving the page.
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.reconcileTableView();
      if (version !== loadVersion.current) return;
      setData(result.tableData);
      setReconciliation({
        activeCount: result.activeCount,
        missingFromTable: result.missingFromTable,
        checkedAt: new Date().toISOString(),
      });
    } catch (reason) {
      if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : "Table View data is unavailable.");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, [load, reloadKey]);

  const resync = async () => {
    setResyncing(true);
    try {
      // The table-view is computed server-side; an extra round trip is the
      // cheapest way to confirm the inconsistency was a stale snapshot
      // (e.g. just-added item) and not a persistent server-side gap.
      await load();
    } finally {
      setResyncing(false);
    }
  };

  if (loading) return <div className="page-state">Building your subscription table…</div>;
  if (error || !data) {
    return <div className="page-state error" role="alert">{error || "Table View data is unavailable."}<button className="button secondary" onClick={() => setReloadKey((value) => value + 1)}>Try again</button></div>;
  }

  const drift = reconciliation && reconciliation.missingFromTable.length > 0
    ? reconciliation
    : null;

  const rangeLabel = data.periods.length
    ? `${formatDate(`${data.periods[0].key}-01`, { month: "short", year: "numeric" })} – ${formatDate(`${data.periods[data.periods.length - 1].key}-01`, { month: "short", year: "numeric" })}`
    : "Latest 12 months";

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Active services</span>
          <h1>Active costs, month by month.</h1>
          <p>
            Every active cost from the Costs page, including subscriptions, annual items, and
            one-time charges. Recurring subscriptions fill the 12-month grid; one-time and annual
            entries land in the month of their ledger date, with the rolling 12-month total on
            the right.
          </p>
        </div>
        <div className="table-range-chip">
          <CalendarRange size={17} />
          <span>{rangeLabel}</span>
        </div>
      </section>

      <section className="panel table-view-panel">
        <div className="table-view-heading">
          <div>
            <span className="panel-kicker">Active costs only</span>
            <h2>{data.rows.length} active cost{data.rows.length === 1 ? "" : "s"}</h2>
          </div>
          <div className="table-view-heading-tools">
            <strong>{formatMoney(data.grandTotal)} rolling total</strong>
            <button
              type="button"
              className="button tertiary"
              onClick={resync}
              disabled={resyncing}
              aria-label="Re-sync with Costs"
            >
              <RefreshCcw size={14} className={resyncing ? "spin" : ""} /> Re-sync
            </button>
          </div>
        </div>

        {drift && (
          <div className="reconciliation-warning" role="status">
            <div className="reconciliation-warning-head">
              <AlertTriangle size={16} />
              <strong>
                Table View is out of sync with Costs —{" "}
                {drift.missingFromTable.length} active cost
                {drift.missingFromTable.length === 1 ? "" : "s"} missing.
              </strong>
            </div>
            <p>
              The Costs page lists {drift.activeCount} active costs, but this matrix only
              includes {data.rows.length}. The following are missing here:
            </p>
            <ul>
              {drift.missingFromTable.map((item) => (
                <li key={item.id}>
                  <strong>{formatServiceName(item.name)}</strong>
                  <span className="import-muted">
                    {item.category} · {item.billingType}
                    {item.latestPeriod ? ` · last entry ${item.latestPeriod}` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="reconciliation-warning-hint">
              This usually clears with a refresh; if it persists, the build needs a code fix.
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={resync}
              disabled={resyncing}
            >
              <RefreshCcw size={14} className={resyncing ? "spin" : ""} /> Re-sync now
            </button>
          </div>
        )}

        {data.rows.length === 0 ? (
          <div className="empty-state">
            <TableProperties size={28} />
            <strong>No active costs.</strong>
            <span>Add a cost from the Costs page to include it in this view.</span>
          </div>
        ) : (
          <>
            <div className="table-scroll-guide" aria-hidden="true">
              <span>Swipe to compare months</span>
              <ArrowRight size={15} />
            </div>
            <div
              className="table-view-scroll"
              tabIndex={0}
              role="region"
              aria-label="Monthly subscription comparison table"
            >
            <table className="subscription-table">
              <thead>
                <tr>
                  <th className="sticky-service">Service</th>
                  <th>Current membership</th>
                  {data.periods.map((period) => (
                    <th className="numeric" key={period.key}>{period.label}</th>
                  ))}
                  <th className="numeric sticky-total">12-mo total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <th className="sticky-service" scope="row">{formatServiceName(row.name)}</th>
                    <td className="current-membership">{formatMembership(row.currentMembership)}</td>
                    {row.cells.map((cell) => (
                      <td className="subscription-cell numeric" key={cell.period}>
                        <strong>{cell.amount === 0 ? "—" : formatMoney(cell.amount)}</strong>
                        {normalizeMembership(cell.membership) && (
                          <small>{formatMembership(cell.membership)}</small>
                        )}
                      </td>
                    ))}
                    <td className="numeric sticky-total"><strong>{formatMoney(row.total)}</strong></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="sticky-service" scope="row">Monthly total</th>
                  <td>All active services</td>
                  {data.monthlyTotals.map((total, index) => (
                    <td className="numeric" key={data.periods[index].key}>
                      <strong>{formatMoney(total)}</strong>
                    </td>
                  ))}
                  <td className="numeric sticky-total"><strong>{formatMoney(data.grandTotal)}</strong></td>
                </tr>
              </tfoot>
            </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
