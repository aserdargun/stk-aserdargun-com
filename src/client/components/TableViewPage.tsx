import { useEffect, useState } from "react";
import { CalendarRange, TableProperties } from "lucide-react";
import { api } from "../lib/api";
import { formatMoney } from "../lib/format";
import type { TableViewData } from "../types";

export default function TableViewPage() {
  const [data, setData] = useState<TableViewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTableView()
      .then((response) => {
        setData(response);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  if (error) return <div className="page-state error">{error}</div>;
  if (!data) return <div className="page-state">Loading the recurring table…</div>;

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading table-view-heading">
        <div>
          <span className="eyebrow">Recurring commitments</span>
          <h1>Twelve months, service by service.</h1>
          <p>
            Active recurring costs only. Monthly entries drive spend, while membership follows each service’s ledger history.
          </p>
        </div>
        <div className="table-window-badge">
          <CalendarRange size={17} />
          <span>Rolling window</span>
          <strong>
            {data.periods[0]?.label} – {data.periods.at(-1)?.label}
          </strong>
        </div>
      </section>

      <section className="panel table-view-panel">
        {data.rows.length === 0 ? (
          <div className="empty-state table-view-empty">
            <TableProperties size={30} />
            <strong>No active recurring services yet.</strong>
            <span>
              Add or reactivate a recurring cost to populate this rolling table.
            </span>
          </div>
        ) : (
          <div className="table-view-scroll" tabIndex={0} aria-label="Rolling recurring cost table">
            <table className="recurring-table">
              <caption className="sr-only">
                Active recurring services across the latest twelve monthly ledger periods
              </caption>
              <thead>
                <tr>
                  <th className="table-service-column">Service</th>
                  <th>Current membership</th>
                  {data.periods.map((period) => (
                    <th key={period.key}>{period.label}</th>
                  ))}
                  <th className="table-total-column">12-month total</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <th scope="row" className="table-service-column">
                      {row.name}
                    </th>
                    <td className="table-current-membership">
                      {row.currentMembership || "—"}
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.period} className="table-month-cell">
                        <strong>{formatMoney(cell.amount)}</strong>
                        <small>{cell.membership || "—"}</small>
                      </td>
                    ))}
                    <td className="table-total-column">
                      <strong>{formatMoney(row.total)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" className="table-service-column">Monthly total</th>
                  <td>—</td>
                  {data.monthlyTotals.map((amount, index) => (
                    <td key={data.periods[index].key}>
                      <strong>{formatMoney(amount)}</strong>
                    </td>
                  ))}
                  <td className="table-total-column">
                    <strong>{formatMoney(data.grandTotal)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
