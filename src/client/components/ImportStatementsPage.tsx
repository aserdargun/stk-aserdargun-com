import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { api } from "../lib/api";
import { formatBillingType, formatDate, formatMoney } from "../lib/format";
import type { StatementImportPreview, StatementImportResult } from "../types";

type Phase = "idle" | "loading" | "preview" | "applying" | "done";

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

export function ImportStatementsPage({ onImported }: { onImported: (message: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [data, setData] = useState<string | null>(null);
  const [preview, setPreview] = useState<StatementImportPreview | null>(null);
  const [result, setResult] = useState<StatementImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF account statement.");
      return;
    }
    setError(null);
    setPreview(null);
    setResult(null);
    setFileName(file.name);
    setPhase("loading");
    try {
      const base64 = await readFileAsBase64(file);
      setData(base64);
      const parsed = await api.previewStatementImport(file.name, base64);
      setPreview(parsed);
      setPhase("preview");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The statement could not be parsed.");
      setPhase("idle");
    }
  }, []);

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

  const apply = async () => {
    if (!fileName || !data) return;
    setPhase("applying");
    setError(null);
    try {
      const applied = await api.applyStatementImport(fileName, data);
      setResult(applied);
      setPhase("done");
      onImported(`Imported ${applied.entriesCreated} ledger entries from the statement.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The import could not be applied.");
      setPhase("preview");
    }
  };

  const reset = () => {
    setPhase("idle");
    setFileName(null);
    setData(null);
    setPreview(null);
    setResult(null);
    setError(null);
  };

  const groupedEntries = new Map<string, number>();
  for (const entry of preview?.newEntries ?? []) {
    groupedEntries.set(entry.name, (groupedEntries.get(entry.name) ?? 0) + entry.amount);
  }

  return (
    <div className="page-stack">
      <section className="page-heading compact-heading">
        <div>
          <span className="eyebrow">Statement import</span>
          <h1>Drop a statement, detect digital services.</h1>
          <p>
            Choose a Yapı Kredi account statement PDF. Stackfolio reads it, finds only the
            digital-service charges, and previews what would be added before you confirm.
          </p>
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
            <strong>Choose a statement PDF</strong>
            <span>or drag and drop it here. It is parsed locally by the API and never stored.</span>
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

      {phase === "preview" && preview && (
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
                    <span className="import-name">{item.name}</span>
                    <span className={`category-pill category-${item.category.toLowerCase()}`}>
                      {item.category}
                    </span>
                    <span className="import-muted">{formatBillingType(item.billingType)}</span>
                    <span className="import-muted">{item.plan ?? ""}</span>
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
                    <span className="import-name">{name}</span>
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

          {preview.unclassified.length > 0 && (
            <details className="import-section import-unclassified">
              <summary>{preview.unclassified.length} unmapped online merchants (not added)</summary>
              <ul className="import-list">
                {preview.unclassified.map((candidate, index) => (
                  <li key={index}>
                    <span className="import-name">{candidate.description.slice(0, 44)}</span>
                    <span className="import-muted">{formatDate(candidate.date)}</span>
                    <span className="import-amount">{formatMoney(candidate.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preview.newEntries.length === 0 && preview.newItems.length === 0 ? (
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
              <button className="button primary" onClick={apply}>
                <Sparkles size={16} /> Add {preview.newEntries.length} entries
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

      {phase === "done" && result && (
        <section className="panel import-done">
          <CheckCircle2 size={30} />
          <h2>Import complete</h2>
          <p>
            {result.itemsCreated} new service{result.itemsCreated === 1 ? "" : "s"} and{" "}
            {result.entriesCreated} ledger entr{result.entriesCreated === 1 ? "y" : "ies"} added.
            {result.matchedSkipped > 0 && ` ${result.matchedSkipped} charges were already tracked.`}
          </p>
          <div className="import-actions">
            <button className="button secondary" onClick={reset}>
              <RotateCcw size={16} /> Import another
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
