import { useState, type FormEvent } from "react";
import { CircleDollarSign, X } from "lucide-react";
import { api } from "../lib/api";
import type { BillingType, Category, ItemStatus } from "../types";

const today = new Date().toISOString().slice(0, 10);

export function AddCostModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("Platform");
  const [billingType, setBillingType] = useState<BillingType>("recurring");
  const [periodKind, setPeriodKind] = useState<"month" | "year" | "one_time">("month");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const membership = String(form.get("membership") || "");
    try {
      await api.createItem({
        name: String(form.get("name")),
        category,
        billingType,
        plan: membership,
        url: String(form.get("url") || ""),
        account: String(form.get("account") || ""),
        powerWatts: form.get("powerWatts") ? Number(form.get("powerWatts")) : null,
        status: String(form.get("status")) as ItemStatus,
        notes: String(form.get("notes") || ""),
        initialEntry: {
          amount,
          currency: "TRY",
          periodStart: String(form.get("periodStart")),
          periodKind: String(form.get("periodKind")) as "month" | "year" | "one_time",
          membership,
          note: String(form.get("entryNote") || ""),
        },
      });
      onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The cost could not be added.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="add-cost-title">
        <div className="modal-header">
          <div>
            <span className="modal-icon"><CircleDollarSign size={20} /></span>
            <div>
              <span className="eyebrow">Portfolio entry</span>
              <h2 id="add-cost-title">Add a new cost</h2>
            </div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close dialog">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={submit} className="form-stack">
          <div className="form-grid two">
            <label className="field full">
              <span>Name</span>
              <input name="name" required maxLength={140} placeholder="e.g. Figma Professional" />
            </label>
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
                <option>Platform</option>
                <option>Certificate</option>
                <option>Device</option>
                <option>Other</option>
              </select>
            </label>
            <label className="field">
              <span>Billing type</span>
              <select
                value={billingType}
                onChange={(event) => {
                  const nextBillingType = event.target.value as BillingType;
                  setBillingType(nextBillingType);
                  setPeriodKind(
                    nextBillingType === "recurring" ? "month" : nextBillingType === "annual" ? "year" : "one_time",
                  );
                }}
              >
                <option value="recurring">Recurring</option>
                <option value="annual">Annual</option>
                <option value="one_time">One-time</option>
              </select>
            </label>
            <label className="field">
              <span>Membership</span>
              <input name="membership" maxLength={120} placeholder="Professional" />
            </label>
            <label className="field">
              <span>Status</span>
              <select name="status" defaultValue="active">
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label className="field">
              <span>Amount</span>
              <div className="money-input">
                <span>₺</span>
                <input name="amount" type="number" step="0.01" required placeholder="0.00" />
              </div>
            </label>
            <label className="field">
              <span>Entry type</span>
              <select
                name="periodKind"
                value={periodKind}
                onChange={(event) => setPeriodKind(event.target.value as "month" | "year" | "one_time")}
              >
                <option value="month">Monthly</option>
                <option value="year">Annual total</option>
                <option value="one_time">One-time</option>
              </select>
            </label>
            <label className="field">
              <span>Entry date</span>
              <input name="periodStart" type="date" defaultValue={today} required />
            </label>
            {category === "Device" && (
              <label className="field">
                <span>Power draw (W)</span>
                <input name="powerWatts" type="number" min="0" step="1" placeholder="Optional" />
              </label>
            )}
            <label className="field">
              <span>Account</span>
              <input name="account" maxLength={160} placeholder="Optional" autoComplete="off" />
            </label>
            <label className="field full">
              <span>Website</span>
              <input name="url" type="url" placeholder="https://" />
            </label>
            <label className="field full">
              <span>Notes</span>
              <textarea name="notes" rows={3} maxLength={2000} placeholder="Why this cost matters, renewal details, or context." />
            </label>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={submitting}>
              {submitting ? "Adding…" : "Add to portfolio"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
