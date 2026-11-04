"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { formatAge, groupRows, type RegistryRow } from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { importBackup, updateStatus } from "../actions";
import { TagList } from "../tag-list";
import { BUTTON, DATA } from "../ui";

const COLUMNS: (ProjectStatus | null)[] = [null, "active", "paused", "resume"];

const MOVE =
  "h-full min-h-[60px] cursor-pointer border-l border-rule font-mono hover:bg-ink hover:text-bg disabled:cursor-default disabled:text-rule disabled:hover:bg-transparent";

function Backup() {
  const m = useMessages().board;
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFile = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      const result = await importBackup(await file.text());
      if ("error" in result) {
        setMessage(result.error);
      } else {
        setMessage(m.restored(result.imported, result.unknownPaths.length));
      }
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {message ? (
        <span role="status" className={`${DATA} text-mut`}>
          {message}
        </span>
      ) : null}
      <a href="/api/classification" download className={`${BUTTON} inline-flex items-center`}>
        {m.export}
      </a>
      <button type="button" disabled={pending} onClick={() => input.current?.click()} className={BUTTON}>
        {pending ? m.importing : m.import}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label={m.importLabel}
        tabIndex={-1}
        onChange={(event) => onFile(event.target.files?.[0])}
      />
    </div>
  );
}

export function Board({
  rows,
  knownTags,
  now,
}: {
  rows: RegistryRow[];
  knownTags: string[];
  now: number;
}) {
  const messages = useMessages();
  const m = messages.board;
  const [tag, setTag] = useState<string | null>(null);
  const [, start] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    rows,
    (current, move: { id: number; status: ProjectStatus | null }) =>
      current.map((row) => (row.id === move.id ? { ...row, status: move.status } : row)),
  );

  const move = (row: RegistryRow, index: number) => {
    const status = COLUMNS[index];
    start(async () => {
      applyMove({ id: row.id, status });
      await updateStatus([row.id], status);
    });
  };

  const renderCard = (row: RegistryRow, index: number, nested: boolean) => (
    <div
      key={row.id}
      className={`grid grid-cols-[minmax(0,1fr)_44px_44px] items-stretch border-rule pl-4 hover:bg-sel ${nested ? "border-t first:border-t-0" : "border-b"}`}
    >
      <Link href={`/projects/${row.id}`} className={`min-w-0 py-2.5 pr-2 ${nested ? "border-l-2 border-rule pl-3" : ""}`}>
        <div className="truncate font-semibold">
          {row.favorite ? "★ " : ""}
          {row.name}
        </div>
        <div className={`${DATA} truncate text-mut`}>
          {row.hasGit ? formatAge(row.lastCommitAt, now, messages.age) : m.noGit}
          {(row.dirtyCount ?? 0) > 0 ? (
            <span className="font-medium text-alert"> · {m.changes(row.dirtyCount ?? 0)}</span>
          ) : null}
        </div>
        <TagList tags={row.tags} />
      </Link>
      <button
        type="button"
        className={MOVE}
        disabled={index === 0}
        aria-label={m.previous(row.name)}
        onClick={() => move(row, index - 1)}
      >
        ←
      </button>
      <button
        type="button"
        className={MOVE}
        disabled={index === COLUMNS.length - 1}
        aria-label={m.next(row.name)}
        onClick={() => move(row, index + 1)}
      >
        →
      </button>
    </div>
  );

  const filters: { value: string | null; label: string }[] = [
    { value: null, label: m.all },
    ...knownTags.map((name) => ({ value: name, label: name })),
  ];
  const shown = optimistic.filter(
    (row) => !row.abandoned && (tag === null || row.tags.includes(tag)),
  );

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink px-4 py-2">
        <div role="group" aria-label={m.filterByTag} className="flex flex-wrap pl-px">
          {filters.map(({ value, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={tag === value}
              onClick={() => setTag(value)}
              className="-ml-px min-h-10 cursor-pointer border border-ink px-3.5 font-medium aria-pressed:bg-ink aria-pressed:text-bg"
            >
              {label}
            </button>
          ))}
        </div>
        <Backup />
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
        {COLUMNS.map((status, index) => {
          const label = messages.status[status ?? "none"];
          const items = shown.filter((row) => row.status === status);
          return (
            <section key={label} aria-label={label} className="min-w-0 border-r border-rule last:border-r-0">
              <div className="flex items-baseline justify-between border-b border-ink px-4 pt-5 pb-3.5">
                <h2 className="text-[22px] font-bold tracking-tight">{label}</h2>
                <span className={`${DATA} text-mut`}>{items.length}</span>
              </div>
              {groupRows(items).map((item) =>
                item.kind === "project" ? (
                  renderCard(item.row, index, false)
                ) : (
                  <div key={`group-${item.group.parentId}`} role="group" aria-label={item.group.name} className="border-b border-ink">
                    <div className="flex items-baseline justify-between gap-2 border-b border-rule bg-panel px-4 py-2">
                      <span className="truncate font-bold">{item.group.name}</span>
                      <span className={`${DATA} shrink-0 text-mut`}>{item.group.rows.length}</span>
                    </div>
                    {item.group.rows.map((row) => renderCard(row, index, true))}
                  </div>
                ),
              )}
              {items.length === 0 ? <p className="px-4 py-5 text-mut">{m.noProjects}</p> : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
