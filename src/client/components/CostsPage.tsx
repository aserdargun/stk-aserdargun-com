import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Filter,
  Pencil,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  emptyCostFilters,
  filterAndSortCosts,
  type CostFilters,
  type CostSort,
  type CostSortKey,
} from "../lib/costs";
import { formatBillingType, formatDate, formatMoney } from "../lib/format";
import type { CostItemSummary } from "../types";
import { ItemDrawer } from "./ItemDrawer";

const sortColumns: Array<{ key: CostSortKey; label: string; numeric?: boolean }> = [
  { key: "name", label: "Cost" },
  { key: "category", label: "Category" },
  { key: "billingType", label: "Billing" },
  { key: "currentMembership", label: "Membership" },
  { key: "status", label: "Status" },
  { key: "latestPeriod", label: "Latest entry" },
  { key: "lifetimeSpend", label: "Lifetime spend", numeric: true },
];

export function CostsPage({
  onChanged,
  refreshKey = 0,
}: {
  onChanged: (message: string) => void;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<CostItemSummary[]>([]);
  const [filters, setFilters] = useState<CostFilters>(() => ({ ...emptyCostFilters }));
  const [sort, setSort] = useState<CostSort | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingMembershipId, setEditingMembershipId] = useState<number | null>(null);
  const [membershipDraft, setMembershipDraft] = useState("");
  const [savingMembershipId, setSavingMembershipId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .getItems()
      .then(({ items: responseItems }) => {
        if (!active) return;
        setItems(responseItems);
        setLoadError(null);
      })
      .catch((reason: Error) => active && setLoadError(reason.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [refreshKey, reloadKey]);

  const visibleItems = useMemo(
    () => filterAndSortCosts(items, filters, sort),
    [filters, items, sort],
  );
  const hasFilters = Object.values(filters).some(Boolean);

  const setFilter = (key: keyof CostFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: CostSortKey) => {
    setSort((current) =>
      current?.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" },
    );
  };

  const beginMembershipEdit = (
    event: React.SyntheticEvent,
    item: CostItemSummary,
  ) => {
    event.stopPropagation();
    setEditingMembershipId(item.id);
    setMembershipDraft(item.currentMembership || "");
    setActionError(null);
  };

  const cancelMembershipEdit = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    setEditingMembershipId(null);
    setMembershipDraft("");
  };

  const saveMembership = async (
    event: FormEvent<HTMLFormElement>,
    item: CostItemSummary,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (item.latestEntryId === null) return;
    setSavingMembershipId(item.id);
    setActionError(null);
    try {
      const detail = await api.getItem(item.id);
      const latestEntry = detail.entries.find(
        (entry) => entry.id === item.latestEntryId,
      );
      if (!latestEntry) {
        throw new Error("The latest ledger entry is no longer available. Reload and try again.");
      }
      await api.updateEntry(item.id, latestEntry.id, {
        amount: latestEntry.amount,
        currency: latestEntry.currency,
        periodStart: latestEntry.periodStart,
        periodKind: latestEntry.periodKind,
        membership: membershipDraft,
        note: latestEntry.note,
      });
      setEditingMembershipId(null);
      setMembershipDraft("");
      setReloadKey((value) => value + 1);
      onChanged("Membership updated on the latest ledger entry.");
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : "Membership could not be updated.",
      );
    } finally {
      setSavingMembershipId(null);
    }
  };

  const membershipControl = (item: CostItemSummary, mobile = false) => {
    if (editingMembershipId === item.id) {
      return (
        <form
          className={`membership-editor${mobile ? " mobile" : ""}`}
          onSubmit={(event) => saveMembership(event, item)}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            value={membershipDraft}
            onChange={(event) => setMembershipDraft(event.target.value)}
            maxLength={120}
            aria-label={`Membership for ${item.name}`}
            autoFocus
          />
          <button
            type="submit"
            className="membership-icon-button save"
            aria-label="Save membership"
            disabled={savingMembershipId === item.id}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            className="membership-icon-button"
            aria-label="Cancel membership edit"
            onClick={cancelMembershipEdit}
          >
            <X size={14} />
          </button>
        </form>
      );
    }

    if (item.latestEntryId === null) {
      return (
        <div className={`membership-cell${mobile ? " mobile" : ""}`}>
          <span>{item.currentMembership || "—"}</span>
          <small className="no-entry-hint">Add an entry first</small>
        </div>
      );
    }

    return (
      <div className={`membership-cell${mobile ? " mobile" : ""}`}>
        <span>{item.currentMembership || "—"}</span>
        <button
          type="button"
          className="text-button"
          onClick={(event) => beginMembershipEdit(event, item)}
        >
          <Pencil size={12} /> Edit
        </button>
      </div>
    );
  };

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Cost portfolio</span>
          <h1>Every commitment, one ledger.</h1>
          <p>
            Search your stack, inspect its history, record new entries, or close costs you no longer carry.
          </p>
        </div>
      </section>

      <section className="panel costs-panel">
        <div className="cost-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              value={filters.search}
              onChange={(event) => setFilter("search", event.target.value)}
              placeholder="Search all cost data"
              aria-label="Search all cost data"
            />
          </label>
          <button
            className={`button secondary filter-toggle${filtersOpen ? " active" : ""}`}
            onClick={() => setFiltersOpen((value) => !value)}
            aria-expanded={filtersOpen}
            aria-controls="cost-column-filters"
          >
            <Filter size={17} /> Column filters
            <ChevronDown size={15} className={filtersOpen ? "open" : ""} />
          </button>
        </div>

        {filtersOpen && (
          <div className="column-filters" id="cost-column-filters">
            <label className="field">
              <span>Cost</span>
              <input
                value={filters.cost}
                onChange={(event) => setFilter("cost", event.target.value)}
                placeholder="Name contains…"
              />
            </label>
            <label className="field">
              <span>Category</span>
              <select
                value={filters.category}
                onChange={(event) => setFilter("category", event.target.value)}
              >
                <option value="">All categories</option>
                <option>Platform</option>
                <option>Certificate</option>
                <option>Device</option>
                <option>Other</option>
              </select>
            </label>
            <label className="field">
              <span>Billing</span>
              <select
                value={filters.billing}
                onChange={(event) => setFilter("billing", event.target.value)}
              >
                <option value="">All billing types</option>
                <option value="recurring">Recurring</option>
                <option value="annual">Annual</option>
                <option value="one_time">One-time</option>
              </select>
            </label>
            <label className="field">
              <span>Membership</span>
              <input
                value={filters.membership}
                onChange={(event) => setFilter("membership", event.target.value)}
                placeholder="Membership contains…"
              />
            </label>
            <label className="field">
              <span>Status</span>
              <select
                value={filters.status}
                onChange={(event) => setFilter("status", event.target.value)}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <fieldset className="range-filter">
              <legend>Latest entry</legend>
              <label>
                <span>From</span>
                <input
                  type="date"
                  value={filters.latestFrom}
                  onChange={(event) => setFilter("latestFrom", event.target.value)}
                />
              </label>
              <label>
                <span>To</span>
                <input
                  type="date"
                  value={filters.latestTo}
                  onChange={(event) => setFilter("latestTo", event.target.value)}
                />
              </label>
            </fieldset>
            <fieldset className="range-filter">
              <legend>Lifetime spend</legend>
              <label>
                <span>Minimum</span>
                <input
                  type="number"
                  step="0.01"
                  value={filters.lifetimeMin}
                  onChange={(event) => setFilter("lifetimeMin", event.target.value)}
                  placeholder="₺0"
                />
              </label>
              <label>
                <span>Maximum</span>
                <input
                  type="number"
                  step="0.01"
                  value={filters.lifetimeMax}
                  onChange={(event) => setFilter("lifetimeMax", event.target.value)}
                  placeholder="No limit"
                />
              </label>
            </fieldset>
          </div>
        )}

        <div className="result-meta">
          <span>
            {loading
              ? "Updating…"
              : `${visibleItems.length} of ${items.length} cost${items.length === 1 ? "" : "s"}`}
          </span>
          {hasFilters && (
            <button onClick={() => setFilters({ ...emptyCostFilters })}>
              Clear all filters
            </button>
          )}
        </div>

        {actionError && <div className="table-action-error">{actionError}</div>}

        {loadError ? (
          <div className="page-state error">{loadError}</div>
        ) : visibleItems.length === 0 && !loading ? (
          <div className="empty-state">
            <WalletCards size={28} />
            <strong>No costs match these filters.</strong>
            <span>Try a different search or clear the filters.</span>
          </div>
        ) : (
          <>
            <div className="mobile-cost-list" aria-label="Costs">
              {visibleItems.map((item) => (
                <article className="mobile-cost-card" key={item.id}>
                  <button
                    type="button"
                    className="mobile-cost-open"
                    onClick={() => setSelectedId(item.id)}
                    aria-label={`Open ${item.name} details`}
                  />
                  <span className="mobile-cost-main">
                    <strong>{item.name}</strong>
                    <small>
                      {item.currentMembership ||
                        `${item.entryCount} ledger ${item.entryCount === 1 ? "entry" : "entries"}`}
                    </small>
                  </span>
                  <strong className="mobile-cost-amount">
                    {formatMoney(item.lifetimeSpend)}
                  </strong>
                  <span className="mobile-cost-meta">
                    <span className={`category-pill category-${item.category.toLowerCase()}`}>
                      {item.category}
                    </span>
                    <span className={`status-pill ${item.status}`}>{item.status}</span>
                    <span>{formatBillingType(item.billingType)}</span>
                    <span>
                      {formatDate(item.latestPeriod, { month: "short", year: "numeric" })}
                    </span>
                  </span>
                  <div className="mobile-membership-control">
                    {membershipControl(item, true)}
                  </div>
                  <ChevronRight
                    className="mobile-cost-chevron"
                    size={18}
                    aria-hidden="true"
                  />
                </article>
              ))}
            </div>
            <div className="table-scroll desktop-cost-table">
              <table className="cost-table">
                <thead>
                  <tr>
                    {sortColumns.map((column) => {
                      const activeSort = sort?.key === column.key ? sort.direction : null;
                      return (
                        <th
                          key={column.key}
                          className={column.numeric ? "numeric" : undefined}
                          aria-sort={
                            activeSort === "asc"
                              ? "ascending"
                              : activeSort === "desc"
                                ? "descending"
                                : "none"
                          }
                        >
                          <button
                            className="sort-button"
                            onClick={() => toggleSort(column.key)}
                          >
                            {column.label}
                            {activeSort === "asc" ? (
                              <ArrowUp size={13} />
                            ) : activeSort === "desc" ? (
                              <ArrowDown size={13} />
                            ) : (
                              <ChevronsUpDown size={13} />
                            )}
                          </button>
                        </th>
                      );
                    })}
                    <th aria-label="Open cost details" />
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.name}</strong>
                        <span>
                          {item.entryCount} ledger {item.entryCount === 1 ? "entry" : "entries"}
                        </span>
                      </td>
                      <td>
                        <span className={`category-pill category-${item.category.toLowerCase()}`}>
                          {item.category}
                        </span>
                      </td>
                      <td>{formatBillingType(item.billingType)}</td>
                      <td>{membershipControl(item)}</td>
                      <td>
                        <span className={`status-pill ${item.status}`}>{item.status}</span>
                      </td>
                      <td>
                        {formatDate(item.latestPeriod, { month: "short", year: "numeric" })}
                      </td>
                      <td className="numeric">
                        <strong>{formatMoney(item.lifetimeSpend)}</strong>
                      </td>
                      <td className="table-detail-cell">
                        <button
                          type="button"
                          className="table-detail-button"
                          onClick={() => setSelectedId(item.id)}
                          aria-label={`Open ${item.name} details`}
                        >
                          <ChevronRight size={17} aria-hidden="true" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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
