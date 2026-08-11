import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Filter,
  Pencil,
  Search,
  SlidersHorizontal,
  WalletCards,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  filterAndSortCosts,
  type CostFilters,
  type CostSort,
  type CostSortKey,
} from "../lib/costs";
import { formatBillingType, formatDate, formatMoney } from "../lib/format";
import type { CostItemSummary } from "../types";
import { ItemDrawer } from "./ItemDrawer";

const emptyFilters: CostFilters = {
  search: "",
  name: "",
  category: "",
  billingType: "",
  membership: "",
  status: "",
  latestFrom: "",
  latestTo: "",
  spendMin: "",
  spendMax: "",
};

function SortHeader({
  label,
  column,
  sort,
  onSort,
  numeric = false,
}: {
  label: string;
  column: CostSortKey;
  sort: CostSort;
  onSort: (column: CostSortKey) => void;
  numeric?: boolean;
}) {
  const active = sort.key === column;
  return (
    <th
      className={numeric ? "numeric" : undefined}
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button className={`sort-header ${active ? "active" : ""}`} onClick={() => onSort(column)}>
        {label}
        {active ? (
          sort.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />
        ) : (
          <span className="sort-placeholder" aria-hidden="true" />
        )}
      </button>
    </th>
  );
}

function MembershipEditor({
  item,
  editing,
  draft,
  saving,
  onBegin,
  onDraft,
  onSave,
  onCancel,
}: {
  item: CostItemSummary;
  editing: boolean;
  draft: string;
  saving: boolean;
  onBegin: (item: CostItemSummary) => void;
  onDraft: (value: string) => void;
  onSave: (item: CostItemSummary, value: string) => void;
  onCancel: () => void;
}) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  if (editing) {
    return (
      <form
        className="membership-editor editing"
        onClick={stop}
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          event.stopPropagation();
          onSave(item, draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          maxLength={120}
          required
          autoFocus
          aria-label={`Membership for ${item.name}`}
        />
        <button className="membership-action save" disabled={saving} aria-label="Save membership">
          <Check size={13} />
        </button>
        <button
          type="button"
          className="membership-action"
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
          aria-label="Cancel membership edit"
        >
          <X size={13} />
        </button>
      </form>
    );
  }

  return (
    <div className="membership-editor" onClick={stop}>
      <span>{item.currentMembership || "—"}</span>
      {item.latestEntryId ? (
        <button
          className="membership-action"
          onClick={(event) => {
            event.stopPropagation();
            onBegin(item);
          }}
          aria-label={`Edit membership for ${item.name}`}
        >
          <Pencil size={12} />
        </button>
      ) : (
        <small>Add an entry first</small>
      )}
    </div>
  );
}

export function CostsPage({ onChanged }: { onChanged: (message: string) => void }) {
  const [items, setItems] = useState<CostItemSummary[]>([]);
  const [filters, setFilters] = useState<CostFilters>(emptyFilters);
  const [sort, setSort] = useState<CostSort>({ key: "name", direction: "asc" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingMembershipId, setEditingMembershipId] = useState<number | null>(null);
  const [membershipDraft, setMembershipDraft] = useState("");
  const [savingMembershipId, setSavingMembershipId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoading(true);
    api
      .getItems()
      .then(({ items: responseItems }) => {
        setItems(responseItems);
        setError(null);
      })
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [reloadKey]);

  const visibleItems = useMemo(
    () => filterAndSortCosts(items, filters, sort),
    [filters, items, sort],
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasFilters = activeFilterCount > 0;

  const setFilter = (key: keyof CostFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: CostSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const beginMembershipEdit = (item: CostItemSummary) => {
    setEditingMembershipId(item.id);
    setMembershipDraft(item.currentMembership || "");
    setError(null);
  };

  const saveMembership = async (item: CostItemSummary, membership: string) => {
    if (!item.latestEntryId) return;
    setSavingMembershipId(item.id);
    setError(null);
    try {
      await api.updateEntry(item.id, item.latestEntryId, { membership });
      setItems((current) =>
        current.map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, currentMembership: membership.trim() || null }
            : candidate,
        ),
      );
      setEditingMembershipId(null);
      setMembershipDraft("");
      setReloadKey((value) => value + 1);
      onChanged("Membership updated on the latest ledger entry.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Membership could not be updated.");
    } finally {
      setSavingMembershipId(null);
    }
  };

  const membershipEditor = (item: CostItemSummary) => (
    <MembershipEditor
      item={item}
      editing={editingMembershipId === item.id}
      draft={membershipDraft}
      saving={savingMembershipId === item.id}
      onBegin={beginMembershipEdit}
      onDraft={setMembershipDraft}
      onSave={saveMembership}
      onCancel={() => {
        setEditingMembershipId(null);
        setMembershipDraft("");
      }}
    />
  );

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Cost portfolio</span>
          <h1>Every commitment, one ledger.</h1>
          <p>
            Sort every column, combine precise filters, update the latest membership, or open a
            cost to edit its full ledger history.
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
              placeholder="Search costs, memberships, or accounts"
              aria-label="Search all cost columns"
            />
          </label>
          <div className="filter-group">
            <Filter size={17} />
            <select
              value={filters.category}
              onChange={(event) => setFilter("category", event.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              <option>Platform</option>
              <option>Certificate</option>
              <option>Device</option>
              <option>Other</option>
            </select>
            <select
              value={filters.status}
              onChange={(event) => setFilter("status", event.target.value)}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </div>

        <details className="column-filters" open={activeFilterCount > 3 || undefined}>
          <summary>
            <span><SlidersHorizontal size={15} /> Column filters</span>
            {activeFilterCount > 0 && <strong>{activeFilterCount} active</strong>}
          </summary>
          <div className="cost-filter-grid">
            <label className="field">
              <span>Cost</span>
              <input
                value={filters.name}
                onChange={(event) => setFilter("name", event.target.value)}
                placeholder="Name contains…"
              />
            </label>
            <label className="field">
              <span>Category</span>
              <select
                value={filters.category}
                onChange={(event) => setFilter("category", event.target.value)}
              >
                <option value="">All</option>
                <option>Platform</option>
                <option>Certificate</option>
                <option>Device</option>
                <option>Other</option>
              </select>
            </label>
            <label className="field">
              <span>Billing</span>
              <select
                value={filters.billingType}
                onChange={(event) => setFilter("billingType", event.target.value)}
              >
                <option value="">All</option>
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
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <fieldset className="filter-range">
              <legend>Latest entry</legend>
              <input
                type="date"
                value={filters.latestFrom}
                onChange={(event) => setFilter("latestFrom", event.target.value)}
                aria-label="Latest entry from"
              />
              <span>to</span>
              <input
                type="date"
                value={filters.latestTo}
                onChange={(event) => setFilter("latestTo", event.target.value)}
                aria-label="Latest entry to"
              />
            </fieldset>
            <fieldset className="filter-range">
              <legend>Lifetime spend</legend>
              <input
                type="number"
                step="0.01"
                value={filters.spendMin}
                onChange={(event) => setFilter("spendMin", event.target.value)}
                placeholder="Min"
                aria-label="Minimum lifetime spend"
              />
              <span>to</span>
              <input
                type="number"
                step="0.01"
                value={filters.spendMax}
                onChange={(event) => setFilter("spendMax", event.target.value)}
                placeholder="Max"
                aria-label="Maximum lifetime spend"
              />
            </fieldset>
          </div>
        </details>

        <div className="result-meta">
          <span>
            {loading
              ? "Updating…"
              : `${visibleItems.length} of ${items.length} cost${items.length === 1 ? "" : "s"}`}
          </span>
          {hasFilters && (
            <button onClick={() => setFilters(emptyFilters)}>Clear all filters</button>
          )}
        </div>

        {error ? (
          <div className="page-state error">{error}</div>
        ) : visibleItems.length === 0 && !loading ? (
          <div className="empty-state">
            <WalletCards size={28} />
            <strong>No costs match these filters.</strong>
            <span>Try a different value or clear the filters.</span>
          </div>
        ) : (
          <>
            <div className="mobile-cost-list" aria-label="Costs">
              {visibleItems.map((item) => (
                <article className="mobile-cost-card" key={item.id}>
                  <button className="mobile-cost-open" onClick={() => setSelectedId(item.id)}>
                    <span className="mobile-cost-main">
                      <strong>{item.name}</strong>
                      <small>{item.currentMembership || `${item.entryCount} ledger entries`}</small>
                    </span>
                    <strong className="mobile-cost-amount">{formatMoney(item.lifetimeSpend)}</strong>
                    <span className="mobile-cost-meta">
                      <span className={`category-pill category-${item.category.toLowerCase()}`}>
                        {item.category}
                      </span>
                      <span className={`status-pill ${item.status}`}>{item.status}</span>
                      <span>{formatBillingType(item.billingType)}</span>
                      <span>{formatDate(item.latestPeriod, { month: "short", year: "numeric" })}</span>
                    </span>
                    <ChevronRight className="mobile-cost-chevron" size={18} aria-hidden="true" />
                  </button>
                  <div className="mobile-membership-edit">{membershipEditor(item)}</div>
                </article>
              ))}
            </div>
            <div className="table-scroll desktop-cost-table">
              <table className="cost-table">
                <thead>
                  <tr>
                    <SortHeader label="Cost" column="name" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Category" column="category" sort={sort} onSort={toggleSort} />
                    <SortHeader label="Billing" column="billingType" sort={sort} onSort={toggleSort} />
                    <SortHeader
                      label="Membership"
                      column="currentMembership"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortHeader label="Status" column="status" sort={sort} onSort={toggleSort} />
                    <SortHeader
                      label="Latest entry"
                      column="latestPeriod"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortHeader
                      label="Lifetime spend"
                      column="lifetimeSpend"
                      sort={sort}
                      onSort={toggleSort}
                      numeric
                    />
                    <th aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      tabIndex={0}
                      onKeyDown={(event) => event.key === "Enter" && setSelectedId(item.id)}
                    >
                      <td>
                        <strong>{item.name}</strong>
                        <span>{item.entryCount} ledger {item.entryCount === 1 ? "entry" : "entries"}</span>
                      </td>
                      <td>
                        <span className={`category-pill category-${item.category.toLowerCase()}`}>
                          {item.category}
                        </span>
                      </td>
                      <td>{formatBillingType(item.billingType)}</td>
                      <td>{membershipEditor(item)}</td>
                      <td><span className={`status-pill ${item.status}`}>{item.status}</span></td>
                      <td>{formatDate(item.latestPeriod, { month: "short", year: "numeric" })}</td>
                      <td className="numeric"><strong>{formatMoney(item.lifetimeSpend)}</strong></td>
                      <td><ChevronRight size={17} /></td>
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

