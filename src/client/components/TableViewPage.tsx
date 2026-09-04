import { useEffect, useState } from "react";
import { ArrowRight, CalendarRange, TableProperties } from "lucide-react";
import { api } from "../lib/api";
import { formatDate, formatMembership, formatMoney, formatServiceName, normalizeMembership } from "../lib/format";
import type { TableViewData } from "../types";

export function TableViewPage() {
  const [data, setData] = useState<TableViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTableView()
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-state">Building your subscription table…</div>;
  if (error || !data) {
    return <div className="page-state error">{error || "Table View data is unavailable."}</div>;
  }

  const rangeLabel = data.periods.length
    ? `${formatDate(`${data.periods[0].key}-01`, { month: "short", year: "numeric" })} – ${formatDate(`${data.periods[data.periods.length - 1].key}-01`, { month: "short", year: "numeric" })}`
    : "Latest 12 months";

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Active recurring services</span>
          <h1>Subscriptions, month by month.</h1>
          <p>
            Membership and actual monthly ledger costs across the latest 12-month data window,
            with monthly and rolling-year totals.
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
            <span className="panel-kicker">Active + recurring only</span>
            <h2>{data.rows.length} active subscription{data.rows.length === 1 ? "" : "s"}</h2>
          </div>
          <strong>{formatMoney(data.grandTotal)} rolling total</strong>
        </div>

        {data.rows.length === 0 ? (
          <div className="empty-state">
            <TableProperties size={28} />
            <strong>No active recurring services.</strong>
            <span>Activate a recurring cost to include it in this view.</span>
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
