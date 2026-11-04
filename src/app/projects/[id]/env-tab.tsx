"use client";

import { type FormEvent, type KeyboardEvent, useState, useTransition } from "react";
import { declareEnvVariableInProject, removeEnvVariable, restoreEnvVariable, saveEnvVariable } from "@/app/actions";
import { useFlash } from "@/app/flash";
import { Modal, useConfirm } from "@/app/modal";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_PRIMARY, BUTTON_PRIMARY_SMALL, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, DATA, FIELD, LABEL, SECTION_TITLE, SEGMENT } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import { ENV_KEY, type EnvRow } from "@/lib/env-file";
import type { EnvHistoryEntry, EnvView } from "@/server/env-vars";

const COLUMNS = "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,1.5fr)]";
const VALUE = `${DATA} break-all whitespace-pre-wrap`;
const CELL_LABEL = `${LABEL} mb-0.5 lg:hidden`;

/** Runs an action on the file, then tells how it went. */
function useEnvAction() {
  const flash = useFlash();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<string | null>, success: string, then?: () => void) =>
    start(async () => {
      const error = await action();
      if (error) {
        flash("error", error);
        return;
      }
      flash("success", success);
      then?.();
    });
  return { pending, run };
}

function Value({ value, empty }: { value: string; empty: string }) {
  return value === "" ? <span className={`${DATA} text-mut`}>{empty}</span> : <span className={VALUE}>{value}</span>;
}

/** Enter saves, as in a one-line field. A value over several lines is still possible with Shift+Enter. */
function ValueField({
  label,
  value,
  onChange,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    } else if (event.key === "Escape" && onCancel) {
      // A modal would close on it too, along with what was typed.
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <textarea
      aria-label={label}
      value={value}
      rows={1}
      spellCheck={false}
      autoFocus={autoFocus}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={`${FIELD} ${DATA} block max-h-64 resize-y py-2 break-all [field-sizing:content]`}
    />
  );
}

function HistoryModal({
  projectId,
  row,
  entries,
  editable,
  onClose,
}: {
  projectId: number;
  row: EnvRow;
  entries: EnvHistoryEntry[];
  editable: boolean;
  onClose: () => void;
}) {
  const { envTab: m, gitTab, common } = useMessages();
  const { pending, run } = useEnvAction();
  // Going through the same value twice leaves two entries: only the latest is the current one.
  const currentId = entries.find((entry) => entry.value === row.local)?.id;
  return (
    <Modal title={m.historyOf(row.key)} onClose={onClose} wide>
      <div className="max-h-[60vh] overflow-y-auto">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className="grid items-start gap-x-4 gap-y-1 border-b border-rule py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <div className="min-w-0">
              {entry.value === null ? (
                <span className={`${DATA} text-mut`}>{m.removedValue}</span>
              ) : (
                <Value value={entry.value} empty={m.emptyValue} />
              )}
              <div className={`${DATA} mt-0.5 text-mut`}>
                {new Date(entry.savedAt).toLocaleString(gitTab.dateLocale)} · {m.origins[entry.origin]}
              </div>
            </div>
            {entry.id === currentId ? (
              <span className={`${BADGE} justify-self-start`}>{m.currentValue}</span>
            ) : editable ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => restoreEnvVariable(projectId, entry.id), m.restored(row.key), onClose)}
                className={`${BUTTON_SMALL} justify-self-start`}
              >
                {m.restore}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div>
        <button type="button" onClick={onClose} className={BUTTON}>
          {common.close}
        </button>
      </div>
    </Modal>
  );
}

function Row({
  projectId,
  row,
  entries,
  editable,
}: {
  projectId: number;
  row: EnvRow;
  entries: EnvHistoryEntry[];
  editable: boolean;
}) {
  const { envTab: m, common } = useMessages();
  const { pending, run } = useEnvAction();
  const { confirm, confirmation } = useConfirm();
  const [draft, setDraft] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const save = () => {
    if (draft === null) return;
    if (draft === row.local) {
      setDraft(null);
      return;
    }
    run(() => saveEnvVariable(projectId, row.key, draft), m.saved(row.key), () => setDraft(null));
  };

  return (
    <div
      className={`grid gap-x-4 gap-y-2 border-b border-rule py-2.5 last:border-b-0 ${COLUMNS} ${row.state === "missing" ? "-mx-4 border-l-2 border-l-alert pr-4 pl-[14px]" : ""}`}
    >
      <div className="min-w-0">
        <div className={`${DATA} font-medium break-all`}>{row.key}</div>
        {m.states[row.state] ? (
          <span className={`${row.state === "missing" ? BADGE_ALERT : BADGE} mt-1`}>{m.states[row.state]}</span>
        ) : null}
      </div>

      <div className="min-w-0">
        <div className={CELL_LABEL}>.env.local</div>
        {draft !== null ? (
          <div className="grid gap-2">
            <ValueField
              label={m.valueOf(row.key)}
              value={draft}
              onChange={setDraft}
              onSubmit={save}
              onCancel={() => setDraft(null)}
              autoFocus
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={pending} onClick={save} className={BUTTON_PRIMARY_SMALL}>
                {pending ? common.saving : common.save}
              </button>
              <button type="button" disabled={pending} onClick={() => setDraft(null)} className={BUTTON_SMALL}>
                {common.cancel}
              </button>
            </div>
          </div>
        ) : row.local === null ? (
          <span className={`${DATA} text-mut`}>{m.absent}</span>
        ) : (
          <Value value={row.local} empty={m.emptyValue} />
        )}
        {draft === null ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {editable ? (
              <button
                type="button"
                aria-label={`${row.local === null ? m.add : m.edit} ${row.key}`}
                onClick={() => setDraft(row.local ?? row.declared ?? "")}
                className={BUTTON_SMALL}
              >
                {row.local === null ? m.add : m.edit}
              </button>
            ) : null}
            {entries.length > 0 ? (
              <button
                type="button"
                aria-label={`${m.history(entries.length)} ${row.key}`}
                onClick={() => setShowHistory(true)}
                className={BUTTON_SMALL}
              >
                {m.history(entries.length)}
              </button>
            ) : null}
            {editable && row.local !== null ? (
              <button
                type="button"
                disabled={pending}
                aria-label={`${m.remove} ${row.key}`}
                onClick={() =>
                  confirm({
                    ...m.confirmRemove(row.key, row.declared !== null),
                    action: m.remove,
                    danger: true,
                    onConfirm: () => run(() => removeEnvVariable(projectId, row.key), m.removed(row.key)),
                  })
                }
                className={BUTTON_SMALL_DANGER}
              >
                {m.remove}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        <div className={CELL_LABEL}>.env</div>
        {row.declared === null ? (
          <>
            <span className={`${DATA} text-mut`}>{m.notDeclared}</span>
            {editable && row.local !== null ? (
              <div className="mt-1.5">
                <button
                  type="button"
                  disabled={pending}
                  aria-label={`${row.key} : ${m.declareHint}`}
                  title={m.declareHint}
                  onClick={() => run(() => declareEnvVariableInProject(projectId, row.key), m.declared(row.key))}
                  className={BUTTON_SMALL}
                >
                  {m.declare}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <Value value={row.declared} empty={m.emptyValue} />
        )}
      </div>

      {confirmation}
      {showHistory ? (
        <HistoryModal projectId={projectId} row={row} entries={entries} editable={editable} onClose={() => setShowHistory(false)} />
      ) : null}
    </div>
  );
}

function AddVariable({ projectId, known }: { projectId: number; known: string[] }) {
  const { envTab: m, common } = useMessages();
  const { pending, run } = useEnvAction();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const name = key.trim();
  const problem = name === "" ? null : !ENV_KEY.test(name) ? m.invalidKey : known.includes(name) ? m.alreadyListed : null;

  const close = () => {
    setOpen(false);
    setKey("");
    setValue("");
  };
  const submit = () => {
    if (name === "" || problem) return;
    run(() => saveEnvVariable(projectId, name, value), m.saved(name), close);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={BUTTON}>
        {m.addVariable}
      </button>
      {open ? (
        <Modal title={m.addVariable} onClose={close}>
          <form
            className="grid gap-3"
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="grid gap-1">
              <span className={LABEL}>{m.name}</span>
              <input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                spellCheck={false}
                autoComplete="off"
                className={`${FIELD} ${DATA}`}
              />
            </label>
            {problem ? <p className={`${DATA} text-alert`}>{problem}</p> : null}
            <label className="grid gap-1">
              <span className={LABEL}>{m.value}</span>
              <ValueField label={m.value} value={value} onChange={setValue} onSubmit={submit} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending || name === "" || problem !== null} className={BUTTON_PRIMARY}>
                {pending ? common.saving : common.save}
              </button>
              <button type="button" onClick={close} className={BUTTON}>
                {common.cancel}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function EnvTab({ projectId, view, readOnly }: { projectId: number; view: EnvView; readOnly: boolean }) {
  const m = useMessages().envTab;
  const [onlyMissing, setOnlyMissing] = useState(false);
  const missing = view.rows.filter((row) => row.state === "missing");
  // The filter has nothing left to show once the last one is filled in.
  const shown = onlyMissing && missing.length > 0 ? missing : view.rows;
  const editable = !readOnly && !view.localUnreadable;

  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-3`}>{m.title(view.rows.length)}</h2>

      {view.localUnreadable ? <p className={`${DATA} mb-3 text-alert`}>{m.unreadable(".env.local")}</p> : null}
      {view.declaredUnreadable ? <p className={`${DATA} mb-3 text-alert`}>{m.unreadable(".env")}</p> : null}
      {!view.localIgnored && !view.localUnreadable ? <p className={`${DATA} mb-3 text-alert`}>{m.notIgnored}</p> : null}

      <p className="mb-3 text-mut">
        {!view.localExists
          ? m.noLocalFile
          : !view.declaredExists
            ? m.noDeclaredFile
            : missing.length > 0
              ? m.missingCount(missing.length)
              : m.nothingMissing}
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        {missing.length > 0 ? (
          <div role="group" aria-label={m.filter} className="inline-flex">
            <button type="button" aria-pressed={!onlyMissing} onClick={() => setOnlyMissing(false)} className={SEGMENT}>
              {m.filterAll(view.rows.length)}
            </button>
            <button type="button" aria-pressed={onlyMissing} onClick={() => setOnlyMissing(true)} className={SEGMENT}>
              {m.filterMissing(missing.length)}
            </button>
          </div>
        ) : null}
        {editable ? <AddVariable projectId={projectId} known={view.rows.filter((row) => row.local !== null).map((row) => row.key)} /> : null}
      </div>

      {view.rows.length > 0 ? (
        <>
          <div className={`${LABEL} hidden gap-x-4 border-b border-rule-strong pb-1 lg:grid ${COLUMNS}`}>
            <span>{m.name}</span>
            <span>.env.local</span>
            <span>.env</span>
          </div>
          {shown.map((row) => (
            <Row key={row.key} projectId={projectId} row={row} entries={view.history[row.key] ?? []} editable={editable} />
          ))}
        </>
      ) : null}

      <p className={`${DATA} mt-3 text-mut`}>{m.referenceHint}</p>
    </section>
  );
}
