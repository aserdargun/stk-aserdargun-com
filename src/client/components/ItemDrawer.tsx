import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Archive,
  CalendarRange,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { buildItemMonthlySeries } from "../lib/costs";
import {
  formatBillingType,
  formatDate,
  formatMoney,
  formatPeriodKind,
} from "../lib/format";
import type { CostEntry, ItemDetail, PeriodKind } from "../types";

const ItemMonthlyChart = lazy(() => import("./ItemMonthlyChart"));
const today = new Date().toISOString().slice(0, 10);

interface EntryDraft {
  amount: string;
  periodStart: string;
  periodKind: PeriodKind;
  membership: string;
  note: string;
}

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
  const [chartYear, setChartYear] = useState<number>();
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await api.getItem(id);
      setDetail(response);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cost history is unavailable.");
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const lifetimeSpend = useMemo(
    () => detail?.entries.reduce((total, entry) => total + entry.amount, 0) || 0,
    [detail],
  );
  const chartData = useMemo(
    () => buildItemMonthlySeries(detail?.entries || [], chartYear),
    [chartYear, detail],
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
      onChanged(
        nextStatus === "closed"
          ? "Cost closed. Its history remains intact."
          : "Cost reactivated.",
      );
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
      const response = await api.addEntry(id, {
        amount: Number(form.get("amount")),
        currency: "TRY",
        periodStart: String(form.get("periodStart")),
        periodKind: String(form.get("periodKind")),
        membership: String(form.get("membership") || ""),
        note: String(form.get("note") || ""),
      });
      setDetail(response);
      setShowEntryForm(false);
      onChanged("Ledger entry added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The entry could not be added.");
    } finally {
      setSubmitting(false);
    }
  };

  const beginEntryEdit = (entry: CostEntry) => {
    setEditingEntryId(entry.id);
    setEntryDraft({
      amount: String(entry.amount),
      periodStart: entry.periodStart,
      periodKind: entry.periodKind,
      membership: entry.membership || "",
      note: entry.note || "",
    });
  };

  const cancelEntryEdit = () => {
    setEditingEntryId(null);
    setEntryDraft(null);
  };

  const saveEntry = async (
    event: FormEvent<HTMLFormElement>,
    entry: CostEntry,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!entryDraft) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.updateEntry(id, entry.id, {
        amount: Number(entryDraft.amount),
        currency: entry.currency,
        periodStart: entryDraft.periodStart,
        periodKind: entryDraft.periodKind,
        membership: entryDraft.membership,
        note: entryDraft.note,
      });
      setDetail(response);
      cancelEntryEdit();
      onChanged("Ledger entry updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The entry could not be updated.");
    } finally {
      setSubmitting(false);
    }
  };

  const currentMembership =
    detail?.entries[0]?.membership || detail?.item.plan || null;

  return (
    <div
      className="drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside className="item-drawer" role="dialog" aria-modal="true" aria-label="Cost details">
        <div className="drawer-top">
          <button className="icon-button" onClick={onClose} aria-label="Close details">
            <X size={20} />
          </button>
        </div>
        {!detail ? (
          <div className={`page-state${error ? " error" : ""}`}>
            {error || "Loading cost history…"}
          </div>
        ) : (
          <div className="drawer-content">
            <div className="drawer-title">
              <span className={`category-pill category-${detail.item.category.toLowerCase()}`}>
                {detail.item.category}
              </span>
              <h2>{detail.item.name}</h2>
              <div className="drawer-subtitle">
                <span>{currentMembership || formatBillingType(detail.item.billingType)}</span>
                <span className={`status-pill ${detail.item.status}`}>{detail.item.status}</span>
              </div>
            </div>

            <div className="drawer-metrics">
              <div>
                <span>Lifetime spend</span>
                <strong>{formatMoney(lifetimeSpend)}</strong>
              </div>
              <div>
                <span>Ledger entries</span>
                <strong>{detail.entries.length}</strong>
              </div>
            </div>

            <section className="detail-section detail-chart-section">
              <div className="detail-chart-heading">
                <div>
                  <span className="panel-kicker">Monthly history</span>
                  <h3>{chartData.year} monthly spend</h3>
                </div>
                <label className="detail-year-picker">
                  <CalendarRange size={15} />
                  <span className="sr-only">Chart year</span>
                  <select
                    value={chartData.year}
                    onChange={(event) => setChartYear(Number(event.target.value))}
                    aria-label="Chart year"
                  >
                    {(chartData.availableYears.length
                      ? chartData.availableYears
                      : [chartData.year]
                    ).map((year) => (
                      <option value={year} key={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="item-chart-wrap">
                <Suspense fallback={<div className="chart-loading">Loading chart…</div>}>
                  <ItemMonthlyChart entries={detail.entries} year={chartData.year} />
                </Suspense>
              </div>
              {chartData.availableYears.length === 0 && (
                <p className="chart-note">Add a monthly entry to start this chart.</p>
              )}
            </section>

            <div className="drawer-actions">
              <button
                className="button primary"
                onClick={() => setShowEntryForm((value) => !value)}
              >
                <Plus size={17} /> Add entry
              </button>
              <button className="button secondary" onClick={toggleStatus} disabled={submitting}>
                {detail.item.status === "active" ? (
                  <Archive size={17} />
                ) : (
                  <RotateCcw size={17} />
                )}
                {detail.item.status === "active" ? "Close cost" : "Reactivate"}
              </button>
            </div>

            {showEntryForm && (
              <form className="entry-form" onSubmit={addEntry}>
                <div className="form-grid two">
                  <label className="field">
                    <span>Amount</span>
                    <div className="money-input">
                      <span>₺</span>
                      <input name="amount" type="number" step="0.01" required />
                    </div>
                  </label>
                  <label className="field">
                    <span>Entry date</span>
                    <input name="periodStart" type="date" defaultValue={today} required />
                  </label>
                  <label className="field">
                    <span>Entry type</span>
                    <select
                      name="periodKind"
                      defaultValue={
                        detail.item.billingType === "recurring"
                          ? "month"
                          : detail.item.billingType === "annual"
                            ? "year"
                            : "one_time"
                      }
                    >
                      <option value="month">Monthly</option>
                      <option value="year">Annual total</option>
                      <option value="one_time">One-time</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Membership</span>
                    <input
                      name="membership"
                      maxLength={120}
                      defaultValue={currentMembership || ""}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="field full">
                    <span>Note</span>
                    <input name="note" maxLength={500} placeholder="Optional context" />
                  </label>
                </div>
                <div className="entry-form-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowEntryForm(false)}
                  >
                    Cancel
                  </button>
                  <button className="button primary small" disabled={submitting}>
                    {submitting ? "Saving…" : "Save entry"}
                  </button>
                </div>
              </form>
            )}

            {error && <div className="form-error">{error}</div>}

            <section className="detail-section">
              <h3>Details</h3>
              <dl className="detail-list">
                <div>
                  <dt>Billing</dt>
                  <dd>{formatBillingType(detail.item.billingType)}</dd>
                </div>
                <div>
                  <dt>Account</dt>
                  <dd>{detail.item.account || "—"}</dd>
                </div>
                {detail.item.powerWatts !== null && (
                  <div>
                    <dt>Power</dt>
                    <dd>{detail.item.powerWatts} W</dd>
                  </div>
                )}
                <div>
                  <dt>Closed on</dt>
                  <dd>{formatDate(detail.item.closedAt)}</dd>
                </div>
              </dl>
              {detail.item.url && (
                <a
                  className="external-link"
                  href={detail.item.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open website <ExternalLink size={14} />
                </a>
              )}
              {detail.item.notes && <p className="item-notes">{detail.item.notes}</p>}
            </section>

            <section className="detail-section ledger-section">
              <div className="section-heading">
                <h3>Ledger history</h3>
                <span>{detail.entries.length} entries</span>
              </div>
              <div className="ledger-list">
                {detail.entries.map((entry) =>
                  editingEntryId === entry.id && entryDraft ? (
                    <form
                      className="ledger-edit-form"
                      key={entry.id}
                      onSubmit={(event) => saveEntry(event, entry)}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="form-grid two">
                        <label className="field">
                          <span>Amount</span>
                          <input
                            type="number"
                            step="0.01"
                            required
                            value={entryDraft.amount}
                            onChange={(event) =>
                              setEntryDraft((current) =>
                                current ? { ...current, amount: event.target.value } : current,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Entry date</span>
                          <input
                            type="date"
                            required
                            value={entryDraft.periodStart}
                            onChange={(event) =>
                              setEntryDraft((current) =>
                                current
                                  ? { ...current, periodStart: event.target.value }
                                  : current,
                              )
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Entry type</span>
                          <select
                            value={entryDraft.periodKind}
                            onChange={(event) =>
                              setEntryDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      periodKind: event.target.value as PeriodKind,
                                    }
                                  : current,
                              )
                            }
                          >
                            <option value="month">Monthly</option>
                            <option value="year">Annual total</option>
                            <option value="one_time">One-time</option>
                            <option value="adjustment">Reconciliation</option>
                          </select>
                        </label>
                        <label className="field">
                          <span>Membership</span>
                          <input
                            maxLength={120}
                            value={entryDraft.membership}
                            onChange={(event) =>
                              setEntryDraft((current) =>
                                current
                                  ? { ...current, membership: event.target.value }
                                  : current,
                              )
                            }
                          />
                        </label>
                        <label className="field full">
                          <span>Note</span>
                          <textarea
                            rows={2}
                            maxLength={500}
                            value={entryDraft.note}
                            onChange={(event) =>
                              setEntryDraft((current) =>
                                current ? { ...current, note: event.target.value } : current,
                              )
                            }
                          />
                        </label>
                      </div>
                      <div className="entry-form-actions">
                        <button
                          type="button"
                          className="text-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            cancelEntryEdit();
                          }}
                        >
                          Cancel
                        </button>
                        <button className="button primary small" disabled={submitting}>
                          {submitting ? "Saving…" : "Save changes"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="ledger-row" key={entry.id}>
                      <div>
                        <strong>
                          {formatDate(entry.periodStart, {
                            month: "short",
                            year: "numeric",
                          })}
                        </strong>
                        <span>
                          {formatPeriodKind(entry.periodKind)}
                          {entry.sourceRef ? ` · ${entry.sourceRef}` : ""}
                        </span>
                        {entry.membership && <small>Membership: {entry.membership}</small>}
                        {entry.note && <small>{entry.note}</small>}
                      </div>
                      <div className="ledger-row-actions">
                        <strong className={entry.amount < 0 ? "negative" : ""}>
                          {formatMoney(entry.amount)}
                        </strong>
                        <button
                          className="text-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            beginEntryEdit(entry);
                          }}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                      </div>
                    </div>
                  ),
                )}
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
