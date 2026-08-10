import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Archive, ExternalLink, Plus, RotateCcw, X } from "lucide-react";
import { api } from "../lib/api";
import { formatBillingType, formatDate, formatMoney, formatPeriodKind } from "../lib/format";
import type { ItemDetail } from "../types";

const today = new Date().toISOString().slice(0, 10);

export function ItemDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: number;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [detail, setDetail] = useState<ItemDetail | null>(null);
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.getItem(id).then(setDetail).catch((reason: Error) => setError(reason.message));
  };

  useEffect(load, [id]);

  const lifetimeSpend = useMemo(
    () => detail?.entries.reduce((total, entry) => total + entry.amount, 0) || 0,
    [detail],
  );

  const toggleStatus = async () => {
    if (!detail) return;
    setSubmitting(true);
    setError(null);
    const nextStatus = detail.item.status === "active" ? "closed" : "active";
    try {
      const response = await api.updateItem(id, {
        status: nextStatus,
        closedAt: nextStatus === "closed" ? today : null,
      });
      setDetail(response);
      onChanged(nextStatus === "closed" ? "Cost closed. Its history remains intact." : "Cost reactivated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Status could not be updated.");
    } finally {
      setSubmitting(false);
    }
  };

  const addEntry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await api.addEntry(id, {
        amount: Number(form.get("amount")),
        currency: "TRY",
        periodStart: String(form.get("periodStart")),
        periodKind: String(form.get("periodKind")),
        note: String(form.get("note") || ""),
      });
      setShowEntryForm(false);
      load();
      onChanged("Ledger entry added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The entry could not be added.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="item-drawer" role="dialog" aria-modal="true" aria-label="Cost details">
        <div className="drawer-top">
          <button className="icon-button" onClick={onClose} aria-label="Close details"><X size={20} /></button>
        </div>
        {!detail ? (
          <div className="page-state">Loading cost history…</div>
        ) : (
          <div className="drawer-content">
            <div className="drawer-title">
              <span className={`category-pill category-${detail.item.category.toLowerCase()}`}>{detail.item.category}</span>
              <h2>{detail.item.name}</h2>
              <div className="drawer-subtitle">
                <span>{detail.item.plan || formatBillingType(detail.item.billingType)}</span>
                <span className={`status-pill ${detail.item.status}`}>{detail.item.status}</span>
              </div>
            </div>

            <div className="drawer-metrics">
              <div><span>Lifetime spend</span><strong>{formatMoney(lifetimeSpend)}</strong></div>
              <div><span>Ledger entries</span><strong>{detail.entries.length}</strong></div>
            </div>

            <div className="drawer-actions">
              <button className="button primary" onClick={() => setShowEntryForm((value) => !value)}>
                <Plus size={17} /> Add entry
              </button>
              <button className="button secondary" onClick={toggleStatus} disabled={submitting}>
                {detail.item.status === "active" ? <Archive size={17} /> : <RotateCcw size={17} />}
                {detail.item.status === "active" ? "Close cost" : "Reactivate"}
              </button>
            </div>

            {showEntryForm && (
              <form className="entry-form" onSubmit={addEntry}>
                <div className="form-grid two">
                  <label className="field">
                    <span>Amount</span>
                    <div className="money-input"><span>₺</span><input name="amount" type="number" step="0.01" required autoFocus /></div>
                  </label>
                  <label className="field">
                    <span>Entry date</span>
                    <input name="periodStart" type="date" defaultValue={today} required />
                  </label>
                  <label className="field full">
                    <span>Entry type</span>
                    <select name="periodKind" defaultValue={detail.item.billingType === "recurring" ? "month" : detail.item.billingType === "annual" ? "year" : "one_time"}>
                      <option value="month">Monthly</option>
                      <option value="year">Annual total</option>
                      <option value="one_time">One-time</option>
                    </select>
                  </label>
                  <label className="field full">
                    <span>Note</span>
                    <input name="note" maxLength={500} placeholder="Optional context" />
                  </label>
                </div>
                <div className="entry-form-actions">
                  <button type="button" className="text-button" onClick={() => setShowEntryForm(false)}>Cancel</button>
                  <button className="button primary small" disabled={submitting}>{submitting ? "Saving…" : "Save entry"}</button>
                </div>
              </form>
            )}

            {error && <div className="form-error">{error}</div>}

            <section className="detail-section">
              <h3>Details</h3>
              <dl className="detail-list">
                <div><dt>Billing</dt><dd>{formatBillingType(detail.item.billingType)}</dd></div>
                <div><dt>Account</dt><dd>{detail.item.account || "—"}</dd></div>
                {detail.item.powerWatts !== null && <div><dt>Power</dt><dd>{detail.item.powerWatts} W</dd></div>}
                <div><dt>Closed on</dt><dd>{formatDate(detail.item.closedAt)}</dd></div>
              </dl>
              {detail.item.url && (
                <a className="external-link" href={detail.item.url} target="_blank" rel="noreferrer">
                  Open website <ExternalLink size={14} />
                </a>
              )}
              {detail.item.notes && <p className="item-notes">{detail.item.notes}</p>}
            </section>

            <section className="detail-section ledger-section">
              <div className="section-heading"><h3>Ledger history</h3><span>{detail.entries.length} entries</span></div>
              <div className="ledger-list">
                {detail.entries.map((entry) => (
                  <div className="ledger-row" key={entry.id}>
                    <div>
                      <strong>{formatDate(entry.periodStart, { month: "short", year: "numeric" })}</strong>
                      <span>{formatPeriodKind(entry.periodKind)}{entry.sourceRef ? ` · ${entry.sourceRef}` : ""}</span>
                      {entry.note && <small>{entry.note}</small>}
                    </div>
                    <strong className={entry.amount < 0 ? "negative" : ""}>{formatMoney(entry.amount)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
