"use client";

import { type FormEvent, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { AliasProblem, CommandAlias } from "@/lib/aliases";
import { saveConsoleAliases } from "./actions";
import { PlusIcon } from "./icons";
import { BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, DATA, FIELD, LABEL } from "./ui";

type Row = CommandAlias & { key: number };

/** One row per alias, saved together: the order here is the order of the buttons in the consoles. */
export function AliasEditor({ aliases, onSaved, onCancel }: { aliases: CommandAlias[]; onSaved: () => void; onCancel?: () => void }) {
  const messages = useMessages();
  const m = messages.settings;
  const next = useRef(aliases.length);
  const [rows, setRows] = useState<Row[]>(() => aliases.map((alias, key) => ({ ...alias, key })));
  const [problem, setProblem] = useState<AliasProblem | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  const change = (key: number, patch: Partial<CommandAlias>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const add = () => {
    setRows((current) => [...current, { key: next.current++, name: "", command: "" }]);
    // The new row's name, once it is there.
    requestAnimationFrame(() => list.current?.querySelector<HTMLInputElement>("li:last-child input")?.focus());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    try {
      const found = await saveConsoleAliases(rows.map(({ name, command }) => ({ name, command })));
      setProblem(found);
      if (!found) onSaved();
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  const wrongRow = problem && "row" in problem ? problem.row : null;
  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-3">
      <div ref={list}>
        {rows.length === 0 ? <p className="text-mut">{m.noAliases}</p> : null}
        {rows.length > 0 ? (
          <div className="grid grid-cols-[minmax(90px,1fr)_minmax(0,3fr)_auto] gap-x-2 pb-1 max-sm:hidden" aria-hidden>
            <span className={LABEL}>{m.aliasName}</span>
            <span className={LABEL}>{m.aliasCommand}</span>
            <span />
          </div>
        ) : null}
        <ul className="grid gap-2">
          {rows.map((row, index) => (
            <li
              key={row.key}
              className={`grid grid-cols-[minmax(90px,1fr)_minmax(0,3fr)_auto] items-center gap-2 max-sm:grid-cols-[minmax(0,1fr)_auto] ${wrongRow === index + 1 ? "outline-1 outline-offset-2 outline-alert" : ""}`}
            >
              <input
                aria-label={m.aliasName}
                value={row.name}
                placeholder="sf:cc"
                maxLength={32}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => change(row.key, { name: event.target.value })}
                className={`${FIELD} ${DATA} placeholder:text-mut`}
              />
              <input
                aria-label={m.aliasCommand}
                value={row.command}
                placeholder="php bin/console c:c"
                maxLength={1000}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => change(row.key, { command: event.target.value })}
                className={`${FIELD} ${DATA} placeholder:text-mut max-sm:order-last max-sm:col-span-2`}
              />
              <button
                type="button"
                aria-label={m.removeAlias(row.name.trim())}
                title={m.removeAlias(row.name.trim())}
                onClick={() => setRows((current) => current.filter(({ key }) => key !== row.key))}
                className={BUTTON_SMALL_DANGER}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <button type="button" onClick={add} className={BUTTON_SMALL}>
          <PlusIcon />
          {m.addAlias}
        </button>
      </div>
      {problem ? <p role="alert" className="text-alert">{m.aliasProblem(problem)}</p> : null}
      {failed ? <p role="alert" className="text-alert">{m.aliasesSaveFailed}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? messages.common.saving : messages.common.save}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={BUTTON}>
            {messages.common.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
