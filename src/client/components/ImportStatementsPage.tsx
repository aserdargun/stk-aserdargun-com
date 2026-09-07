import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import {
  CheckCircle2,
  ClipboardPaste,
  FileUp,
  Loader2,
  Receipt,
  RotateCcw,
  Save,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import {
  formatBillingType,
  formatDate,
  formatMembership,
  formatMoney,
  formatServiceName,
} from "../lib/format";
import type {
  BillingType,
  Category,
  SlipImportPreview,
  SlipImportResult,
  StatementImportPreview,
  StatementImportResult,
} from "../types";

type Phase = "idle" | "loading" | "preview" | "applying" | "done";
type ImportMode = "statement" | "slip";

type UnmappedStatus = "pending" | "mapped" | "skipped";

interface UnmappedRow {
  key: string;
  date: string;
  amount: number;
  description: string;
  status: UnmappedStatus;
  pattern: string;
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string;
  url: string;
  account: string;
  touched: boolean;
}

interface SlipManualForm {
  name: string;
  category: Category;
  billingType: BillingType;
  plan: string;
  url: string;
  account: string;
  pattern: string;
  touched: boolean;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.slice(result.indexOf(",") + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function inferPdfFileName(file: File, fallback: string): string {
  if (file.name && file.name.toLowerCase().endsWith(".pdf")) return file.name;
  if (file.type === "application/pdf" || file.type === "") {
    return fallback.toLowerCase().endsWith(".pdf") ? fallback : `${fallback}.pdf`;
  }
  return file.name || `${fallback}.pdf`;
}

function inferPattern(description: string): string {
  const tokens = description
    .replace(/\d+/g, " ")
    .split(/[\s/]+/)
    .map((token) => token.replace(/^[^A-Za-zÇĞİÖŞÜçğıöşü*]+|[^A-Za-zÇĞİÖŞÜçğıöşü*]+$/g, ""))
    .filter((token) => token.length >= 3);
  if (tokens.length === 0) {
    return description.trim().toUpperCase().slice(0, 24) || "UNKNOWN";
  }
  return tokens[0].toUpperCase();
}

function fileFromClipboard(
  event: ClipboardEvent<HTMLElement>,
): { file: File; suggestedName: string } | null {
  const items = event.clipboardData?.items;
  if (!items || items.length === 0) return null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    const name = file.name && file.name.length > 0 ? file.name : `pasted-statement-${Date.now()}.pdf`;
    return { file, suggestedName: name };
  }
  return null;
}

function blankRow(candidate: { date: string; amount: number; description: string }, index: number): UnmappedRow {
  const pattern = inferPattern(candidate.description);
  return {
    key: `${candidate.date}-${index}-${candidate.amount}`,
    date: candidate.date,
    amount: candidate.amount,
    description: candidate.description,
    status: "pending",
    pattern,
    name: pattern
      .toLowerCase()
      .split(" ")
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" "),
    category: "Platform",
    billingType: "recurring",
    plan: "",
    url: "",
    account: "",
    touched: false,
  };
}

function blankSlipForm(description: string, suggestedName: string): SlipManualForm {
  const pattern = inferPattern(description || suggestedName);
  return {
    name: pattern
      .toLowerCase()
      .split(" ")
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(" "),
    category: "Platform",
    billingType: "one_time",
    plan: "",
    url: "",
    account: "",
    pattern,
    touched: false,
  };
}

export function ImportStatementsPage({ onImported }: { onImported: (message: string) => void }) {
  const [mode, setMode] = useState<ImportMode>("statement");
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [preview, setPreview] = useState<StatementImportPreview | null>(null);
  const [result, setResult] = useState<StatementImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteArmed, setPasteArmed] = useState(true);
  const [unmapped, setUnmapped] = useState<UnmappedRow[]>([]);
  const [slipPreview, setSlipPreview] = useState<SlipImportPreview | null>(null);
  const [slipResult, setSlipResult] = useState<SlipImportResult | null>(null);
  const [slipForm, setSlipForm] = useState<SlipManualForm | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const fallbackPrefix = mode === "slip" ? "slip" : "statement";
      const inferredName = inferPdfFileName(file, `${fallbackPrefix}-${new Date().toISOString().slice(0, 10)}.pdf`);
      if (!inferredName.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
        setError(mode === "slip"
          ? "Please paste or choose a single-charge slip PDF."
          : "Please paste or choose a PDF credit-card statement.");
        return;
      }
      setError(null);
      setPreview(null);
      setResult(null);
      setSlipPreview(null);
      setSlipResult(null);
      setSlipForm(null);
      setUnmapped([]);
      setFileName(inferredName);
      setPhase("loading");
      try {
        const base64 = await readFileAsBase64(file);
        setData(base64);
        if (mode === "slip") {
          const parsed = await api.previewSlipImport(inferredName, base64);
          setSlipPreview(parsed);
          if (!parsed.matched) {
            setSlipForm(blankSlipForm(parsed.slip.description, parsed.slip.merchant));
          }
        } else {
          const parsed = await api.previewStatementImport(inferredName, base64);
          setPreview(parsed);
          setUnmapped(parsed.unclassified.map((candidate, index) => blankRow(candidate, index)));
        }
        setPhase("preview");
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "The PDF could not be parsed.");
        setPhase("idle");
      }
    },
    [mode],
  );

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const pasted = fileFromClipboard(event);
    if (!pasted) {
      setError(mode === "slip"
        ? "The clipboard does not contain a PDF file. Copy the slip PDF first."
        : "The clipboard does not contain a PDF file. Copy the statement PDF first.");
      return;
    }
    event.preventDefault();
    void handleFile(pasted.file);
  };

  // Listen for a global paste when the user is on the import page but the
  // dropzone does not have keyboard focus (the common mobile flow).
  useEffect(() => {
    if (phase !== "idle") return undefined;
    if (!pasteArmed) return undefined;
    const handler = (event: globalThis.ClipboardEvent) => {
      const pasted = fileFromClipboard(event as unknown as ClipboardEvent<HTMLElement>);
      if (!pasted) return;
      event.preventDefault();
      void handleFile(pasted.file);
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [phase, pasteArmed, handleFile]);

  const apply = async () => {
    if (!fileName || !data) return;
    const manualMappings = unmapped
      .filter((row) => row.status === "mapped" && row.touched)
      .map((row) => ({
        date: row.date,
        amount: row.amount,
        description: row.description,
        name: row.name,
        category: row.category,
        billingType: row.billingType,
        plan: row.plan || null,
        url: row.url || null,
        account: row.account || null,
        pattern: row.pattern || null,
      }));
    setPhase("applying");
    setError(null);
    try {
      const applied = await api.applyStatementImport(fileName, data, manualMappings);
      setResult(applied);
      setPhase("done");
      const learnedNote =
        applied.learnedPatterns && applied.learnedPatterns.length > 0
          ? ` Learned ${applied.learnedPatterns.length} new pattern${
              applied.learnedPatterns.length === 1 ? "" : "s"
            } for next month.`
          : "";
      onImported(
        `Imported ${applied.entriesCreated} ledger entries from the statement.${learnedNote}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import could not be applied.");
      setPhase("preview");
    }
  };

  const applySlip = async () => {
    if (!fileName || !data || !slipPreview) return;
    const manualMapping =
      !slipPreview.matched && slipForm && slipForm.touched
        ? {
            name: slipForm.name,
            category: slipForm.category,
            billingType: slipForm.billingType,
            plan: slipForm.plan || null,
            url: slipForm.url || null,
            account: slipForm.account || null,
            pattern: slipForm.pattern || null,
          }
        : null;
    if (!slipPreview.matched && !manualMapping) return;
    if (manualMapping && (!manualMapping.name.trim() || !manualMapping.pattern?.trim())) return;
    setPhase("applying");
    setError(null);
    try {
      const applied = await api.applySlipImport(fileName, data, manualMapping);
      setSlipResult(applied);
      setPhase("done");
      const learnedNote = applied.learnedPattern
        ? ` Learned pattern ${applied.learnedPattern} for next month.`
        : "";
      const trackedNote = applied.alreadyTracked
        ? " That charge is already tracked."
        : ` Added ${applied.entriesCreated} ledger entr${applied.entriesCreated === 1 ? "y" : "ies"}.`;
      onImported(`Imported slip from ${slipPreview.slip.merchant}.${trackedNote}${learnedNote}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The slip could not be applied.");
      setPhase("preview");
    }
  };

  const reset = () => {
    setPhase("idle");
    setFileName(null);
    setData(null);
    setPreview(null);
    setResult(null);
    setSlipPreview(null);
    setSlipResult(null);
    setSlipForm(null);
    setUnmapped([]);
    setError(null);
  };

  const switchMode = (next: ImportMode) => {
    if (next === mode) return;
    setMode(next);
    reset();
  };

  const updateRow = (key: string, patch: Partial<UnmappedRow>) => {
    setUnmapped((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch, touched: true } : row)),
    );
  };

  const skipRow = (key: string) => updateRow(key, { status: "skipped" });
  const unskipRow = (key: string) => updateRow(key, { status: "pending" });
  const markMapped = (key: string) => updateRow(key, { status: "mapped" });

  const updateSlipForm = (patch: Partial<SlipManualForm>) => {
    setSlipForm((form) => (form ? { ...form, ...patch, touched: true } : form));
  };

  const groupedEntries = new Map<string, number>();
  for (const entry of preview?.newEntries ?? []) {
    groupedEntries.set(entry.name, (groupedEntries.get(entry.name) ?? 0) + entry.amount);
  }

  const unmappedCounts = useMemo(() => {
    const counts = { total: unmapped.length, mapped: 0, skipped: 0, pending: 0 };
    for (const row of unmapped) {
      if (row.status === "mapped") counts.mapped += 1;
      else if (row.status === "skipped") counts.skipped += 1;
      else counts.pending += 1;
    }
    return counts;
  }, [unmapped]);

  const slipFormValid =
    !slipPreview ||
    Boolean(slipPreview.matched) ||
    Boolean(
      slipForm &&
        slipForm.name.trim() &&
        slipForm.pattern?.trim() &&
        slipForm.touched,
    );

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">{mode === "slip" ? "Slip import" : "Statement import"}</span>
          <h1>{mode === "slip" ? "Import a single slip." : "Drop, paste, or map a statement."}</h1>
          <p>
            {mode === "slip" ? (
              <>
                Drop a single-charge digital slip when the monthly statement missed it (cutoff,
                different card, posted later) or for a one-off purchase. Map unknown merchants once
                and the pattern is saved for next month.
              </>
            ) : (
              <>
                Choose a Yapı Kredi credit-card statement PDF, paste it from WhatsApp, or fill in
                the unmapped charges by hand. Anything you map by hand is remembered for next
                month.
              </>
            )}
          </p>
        </div>
        <div className="import-mode-toggle" role="tablist" aria-label="Import mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "statement"}
            className={mode === "statement" ? "active" : ""}
            onClick={() => switchMode("statement")}
          >
            <WalletCards size={14} /> Statement
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "slip"}
            className={mode === "slip" ? "active" : ""}
            onClick={() => switchMode("slip")}
          >
            <Receipt size={14} /> Single slip
          </button>
        </div>
      </section>

      {phase === "idle" && (
        <section className="panel import-dropzone">
          <div
            className={`import-drop ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onPaste={onPaste}
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={onInputChange}
            />
            <FileUp size={34} />
            <strong>{mode === "slip" ? "Choose a slip PDF" : "Choose a statement PDF"}</strong>
            <span>
              drag &amp; drop, or copy the PDF from WhatsApp and paste it here. The private API
              processes the PDF without storing the file.
            </span>
            <span className="import-paste-hint">
              <ClipboardPaste size={14} />
              <span className="import-paste-copy">
                Paste is armed — press <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>V</kbd> or use the mobile
                paste menu anywhere on this page.
              </span>
            </span>
            {pasteArmed && (
              <button
                type="button"
                className="import-paste-toggle"
                onClick={(event) => {
                  event.stopPropagation();
                  setPasteArmed(false);
                }}
              >
                <X size={12} /> Disable global paste
              </button>
            )}
          </div>
          {error && <div className="page-state error">{error}</div>}
        </section>
      )}

      {phase === "loading" && (
        <div className="page-state">
          <Loader2 className="spin" size={26} />
          <span>Reading {fileName}…</span>
        </div>
      )}

      {phase === "preview" && mode === "statement" && preview && (
        <section className="panel import-preview">
          <div className="import-preview-head">
            <div>
              <span className="panel-kicker">Preview</span>
              <h2>{preview.fileName}</h2>
              <small>
                Statement cutoff {formatDate(preview.cutoffDate)} ·{" "}
                {preview.summary.charges} digital charges · {preview.summary.matched} already tracked
              </small>
            </div>
            <div className="import-total">
              <strong>{formatMoney(preview.newEntries.reduce((total, entry) => total + entry.amount, 0))}</strong>
              <span>to add</span>
            </div>
          </div>

          {preview.newItems.length > 0 && (
            <div className="import-section">
              <h3><Sparkles size={15} /> New services to create</h3>
              <ul className="import-list">
                {preview.newItems.map((item) => (
                  <li key={item.serviceKey}>
                    <span className="import-name">{formatServiceName(item.name)}</span>
                    <span className={`category-pill category-${item.category.toLowerCase()}`}>
                      {item.category}
                    </span>
                    <span className="import-muted">{formatBillingType(item.billingType)}</span>
                    <span className="import-muted">{formatMembership(item.plan, "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {groupedEntries.size > 0 && (
            <div className="import-section">
              <h3><WalletCards size={15} /> Ledger entries to add</h3>
              <ul className="import-list">
                {[...groupedEntries.entries()].map(([name, amount]) => (
                  <li key={name}>
                    <span className="import-name">{formatServiceName(name)}</span>
                    <span className="import-muted">
                      {preview.newEntries
                        .filter((entry) => entry.name === name)
                        .map((entry) => `${entry.periodStart.slice(0, 7)}`)
                        .join(", ")}
                    </span>
                    <strong className="import-amount">{formatMoney(amount)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unmapped.length > 0 && (
            <div className="import-section import-unmapped-editor">
              <div className="import-unmapped-head">
                <h3><ClipboardPaste size={15} /> Unmapped online merchants</h3>
                <div className="import-unmapped-counts">
                  <span className="chip muted">{unmappedCounts.total} total</span>
                  <span className="chip warn">{unmappedCounts.pending} pending</span>
                  <span className="chip good">{unmappedCounts.mapped} mapped</span>
                  <span className="chip skip">{unmappedCounts.skipped} skipped</span>
                </div>
              </div>
              <p className="import-unmapped-help">
                Fill the name and category for the merchants you want to track, then mark them as
                mapped. Patterns you set are saved so the same merchant is auto-recognized next
                month.
              </p>
              <ul className="import-unmapped-list">
                {unmapped.map((row) => (
                  <li
                    key={row.key}
                    className={`import-unmapped-row import-row-${row.status}`}
                    data-status={row.status}
                  >
                    <div className="import-row-summary">
                      <span className="import-row-desc">{row.description.slice(0, 56)}</span>
                      <span className="import-row-date">{formatDate(row.date)}</span>
                      <span className="import-amount">{formatMoney(row.amount)}</span>
                    </div>
                    {row.status === "skipped" ? (
                      <div className="import-row-skipped">
                        <span>Skipped — not added to your portfolio.</span>
                        <button type="button" className="button tertiary" onClick={() => unskipRow(row.key)}>
                          <RotateCcw size={14} /> Undo
                        </button>
                      </div>
                    ) : (
                      <div className="import-row-form">
                        <label className="field small">
                          <span>Service name</span>
                          <input
                            type="text"
                            value={row.name}
                            maxLength={140}
                            onChange={(event) => updateRow(row.key, { name: event.target.value })}
                            placeholder="e.g. Hepsiburada"
                          />
                        </label>
                        <label className="field small">
                          <span>Pattern (regex / token)</span>
                          <input
                            type="text"
                            value={row.pattern}
                            maxLength={120}
                            onChange={(event) => updateRow(row.key, { pattern: event.target.value })}
                            placeholder="e.g. HEPSIPAY"
                          />
                        </label>
                        <label className="field small">
                          <span>Category</span>
                          <select
                            value={row.category}
                            onChange={(event) => updateRow(row.key, { category: event.target.value as Category })}
                          >
                            <option value="Platform">Platform</option>
                            <option value="Certificate">Certificate</option>
                            <option value="Device">Device</option>
                            <option value="Other">Other</option>
                          </select>
                        </label>
                        <label className="field small">
                          <span>Billing</span>
                          <select
                            value={row.billingType}
                            onChange={(event) => updateRow(row.key, { billingType: event.target.value as BillingType })}
                          >
                            <option value="recurring">Recurring (monthly)</option>
                            <option value="annual">Annual</option>
                            <option value="one_time">One-time</option>
                          </select>
                        </label>
                        <label className="field small">
                          <span>Plan / membership</span>
                          <input
                            type="text"
                            value={row.plan}
                            maxLength={120}
                            onChange={(event) => updateRow(row.key, { plan: event.target.value })}
                            placeholder="e.g. Pro"
                          />
                        </label>
                        <label className="field small">
                          <span>Account (optional)</span>
                          <input
                            type="text"
                            value={row.account}
                            maxLength={160}
                            onChange={(event) => updateRow(row.key, { account: event.target.value })}
                            placeholder="you@example.com"
                          />
                        </label>
                        <label className="field small">
                          <span>URL (optional)</span>
                          <input
                            type="url"
                            value={row.url}
                            maxLength={300}
                            onChange={(event) => updateRow(row.key, { url: event.target.value })}
                            placeholder="https://"
                          />
                        </label>
                        <div className="import-row-actions">
                          <button
                            type="button"
                            className="button tertiary"
                            onClick={() => skipRow(row.key)}
                          >
                            <X size={14} /> Skip
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => markMapped(row.key)}
                            disabled={!row.name.trim() || !row.pattern.trim()}
                          >
                            <Save size={14} /> Mark as mapped
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.newEntries.length === 0 && preview.newItems.length === 0 && unmapped.length === 0 ? (
            <div className="empty-state">
              <CheckCircle2 size={26} />
              <strong>Nothing new to add.</strong>
              <span>Every digital charge in this statement is already tracked.</span>
            </div>
          ) : (
            <div className="import-actions">
              <button className="button secondary" onClick={reset}>
                <RotateCcw size={16} /> Choose another
              </button>
              <button
                className="button primary"
                onClick={apply}
                disabled={unmappedCounts.mapped === 0 && preview.newEntries.length === 0}
              >
                <Sparkles size={16} /> Add {preview.newEntries.length + unmappedCounts.mapped} entries
              </button>
            </div>
          )}
          {error && <div className="page-state error">{error}</div>}
        </section>
      )}

      {phase === "preview" && mode === "slip" && slipPreview && (
        <section className="panel import-preview import-slip-preview">
          <div className="import-preview-head">
            <div>
              <span className="panel-kicker">Slip preview</span>
              <h2>{slipPreview.fileName}</h2>
              <small>
                {slipPreview.slip.merchant}
                {slipPreview.slip.city ? ` · ${slipPreview.slip.city}` : ""}
                {" · "}
                {formatDate(slipPreview.slip.date)}
                {slipPreview.slip.time ? ` ${slipPreview.slip.time}` : ""}
              </small>
            </div>
            <div className="import-total">
              <strong>{formatMoney(slipPreview.slip.amount)}</strong>
              <span>charge</span>
            </div>
          </div>

          <div className="import-section">
            <h3><Receipt size={15} /> Slip details</h3>
            <ul className="import-slip-details">
              <li>
                <span className="import-slip-label">Merchant</span>
                <strong>{slipPreview.slip.merchant}</strong>
              </li>
              {slipPreview.slip.city && (
                <li>
                  <span className="import-slip-label">City</span>
                  <span>{slipPreview.slip.city}</span>
                </li>
              )}
              <li>
                <span className="import-slip-label">Date</span>
                <span>
                  {formatDate(slipPreview.slip.date)}
                  {slipPreview.slip.time ? ` ${slipPreview.slip.time}` : ""}
                </span>
              </li>
              <li>
                <span className="import-slip-label">Amount</span>
                <strong>{formatMoney(slipPreview.slip.amount)}</strong>
              </li>
              {slipPreview.slip.references.bankRefNo && (
                <li>
                  <span className="import-slip-label">Bank ref</span>
                  <code>{slipPreview.slip.references.bankRefNo}</code>
                </li>
              )}
              {slipPreview.slip.references.rrn && (
                <li>
                  <span className="import-slip-label">RRN</span>
                  <code>{slipPreview.slip.references.rrn}</code>
                </li>
              )}
              {slipPreview.slip.references.sequenceNo && (
                <li>
                  <span className="import-slip-label">Sequence</span>
                  <code>{slipPreview.slip.references.sequenceNo}</code>
                </li>
              )}
              {slipPreview.slip.references.approvalCode && (
                <li>
                  <span className="import-slip-label">Approval</span>
                  <code>{slipPreview.slip.references.approvalCode}</code>
                </li>
              )}
              {slipPreview.slip.references.cardLast4 && (
                <li>
                  <span className="import-slip-label">Card</span>
                  <span>**** {slipPreview.slip.references.cardLast4}</span>
                </li>
              )}
              {slipPreview.slip.references.network && (
                <li>
                  <span className="import-slip-label">Network</span>
                  <span>{slipPreview.slip.references.network}</span>
                </li>
              )}
            </ul>
          </div>

          {slipPreview.matched && (
            <div className="import-section">
              <h3>
                <WalletCards size={15} /> Matched service
              </h3>
              <ul className="import-list">
                <li>
                  <span className="import-name">{formatServiceName(slipPreview.matched.service.name)}</span>
                  <span className={`category-pill category-${slipPreview.matched.service.category.toLowerCase()}`}>
                    {slipPreview.matched.service.category}
                  </span>
                  <span className="import-muted">{formatBillingType(slipPreview.matched.service.billingType)}</span>
                  <span className="import-muted">{formatMembership(slipPreview.matched.service.plan, "")}</span>
                </li>
              </ul>
              {slipPreview.matched.alreadyTracked && (
                <p className="import-slip-note">
                  <CheckCircle2 size={14} /> A matching ledger entry for this month already
                  exists. The import will be a no-op.
                </p>
              )}
            </div>
          )}

          {!slipPreview.matched && slipForm && (
            <div className="import-section import-unmapped-editor">
              <div className="import-unmapped-head">
                <h3><ClipboardPaste size={15} /> Unrecognised merchant</h3>
                <div className="import-unmapped-counts">
                  <span className="chip warn">Needs mapping</span>
                </div>
              </div>
              <p className="import-unmapped-help">
                The merchant on this slip is not in the catalog. Name it and pick a category so
                the charge can be added. The pattern is saved so the same merchant is
                auto-recognised next time.
              </p>
              <div className="import-row-form">
                <label className="field small">
                  <span>Service name</span>
                  <input
                    type="text"
                    value={slipForm.name}
                    maxLength={140}
                    onChange={(event) => updateSlipForm({ name: event.target.value })}
                    placeholder="e.g. Nanonoble"
                  />
                </label>
                <label className="field small">
                  <span>Pattern (regex / token)</span>
                  <input
                    type="text"
                    value={slipForm.pattern}
                    maxLength={120}
                    onChange={(event) => updateSlipForm({ pattern: event.target.value })}
                    placeholder="e.g. NANONOBLE"
                  />
                </label>
                <label className="field small">
                  <span>Category</span>
                  <select
                    value={slipForm.category}
                    onChange={(event) => updateSlipForm({ category: event.target.value as Category })}
                  >
                    <option value="Platform">Platform</option>
                    <option value="Certificate">Certificate</option>
                    <option value="Device">Device</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="field small">
                  <span>Billing</span>
                  <select
                    value={slipForm.billingType}
                    onChange={(event) => updateSlipForm({ billingType: event.target.value as BillingType })}
                  >
                    <option value="recurring">Recurring (monthly)</option>
                    <option value="annual">Annual</option>
                    <option value="one_time">One-time</option>
                  </select>
                </label>
                <label className="field small">
                  <span>Plan / membership</span>
                  <input
                    type="text"
                    value={slipForm.plan}
                    maxLength={120}
                    onChange={(event) => updateSlipForm({ plan: event.target.value })}
                    placeholder="e.g. Pro"
                  />
                </label>
                <label className="field small">
                  <span>Account (optional)</span>
                  <input
                    type="text"
                    value={slipForm.account}
                    maxLength={160}
                    onChange={(event) => updateSlipForm({ account: event.target.value })}
                    placeholder="you@example.com"
                  />
                </label>
                <label className="field small">
                  <span>URL (optional)</span>
                  <input
                    type="url"
                    value={slipForm.url}
                    maxLength={300}
                    onChange={(event) => updateSlipForm({ url: event.target.value })}
                    placeholder="https://"
                  />
                </label>
              </div>
            </div>
          )}

          {slipPreview.matched?.alreadyTracked ? (
            <div className="import-actions">
              <button className="button secondary" onClick={reset}>
                <RotateCcw size={16} /> Import another slip
              </button>
            </div>
          ) : (
            <div className="import-actions">
              <button className="button secondary" onClick={reset}>
                <RotateCcw size={16} /> Choose another
              </button>
              <button
                className="button primary"
                onClick={applySlip}
                disabled={!slipFormValid}
              >
                <Sparkles size={16} /> Add slip
              </button>
            </div>
          )}
          {error && <div className="page-state error">{error}</div>}
        </section>
      )}

      {phase === "applying" && (
        <div className="page-state">
          <Loader2 className="spin" size={26} />
          <span>Adding to your portfolio…</span>
        </div>
      )}

      {phase === "done" && mode === "statement" && result && (
        <section className="panel import-done">
          <CheckCircle2 size={30} />
          <h2>Import complete</h2>
          <p>
            {result.itemsCreated} new service{result.itemsCreated === 1 ? "" : "s"} and{" "}
            {result.entriesCreated} ledger entr{result.entriesCreated === 1 ? "y" : "ies"} added.
            {result.matchedSkipped > 0 && ` ${result.matchedSkipped} charges were already tracked.`}
            {result.manualMappingsApplied && result.manualMappingsApplied > 0
              ? ` ${result.manualMappingsApplied} manual mapping${
                  result.manualMappingsApplied === 1 ? "" : "s"
                } saved.`
              : ""}
          </p>
          {result.learnedPatterns && result.learnedPatterns.length > 0 && (
            <ul className="import-learned-list">
              {result.learnedPatterns.map((entry) => (
                <li key={entry.id}>
                  <code>{entry.pattern}</code>
                  <span>now maps to</span>
                  <strong>{entry.name}</strong>
                </li>
              ))}
            </ul>
          )}
          <div className="import-actions">
            <button className="button secondary" onClick={reset}>
              <RotateCcw size={16} /> Import another
            </button>
          </div>
        </section>
      )}

      {phase === "done" && mode === "slip" && slipResult && slipPreview && (
        <section className="panel import-done">
          <CheckCircle2 size={30} />
          <h2>{slipResult.alreadyTracked ? "Slip already tracked" : "Slip imported"}</h2>
          <p>
            {slipResult.alreadyTracked
              ? `A matching ledger entry for ${slipPreview.slip.merchant} on ${formatDate(slipPreview.slip.date)} was already saved.`
              : `Added ${slipPreview.slip.merchant} on ${formatDate(slipPreview.slip.date)} for ${formatMoney(slipPreview.slip.amount)} to your portfolio.`}
            {slipResult.learnedPattern && ` Saved pattern ${slipResult.learnedPattern} for next time.`}
          </p>
          <div className="import-actions">
            <button className="button secondary" onClick={reset}>
              <RotateCcw size={16} /> Import another slip
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
