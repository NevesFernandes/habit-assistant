// §82: the Backup section of Settings — export the parts of the data the user ticks as one
// JSON file, and import one back by Merge or Replace after a preview. The logic is in
// src/lib/backupJson.ts; chat and the Claude connector reach the same functions.
import { useMemo, useState } from "react";
import type { AppData } from "../types/models";
import {
  applyBackup,
  backupFilename,
  backupText,
  buildBackup,
  BACKUP_SECTIONS,
  changedAnything,
  describeImport,
  fileCounts,
  parseBackup,
  sectionCounts,
  SECTION_GROUPS,
  SECTION_LABELS,
  type BackupFile,
  type BackupSection,
  type ImportMode,
} from "../lib/backupJson";
import { saveTextFile } from "../lib/saveFile";
import { todayISO } from "../lib/recurrence";

interface BackupSectionProps {
  data: AppData;
  /** Saves the import through App.tsx's persist; resolves false when the save failed. */
  onImport: (file: BackupFile, sections: BackupSection[], mode: ImportMode) => Promise<boolean>;
}

const ALL: BackupSection[] = [...BACKUP_SECTIONS];

function SectionBoxes({
  counts,
  picked,
  onToggle,
}: {
  counts: Partial<Record<BackupSection, number>>;
  picked: Set<BackupSection>;
  onToggle: (section: BackupSection) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {SECTION_GROUPS.map((group) => (
        <fieldset key={group.label}>
          <legend className="mb-1 text-xs uppercase tracking-wide text-slate-500">{group.label}</legend>
          {group.sections.map((section) => {
            const count = counts[section];
            const absent = count === undefined;
            return (
              <label key={section} className={`flex items-center gap-2 py-0.5 ${absent ? "text-slate-600" : ""}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0"
                  disabled={absent}
                  checked={!absent && picked.has(section)}
                  onChange={() => onToggle(section)}
                />
                <span>
                  {SECTION_LABELS[section]}
                  {section !== "weekStart" && !absent && <span className="text-slate-500"> ({count})</span>}
                </span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

function toggled(set: Set<BackupSection>, section: BackupSection): Set<BackupSection> {
  const next = new Set(set);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  return next;
}

export default function BackupSection({ data, onImport }: BackupSectionProps) {
  const today = todayISO();

  // --- Export ---
  const [exportPicked, setExportPicked] = useState<Set<BackupSection>>(new Set(ALL));
  const [includeArchived, setIncludeArchived] = useState(true);
  const counts = useMemo(() => sectionCounts(data, today, { includeArchived }), [data, today, includeArchived]);
  const historyWithoutPlan =
    (exportPicked.has("habitHistory") && !exportPicked.has("habits")) ||
    (exportPicked.has("recurringTaskHistory") && !exportPicked.has("recurringTasks"));

  function download(sections: BackupSection[], archived: boolean) {
    const file = buildBackup(data, sections, today, { includeArchived: archived });
    saveTextFile(backupFilename(today), backupText(file));
  }

  // --- Import ---
  const [file, setFile] = useState<BackupFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [importError, setImportError] = useState("");
  const [importPicked, setImportPicked] = useState<Set<BackupSection>>(new Set());
  const [mode, setMode] = useState<ImportMode>("merge");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");
  const preview = useMemo(
    () => (file ? applyBackup(data, file, [...importPicked], mode, today).summary : null),
    [data, file, importPicked, mode, today],
  );

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    setResult("");
    setImportError("");
    setFile(null);
    if (!chosen) return;
    const parsed = parseBackup(await chosen.text());
    if ("error" in parsed) {
      setImportError(parsed.error);
      return;
    }
    setFile(parsed.file);
    setFileName(chosen.name);
    setImportPicked(new Set(Object.keys(fileCounts(parsed.file)) as BackupSection[]));
    setMode("merge");
  }

  async function handleImport() {
    if (!file || !preview) return;
    setSaving(true);
    const text = describeImport(preview, false);
    const ok = await onImport(file, [...importPicked], mode);
    setSaving(false);
    if (ok) {
      setResult(text);
      setFile(null);
    } else {
      setImportError("Couldn't save the import. Nothing was changed; try again.");
    }
  }

  const replaceWhat = [...importPicked].map((s) => SECTION_LABELS[s].toLowerCase()).join(", ");

  return (
    <div>
      <h2 className="mb-2 font-medium">Backup</h2>
      <p className="mb-3 text-slate-400">
        Save the parts you tick as one file, to keep or to bring into another account. API keys are never in it.
        For a spreadsheet of a period, ask the chat to "export October" instead.
      </p>

      <SectionBoxes counts={counts} picked={exportPicked} onToggle={(s) => setExportPicked(toggled(exportPicked, s))} />
      <label className="mt-2 flex items-center gap-2">
        <input type="checkbox" className="h-4 w-4 shrink-0" checked={includeArchived} onChange={() => setIncludeArchived(!includeArchived)} />
        Include archived habits and recurring tasks
      </label>
      {historyWithoutPlan && (
        <p className="mt-2 text-amber-300">
          History without its items can only be imported into an account that already has those items.
        </p>
      )}
      <button
        onClick={() => download([...exportPicked], includeArchived)}
        disabled={exportPicked.size === 0}
        className="mt-3 rounded-md bg-violet-500 px-3 py-1.5 text-white hover:bg-violet-400 disabled:opacity-50"
      >
        Download backup
      </button>

      <h3 className="mb-2 mt-5 font-medium">Import a backup</h3>
      <input type="file" accept=".json,application/json" onChange={handleFile} className="block w-full text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-slate-100" />
      {importError && <p className="mt-2 text-red-400">{importError}</p>}
      {result && <p className="mt-2 whitespace-pre-line text-emerald-300">{result}</p>}

      {file && preview && (
        <div className="mt-3 rounded-md border border-slate-700 p-3">
          <p className="mb-2 text-slate-400">
            {fileName}
            {file.exportedAt && `, made ${file.exportedAt.slice(0, 10)}`}. Tick what to bring in:
          </p>
          <SectionBoxes counts={fileCounts(file)} picked={importPicked} onToggle={(s) => setImportPicked(toggled(importPicked, s))} />

          <div className="mt-3 flex gap-2">
            {(["merge", "replace"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-md px-3 py-1.5 ${mode === m ? "bg-violet-500 font-medium text-white" : "bg-slate-900 hover:bg-slate-700"}`}
              >
                {m === "merge" ? "Merge" : "Replace"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-slate-400">
            {mode === "merge"
              ? "Adds what's new and updates what you already have from the file. Nothing else is touched."
              : "Clears each ticked part first, then puts the file's in. Items it removes take their history with them."}
          </p>

          <p className="mt-3 whitespace-pre-line">{describeImport(preview, true)}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={handleImport}
              disabled={saving || importPicked.size === 0 || !changedAnything(preview)}
              className={`rounded-md px-3 py-1.5 text-white disabled:opacity-50 ${
                mode === "replace" ? "bg-red-600 hover:bg-red-500" : "bg-violet-500 hover:bg-violet-400"
              }`}
            >
              {saving ? "Importing…" : mode === "replace" ? `Replace ${replaceWhat}` : "Import"}
            </button>
            <button onClick={() => download(ALL, true)} className="rounded-md bg-slate-700 px-3 py-1.5 hover:bg-slate-600">
              Download a backup first
            </button>
            <button onClick={() => setFile(null)} className="rounded-md px-3 py-1.5 text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
