import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  Archive,
  ArrowRightLeft,
  Check,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { buildItemMonthlySeries } from "../lib/costs";
import {
  formatBillingType,
  formatDate,
  formatMembership,
  formatMoney,
  formatPeriodDate,
  formatPeriodKind,
  formatServiceName,
  normalizeMembership,
} from "../lib/format";
import type { CostEntry, CostItemSummary, ItemDetail, PeriodKind } from "../types";

const ItemMonthlyChart = lazy(() =>
  import("./ItemMonthlyChart").then((module) => ({ default: module.ItemMonthlyChart })),
);

const today = new Date().toISOString().slice(0, 10);

type EntryDraft = {
  amount: string;
  periodStart: string;
  periodKind: PeriodKind;
  membership: string;
  note: string;
};

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
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [chartYear, setChartYear] = useState<number>();
  const [error, setError] = useState<string | null>(null);
  const [showMovePanel, setShowMovePanel] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState<number | null>(null);
  const [moveQuery, setMoveQuery] = useState("");
  const [moveCandidates, setMoveCandidates] = useState<CostItemSummary[] | null>(null);
  const [moveCandidatesLoading, setMoveCandidatesLoading] = useState(false);
  const [moveConfirming, setMoveConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getItem(id));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The cost could not be loaded.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!showMovePanel) {
      setMoveQuery("");
      setMoveTargetId(null);
      setMoveCandidates(null);
      setMoveCandidatesLoading(false);
      setMoveConfirming(false);
    }
  }, [showMovePanel]);

  const openMovePanel = async () => {
    setShowMovePanel(true);
    setError(null);
    if (moveCandidates) return;
    setMoveCandidatesLoading(true);
    try {
      const { items } = await api.getItems();
      setMoveCandidates(
        items
          .filter((candidate) => candidate.id !== id)
          .sort((a, b) => Number(a.status === "closed") - Number(b.status === "closed") || a.name.localeCompare(b.name)),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Other costs could not be loaded.");
      setShowMovePanel(false);
    } finally {
      setMoveCandidatesLoading(false);
    }
  };

  const moveEntryCount = detail?.entries.length ?? 0;
  const canMove = Boolean(detail && detail.item.status === "active" && moveEntryCount > 0);
  const filteredMoveCandidates = useMemo(() => {
    if (!moveCandidates) return [];
    const needle = moveQuery.trim().toLowerCase();
    if (!needle) return moveCandidates;
    return moveCandidates.filter((candidate) =>
      [candidate.name, candidate.currentMembership, candidate.category, candidate.account]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [moveCandidates, moveQuery]);
  const selectedTarget = moveCandidates?.find((candidate) => candidate.id === moveTargetId) ?? null;

  const confirmMove = async () => {
    if (!moveTargetId) return;
    setMoveConfirming(true);
    setError(null);
    try {
      const response = await api.mergeItem(id, moveTargetId);
      const targetName = selectedTarget ? formatServiceName(selectedTarget.name) : "the target cost";
      const sourceName = detail ? formatServiceName(detail.item.name) : "this cost";
      onChanged(
        response.moved > 0
          ? `Moved ${response.moved} ${response.moved === 1 ? "entry" : "entries"} from ${sourceName} to ${targetName}; source closed.`
          : `Closed ${sourceName} with no entries; nothing was moved to ${targetName}.`,
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The ledger could not be moved.");
      setMoveConfirming(false);
    }
  };

  const lifetimeSpend = useMemo(
    () => detail?.entries.reduce((total, entry) => total + entry.amount, 0) || 0,
    [detail],
  );
  const chartData = useMemo(
    () => buildItemMonthlySeries(detail?.entries || [], chartYear),
    [chartYear, detail?.entries],
  );
  const chartYears = chartData.availableYears.length ? chartData.availableYears : [chartData.year];
  const currentMembership =
    normalizeMembership(detail?.entries[0]?.membership) || normalizeMembership(detail?.item.plan);

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
    setError(null);
  };

  const cancelEntryEdit = () => {
    setEditingEntryId(null);
    setEntryDraft(null);
  };

  const saveEditedEntry = async (event: FormEvent<HTMLFormElement>, entryId: number) => {
    event.preventDefault();
    if (!entryDraft) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await api.updateEntry(id, entryId, {
        amount: Number(entryDraft.amount),
        currency: "TRY",
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
          <div className="page-state">Loading cost history…</div>
        ) : (
          <div className="drawer-content">
            <div className="drawer-title">
              <span className={`category-pill category-${detail.item.category.toLowerCase()}`}>
                {detail.item.category}
              </span>
              <h2>{formatServiceName(detail.item.name)}</h2>
              <div className="drawer-subtitle">
                <span>{
                  currentMembership
                    ? formatMembership(currentMembership)
                    : formatBillingType(detail.item.billingType)
                }</span>
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
              <button
                className="button secondary"
                onClick={() => (showMovePanel ? setShowMovePanel(false) : void openMovePanel())}
                disabled={submitting || !canMove}
                title={
                  detail.item.status !== "active"
                    ? "Closed costs cannot move their ledger"
                    : moveEntryCount === 0
                      ? "This cost has no entries to move"
                      : undefined
                }
              >
                <ArrowRightLeft size={17} /> Move ledger…
              </button>
            </div>

            {showMovePanel && (
              <section className="move-panel" aria-label="Move ledger to another cost">
                <div className="move-panel-header">
                  <strong>Move {moveEntryCount} {moveEntryCount === 1 ? "entry" : "entries"} to…</strong>
                  <span>
                    The source cost closes after the move. Target must be an active cost.
                  </span>
                </div>
                <label className="search-field move-panel-search">
                  <Search size={18} />
                  <input
                    value={moveQuery}
                    onChange={(event) => setMoveQuery(event.target.value)}
                    placeholder="Search by name, plan, category, or account"
                    aria-label="Filter target cost list"
                  />
                </label>
                {moveCandidatesLoading ? (
                  <div className="page-state">Loading costs…</div>
                ) : filteredMoveCandidates.length === 0 ? (
                  <div className="empty-state move-panel-empty">
                    <span>No other cost matches “{moveQuery}”.</span>
                  </div>
                ) : (
                  <ul className="move-panel-list" role="listbox" aria-label="Target cost">
                    {filteredMoveCandidates.map((candidate) => {
                      const selected = candidate.id === moveTargetId;
                      const disabled = candidate.status !== "active";
                      return (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            className={`move-panel-item${selected ? " selected" : ""}`}
                            onClick={() => !disabled && setMoveTargetId(candidate.id)}
                            disabled={disabled}
                            aria-selected={selected}
                            role="option"
                            title={
                              disabled
                                ? "Reactivate this cost before moving entries into it"
                                : undefined
                            }
                          >
                            <span className="move-panel-item-main">
                              <strong>{formatServiceName(candidate.name)}</strong>
                              <small>
                                {candidate.category} · {formatBillingType(candidate.billingType)}
                                {candidate.currentMembership
                                  ? ` · ${formatMembership(candidate.currentMembership)}`
                                  : ""}
                              </small>
                            </span>
                            <span className={`status-pill ${candidate.status}`}>
                              {candidate.status}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <div className="entry-form-actions move-panel-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowMovePanel(false)}
                    disabled={moveConfirming}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button primary small"
                    onClick={() => void confirmMove()}
                    disabled={
                      moveConfirming ||
                      !moveTargetId ||
                      !canMove ||
                      selectedTarget?.status !== "active"
                    }
                  >
                    {moveConfirming
                      ? "Moving…"
                      : selectedTarget
                        ? `Move to ${formatServiceName(selectedTarget.name)}`
                        : "Choose a target cost"}
                  </button>
                </div>
              </section>
            )}

            {showEntryForm && (
              <form className="entry-form" onSubmit={addEntry}>
                <div className="form-grid two">
                  <label className="field">
                    <span>Amount</span>
                    <div className="money-input"><span>₺</span><input name="amount" type="number" step="0.01" required /></div>
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
                      placeholder="Professional"
                    />
                  </label>
                  <label className="field full">
                    <span>Note</span>
                    <input name="note" maxLength={500} placeholder="Optional context" />
                  </label>
                </div>
                <div className="entry-form-actions">
                  <button type="button" className="text-button" onClick={() => setShowEntryForm(false)}>
                    Cancel
                  </button>
                  <button className="button primary small" disabled={submitting}>
                    {submitting ? "Saving…" : "Save entry"}
                  </button>
                </div>
              </form>
            )}

            {error && <div className="form-error">{error}</div>}

            <section className="detail-section detail-chart-section">
              <div className="section-heading detail-chart-heading">
                <div>
                  <span>Monthly distribution</span>
                  <h3>{chartData.year} cost pulse</h3>
                </div>
                <label>
                  <span>Year</span>
                  <select
                    value={chartData.year}
                    onChange={(event) => setChartYear(Number(event.target.value))}
                  >
                    {chartYears.map((year) => (
                      <option value={year} key={year}>{year}</option>
                    ))}
                  </select>
                </label>
              </div>
              <Suspense fallback={<div className="detail-chart-loading">Loading chart…</div>}>
                <ItemMonthlyChart data={chartData.series} />
              </Suspense>
            </section>

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
              <div className="section-heading">
                <h3>Ledger history</h3>
                <span>{detail.entries.length} {detail.entries.length === 1 ? "entry" : "entries"}</span>
              </div>
              <div className="ledger-list">
                {detail.entries.map((entry) =>
                  editingEntryId === entry.id && entryDraft ? (
                    <form
                      className="ledger-row ledger-edit-form"
                      key={entry.id}
                      onSubmit={(event) => saveEditedEntry(event, entry.id)}
                    >
                      <div className="form-grid two">
                        <label className="field">
                          <span>Amount</span>
                          <div className="money-input">
                            <span>₺</span>
                            <input
                              type="number"
                              step="0.01"
                              required
                              value={entryDraft.amount}
                              onChange={(event) =>
                                setEntryDraft((draft) => draft && { ...draft, amount: event.target.value })
                              }
                            />
                          </div>
                        </label>
                        <label className="field">
                          <span>Entry date</span>
                          <input
                            type="date"
                            required
                            value={entryDraft.periodStart}
                            onChange={(event) =>
                              setEntryDraft((draft) => draft && { ...draft, periodStart: event.target.value })
                            }
                          />
                        </label>
                        <label className="field">
                          <span>Entry type</span>
                          <select
                            value={entryDraft.periodKind}
                            onChange={(event) =>
                              setEntryDraft((draft) =>
                                draft && { ...draft, periodKind: event.target.value as PeriodKind },
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
                              setEntryDraft((draft) => draft && { ...draft, membership: event.target.value })
                            }
                          />
                        </label>
                        <label className="field full">
                          <span>Note</span>
                          <input
                            maxLength={500}
                            value={entryDraft.note}
                            onChange={(event) =>
                              setEntryDraft((draft) => draft && { ...draft, note: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <div className="ledger-edit-actions">
                        <button type="button" className="text-button" onClick={cancelEntryEdit}>Cancel</button>
                        <button className="button primary small" disabled={submitting}>
                          <Check size={15} /> {submitting ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="ledger-row" key={entry.id}>
                      <div className="ledger-row-main">
                        <strong>{formatPeriodDate(entry.periodStart, entry.periodKind)}</strong>
                        <span>
                          {formatPeriodKind(entry.periodKind)}
                          {entry.sourceRef ? ` · ${entry.sourceRef}` : ""}
                        </span>
                        <span className="ledger-membership">
                          Membership: {formatMembership(entry.membership || detail.item.plan)}
                        </span>
                        {entry.note && <small>{entry.note}</small>}
                      </div>
                      <div className="ledger-row-side">
                        <strong className={entry.amount < 0 ? "negative" : ""}>{formatMoney(entry.amount)}</strong>
                        <button className="text-button" onClick={() => beginEntryEdit(entry)}>
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
