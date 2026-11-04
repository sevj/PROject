"use client";

import Link from "next/link";
import { useOptimistic, useRef, useState, useTransition } from "react";
import { formatAge, groupRows, type RegistryRow, STATUS_LABELS } from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { importBackup, updateStatus } from "../actions";
import { TagList } from "../tag-list";
import { BUTTON, DATA } from "../ui";

const COLUMNS: { status: ProjectStatus | null; label: string }[] = [
  { status: null, label: "Sans statut" },
  { status: "active", label: STATUS_LABELS.active },
  { status: "paused", label: STATUS_LABELS.paused },
  { status: "resume", label: STATUS_LABELS.resume },
  { status: "archived", label: STATUS_LABELS.archived },
];

const MOVE =
  "h-full min-h-[60px] cursor-pointer border-l border-rule font-mono hover:bg-ink hover:text-bg disabled:cursor-default disabled:text-rule disabled:hover:bg-transparent";

function Backup() {
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
        const unknown = result.unknownPaths.length;
        setMessage(
          `${result.imported} projet${result.imported > 1 ? "s" : ""} restauré${result.imported > 1 ? "s" : ""}${unknown > 0 ? `, ${unknown} chemins inconnus ignorés` : ""}.`,
        );
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
        Exporter
      </a>
      <button type="button" disabled={pending} onClick={() => input.current?.click()} className={BUTTON}>
        {pending ? "Import…" : "Importer"}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Importer un export de classement"
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
  const [tag, setTag] = useState<string | null>(null);
  const [, start] = useTransition();
  const [optimistic, applyMove] = useOptimistic(
    rows,
    (current, move: { id: number; status: ProjectStatus | null }) =>
      current.map((row) => (row.id === move.id ? { ...row, status: move.status } : row)),
  );

  const move = (row: RegistryRow, index: number) => {
    const { status } = COLUMNS[index];
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
          {row.hasGit ? formatAge(row.lastCommitAt, now) : "sans git"}
          {(row.dirtyCount ?? 0) > 0 ? (
            <span className="font-medium text-alert"> · {row.dirtyCount} modif{(row.dirtyCount ?? 0) > 1 ? "s" : ""}</span>
          ) : null}
        </div>
        <TagList tags={row.tags} />
      </Link>
      <button
        type="button"
        className={MOVE}
        disabled={index === 0}
        aria-label={`Déplacer ${row.name} vers la colonne précédente`}
        onClick={() => move(row, index - 1)}
      >
        ←
      </button>
      <button
        type="button"
        className={MOVE}
        disabled={index === COLUMNS.length - 1}
        aria-label={`Déplacer ${row.name} vers la colonne suivante`}
        onClick={() => move(row, index + 1)}
      >
        →
      </button>
    </div>
  );

  const filters: { value: string | null; label: string }[] = [
    { value: null, label: "Tous" },
    ...knownTags.map((name) => ({ value: name, label: name })),
  ];
  const shown = optimistic.filter(
    (row) =>
      !row.missing && !row.abandoned && row.kind === "project" && (tag === null || row.tags.includes(tag)),
  );

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink px-4 py-2">
        <div role="group" aria-label="Filtrer par tag" className="flex flex-wrap pl-px">
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
        {COLUMNS.map(({ status, label }, index) => {
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
              {items.length === 0 ? <p className="px-4 py-5 text-mut">Aucun projet</p> : null}
            </section>
          );
        })}
      </div>
    </main>
  );
}
