"use client";

import { useEffect, useId, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { ENGINE_LABELS, isCompatible } from "@/lib/db-engines";
import { type DumpRow, formatStamp } from "@/lib/dumps";
import type { DatabaseTarget } from "@/server/dumps/containers";
import { listContainerDatabases, startDumpJob, startLoadJob } from "./dump-actions";
import { Modal } from "./modal";
import { BUTTON, BUTTON_PRIMARY, BUTTON_PRIMARY_DANGER, DATA, FIELD, LABEL } from "./ui";

const ALL = "\u0000all";

function Failure({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className={`${DATA} max-h-40 overflow-auto break-words whitespace-pre-wrap text-alert`}>
      {message}
    </p>
  ) : null;
}

type Login = { user: string; password: string };

function LoginFields({ login, onChange }: { login: Login; onChange: (login: Login) => void }) {
  const m = useMessages().dumps.dump;
  return (
    <fieldset className="grid gap-2 border border-rule p-3">
      <legend className={`${LABEL} px-1`}>{m.login}</legend>
      <p className="text-mut">{m.loginHint}</p>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={`${LABEL} block pb-1`}>{m.user}</span>
          <input
            value={login.user}
            onChange={(event) => onChange({ ...login, user: event.target.value })}
            autoComplete="off"
            spellCheck={false}
            maxLength={129}
            className={`${FIELD} ${DATA}`}
          />
        </label>
        <label>
          <span className={`${LABEL} block pb-1`}>{m.password}</span>
          <input
            type="password"
            value={login.password}
            onChange={(event) => onChange({ ...login, password: event.target.value })}
            autoComplete="new-password"
            maxLength={256}
            className={`${FIELD} ${DATA}`}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** Dumps one database of a container, or all of them, into the stash. */
export function DumpModal({ target, onClose }: { target: DatabaseTarget; onClose: () => void }) {
  const messages = useMessages();
  const m = messages.dumps.dump;
  const [databases, setDatabases] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(ALL);
  const [note, setNote] = useState("");
  const [login, setLogin] = useState<Login>({ user: "", password: "" });
  const [pending, setPending] = useState(false);

  const show = (result: Awaited<ReturnType<typeof listContainerDatabases>>) => {
    if ("error" in result) {
      setError(result.error);
      setDatabases([]);
      return;
    }
    setDatabases(result.databases);
    setSelected(result.defaultDatabase && result.databases.includes(result.defaultDatabase) ? result.defaultDatabase : ALL);
  };
  // The databases are read when the dialog opens: the target does not change under it.
  useEffect(() => {
    let current = true;
    void listContainerDatabases(target.id).then((result) => current && show(result));
    return () => {
      current = false;
    };
  }, [target.id]);
  const retry = () => {
    setDatabases(null);
    setError(null);
    void listContainerDatabases(target.id, login).then(show);
  };

  const start = async () => {
    setPending(true);
    setError(null);
    const result = await startDumpJob({ containerId: target.id, database: selected === ALL ? null : selected, note, login });
    setPending(false);
    if ("error" in result) setError(result.error);
    else onClose();
  };

  return (
    <Modal title={m.title(target.name)} onClose={onClose}>
      <p className={`${DATA} text-mut`}>
        {target.projectName} · {ENGINE_LABELS[target.engine]} · {target.image}
      </p>
      <label>
        <span className={`${LABEL} block pb-1`}>{m.database}</span>
        <select value={selected} disabled={databases === null} onChange={(event) => setSelected(event.target.value)} className={FIELD}>
          {databases === null ? <option>{m.reading}</option> : null}
          <option value={ALL}>{messages.dumps.allDatabases}</option>
          {(databases ?? []).map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={`${LABEL} block pb-1`}>{m.note}</span>
        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder={m.notePlaceholder} maxLength={500} className={`${FIELD} placeholder:text-mut`} />
      </label>
      {error ? (
        <>
          <Failure message={error} />
          <LoginFields login={login} onChange={setLogin} />
          <button type="button" onClick={retry} className={BUTTON}>
            {m.retry}
          </button>
        </>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" disabled={pending || databases === null} onClick={() => void start()} className={BUTTON_PRIMARY}>
          {pending ? m.starting : m.start}
        </button>
        <button type="button" onClick={onClose} className={BUTTON}>
          {messages.common.cancel}
        </button>
      </div>
    </Modal>
  );
}

/** A dump goes back into a container of its own project; a removed project leaves the choice open. */
const targetsFor = (dump: DumpRow | undefined, targets: DatabaseTarget[]) =>
  targets.filter(
    (item) => !dump || (isCompatible(dump.engine, item.engine) && (dump.projectId === null || item.projectId === dump.projectId)),
  );

const describe = (dump: DumpRow, all: string) =>
  `${dump.projectName} · ${dump.containerName} · ${dump.database ?? all} · ${formatStamp(dump.createdAt)}`;

/**
 * Loads a dump of the stash into a database. Either side can be fixed by the place the
 * dialog is opened from: a dump to load, or a container to load into.
 */
export function LoadModal({
  dumps,
  targets,
  dumpId,
  targetId,
  onClose,
}: {
  dumps: DumpRow[];
  targets: DatabaseTarget[];
  dumpId?: number;
  targetId?: string;
  onClose: () => void;
}) {
  const messages = useMessages();
  const m = messages.dumps.loadDialog;
  const listId = useId();
  const finished = dumps.filter((dump) => dump.status === "done");
  const [pickedDump, setPickedDump] = useState<number | null>(dumpId ?? null);
  const [pickedTarget, setPickedTarget] = useState<string | null>(() => {
    if (targetId) return targetId;
    // The only container of the dump's project is the one to load into.
    const own = targetsFor(finished.find((item) => item.id === dumpId), targets);
    return dumpId !== undefined && own.length === 1 ? own[0].id : null;
  });
  const [database, setDatabase] = useState(() => finished.find((item) => item.id === dumpId)?.database ?? "");
  const [existing, setExisting] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [keepCopy, setKeepCopy] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = targets.find(({ id }) => id === pickedTarget) ?? null;
  const dump = finished.find(({ id }) => id === pickedDump) ?? null;
  const dumpChoices = finished.filter((item) => !target || isCompatible(item.engine, target.engine));
  const targetChoices = targetsFor(dump ?? undefined, targets);

  // The database proposed is the one the dump came from: the usual case is to put it back.
  const chooseDump = (id: number | null) => {
    setPickedDump(id);
    const chosen = finished.find((item) => item.id === id);
    setDatabase(chosen?.database ?? "");
    setConfirmed(false);
    // Keep the container when it still fits, otherwise take the project's only one.
    const fits = targetsFor(chosen, targets);
    if (!fits.some(({ id: containerId }) => containerId === pickedTarget)) {
      setPickedTarget(chosen && fits.length === 1 ? fits[0].id : null);
    }
  };
  useEffect(() => {
    if (!pickedTarget) return;
    let current = true;
    void listContainerDatabases(pickedTarget).then((result) => {
      if (current) setExisting("error" in result ? [] : result.databases);
    });
    return () => {
      current = false;
    };
  }, [pickedTarget]);

  const everyDatabase = dump !== null && dump.database === null;
  const ready = dump !== null && target !== null && confirmed && (everyDatabase || database.trim() !== "");
  // A database that does not exist yet has nothing to lose, and dumping it would only fail.
  const canKeepCopy = everyDatabase || existing.includes(database.trim());

  const start = async () => {
    if (!dump || !target) return;
    setPending(true);
    setError(null);
    const result = await startLoadJob({
      dumpId: dump.id,
      containerId: target.id,
      database: everyDatabase ? null : database.trim(),
      confirmed: true,
      keepCopy: canKeepCopy && keepCopy,
    });
    setPending(false);
    if ("error" in result) setError(result.error);
    else onClose();
  };

  return (
    <Modal title={targetId && target ? m.titleInto(target.name) : m.title} onClose={onClose}>
      <label>
        <span className={`${LABEL} block pb-1`}>{m.dump}</span>
        <select
          value={pickedDump ?? ""}
          disabled={dumpId !== undefined}
          onChange={(event) => chooseDump(event.target.value === "" ? null : Number(event.target.value))}
          className={FIELD}
        >
          <option value="" />
          {dumpChoices.map((item) => (
            <option key={item.id} value={item.id}>
              {describe(item, messages.dumps.allDatabases)}
            </option>
          ))}
        </select>
        {dumpChoices.length === 0 ? <span className="mt-1 block text-mut">{m.noDumps}</span> : null}
      </label>

      <label>
        <span className={`${LABEL} block pb-1`}>{m.container}</span>
        <select
          value={pickedTarget ?? ""}
          disabled={targetId !== undefined}
          onChange={(event) => setPickedTarget(event.target.value === "" ? null : event.target.value)}
          className={FIELD}
        >
          <option value="" />
          {targetChoices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.projectName} · {item.name} · {ENGINE_LABELS[item.engine]}
            </option>
          ))}
        </select>
        {targetChoices.length === 0 ? <span className="mt-1 block text-mut">{m.noContainers}</span> : null}
      </label>

      {everyDatabase ? (
        <p className="text-mut">{m.everyDatabase}</p>
      ) : (
        <label>
          <span className={`${LABEL} block pb-1`}>{m.database}</span>
          <input
            value={database}
            onChange={(event) => setDatabase(event.target.value)}
            list={listId}
            maxLength={63}
            spellCheck={false}
            className={`${FIELD} ${DATA}`}
          />
          <datalist id={listId}>
            {existing.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <span className="mt-1 block text-mut">{m.databaseHint}</span>
        </label>
      )}

      <p className="border border-alert px-3 py-2 text-alert">{m.replaces}</p>
      {canKeepCopy ? (
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" checked={keepCopy} onChange={(event) => setKeepCopy(event.target.checked)} className="mt-1 size-4" />
          <span>{m.keepCopy}</span>
        </label>
      ) : null}
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 size-4 accent-[var(--alert)]" />
        <span>{m.understood}</span>
      </label>
      <Failure message={error} />
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" disabled={!ready || pending} onClick={() => void start()} className={BUTTON_PRIMARY_DANGER}>
          {pending ? m.starting : m.start}
        </button>
        <button type="button" onClick={onClose} className={BUTTON}>
          {messages.common.cancel}
        </button>
      </div>
    </Modal>
  );
}
