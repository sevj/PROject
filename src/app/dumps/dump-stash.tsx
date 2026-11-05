"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { ENGINE_LABELS } from "@/lib/db-engines";
import { type DumpRow, formatStamp, groupByProject, type ProjectDumps } from "@/lib/dumps";
import { formatAge, formatSize } from "@/lib/registry";
import type { DatabaseTarget } from "@/server/dumps/containers";
import type { JobView } from "@/server/dumps/jobs";
import { deleteDump, saveDumpNote } from "../dump-actions";
import { DumpJobs } from "../dump-jobs";
import { DumpModal, LoadModal } from "../dump-modals";
import { Modal, useConfirm } from "../modal";
import { StateGlyph } from "../projects/[id]/state-badge";
import { BUTTON, BUTTON_DANGER, BUTTON_PRIMARY, BUTTON_SMALL, CARD, DATA, LINK, PAGE_TITLE } from "../ui";
import type { StateKind } from "@/lib/docker-state";

const GLYPH: Record<DumpRow["status"], StateKind> = {
  running: "restarting",
  done: "running",
  failed: "failed",
  cancelled: "stopped",
};

function Note({ dump }: { dump: DumpRow }) {
  const m = useMessages().dumps;
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={dump.note ?? ""}
        maxLength={500}
        aria-label={m.editNote}
        onBlur={(event) => {
          setEditing(false);
          if (event.target.value !== (dump.note ?? "")) void saveDumpNote(dump.id, event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setEditing(false);
        }}
        className="min-h-9 w-full border border-accent bg-field px-2 outline-none"
      />
    );
  }
  return (
    <button type="button" onClick={() => setEditing(true)} aria-label={m.editNote} className={`${BUTTON_SMALL} max-w-full justify-start text-left`}>
      <span className={`min-w-0 break-words ${dump.note ? "text-ink" : ""}`}>{dump.note ?? m.notePlaceholder}</span>
    </button>
  );
}

function PickModal({ targets, onPick, onClose }: { targets: DatabaseTarget[]; onPick: (target: DatabaseTarget) => void; onClose: () => void }) {
  const m = useMessages().dumps;
  return (
    <Modal title={m.pick} onClose={onClose}>
      <p className="text-mut">{m.pickHint}</p>
      {targets.length === 0 ? <p>{m.noDatabases}</p> : null}
      <ul className="grid max-h-[50vh] overflow-y-auto border-t border-rule">
        {targets.map((target) => (
          <li key={target.id} className="border-b border-rule">
            <button type="button" onClick={() => onPick(target)} className="flex min-h-12 w-full cursor-pointer items-baseline justify-between gap-4 px-1 py-2 text-left hover:bg-sel">
              <span className="min-w-0">
                <span className="block font-semibold break-all">{target.name}</span>
                <span className={`${DATA} block text-mut`}>{target.projectName}</span>
              </span>
              <span className={`${DATA} shrink-0 text-mut`}>{ENGINE_LABELS[target.engine]}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function ProjectGroup({
  group,
  open,
  onToggle,
  onDump,
  now,
  renderDump,
}: {
  group: ProjectDumps;
  open: boolean;
  onToggle: () => void;
  /** Null when no database of the project is running. */
  onDump: (() => void) | null;
  now: number;
  renderDump: (dump: DumpRow) => ReactNode;
}) {
  const messages = useMessages();
  const m = messages.dumps;
  const panel = `dumps-${group.key.replace(/\W/g, "-")}`;
  return (
    <li className="border border-rule bg-panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pr-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          aria-label={m.groups.toggle(group.projectName)}
          onClick={onToggle}
          className="flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2 text-left hover:bg-sel"
        >
          <span aria-hidden="true" className={`font-mono text-mut transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className="min-w-0">
            <span className="block text-[17px] font-bold break-all">{group.projectName}</span>
            <span className={`${DATA} block text-mut`}>
              {[
                group.dumps.length === 0 ? m.groups.none : m.groups.count(group.dumps.length),
                group.totalBytes > 0 ? m.groups.total(formatSize(group.totalBytes, messages.size)) : null,
                group.lastAt > 0 ? m.groups.last(formatAge(group.lastAt, now, messages.age)) : null,
                group.projectId === null ? m.groups.removed : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        </button>
        <button
          type="button"
          disabled={onDump === null}
          onClick={onDump ?? undefined}
          title={onDump === null ? m.groups.noDatabase : m.groups.dumpTitle(group.projectName)}
          className={BUTTON}
        >
          {m.groups.dump}
        </button>
        {group.projectId === null ? null : (
          <Link href={`/projects/${group.projectId}?tab=docker`} className={LINK} aria-label={m.groups.open(group.projectName)}>
            {messages.dumps.groups.open(group.projectName)}
          </Link>
        )}
      </div>
      {open && group.dumps.length > 0 ? (
        <ul id={panel} className="grid gap-3 border-t border-rule p-3">
          {group.dumps.map(renderDump)}
        </ul>
      ) : null}
    </li>
  );
}

export function DumpStash({
  dumps,
  targets,
  dockerError,
  jobs,
  now,
}: {
  dumps: DumpRow[];
  targets: DatabaseTarget[];
  dockerError: string | null;
  jobs: JobView[];
  now: number;
}) {
  const messages = useMessages();
  const m = messages.dumps;
  const { confirm, confirmation } = useConfirm();
  const [picking, setPicking] = useState(false);
  const [dumping, setDumping] = useState<DatabaseTarget | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // What the user chose by hand; a project alone starts open, the others closed.
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const groups = groupByProject(
    dumps,
    // One entry per project that has a running database, whether or not it has a dump yet.
    [...new Map(targets.flatMap((target) => (target.projectId === null ? [] : [[target.projectId, target.projectName] as const]))).entries()].map(
      ([id, name]) => ({ id, name }),
    ),
  );
  const [picked, setPicked] = useState<DatabaseTarget[] | null>(null);

  // One database dumps straight away; several ask which, among this project's only.
  const dumpFrom = (group: ProjectDumps): (() => void) | null => {
    const own = targets.filter((target) => group.projectId !== null && target.projectId === group.projectId);
    if (own.length === 0) return null;
    return () => (own.length === 1 ? setDumping(own[0]) : setPicked(own));
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className={PAGE_TITLE}>{m.title}</h1>
        </div>
        <button type="button" onClick={() => setPicking(true)} className={BUTTON_PRIMARY}>
          {m.newDump}
        </button>
      </div>

      <DumpJobs initial={jobs} initialNow={now} />

      {dockerError ? (
        <p role="alert" className={`${DATA} border border-alert px-3 py-2 break-words text-alert`}>
          {m.dockerDown(dockerError)}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className={`${DATA} border border-alert px-3 py-2 break-words text-alert`}>
          {failure}
        </p>
      ) : null}

      {dumps.length === 0 ? (
        <div className={CARD}>
          <p className="font-semibold">{m.empty}</p>
          <p className="text-mut">{m.emptyHint}</p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {groups.map((group) => (
            <ProjectGroup
              key={group.key}
              group={group}
              open={chosen.get(group.key) ?? groups.length === 1}
              onToggle={() =>
                setChosen((current) => new Map(current).set(group.key, !(current.get(group.key) ?? groups.length === 1)))
              }
              onDump={dumpFrom(group)}
              now={now}
              renderDump={(dump) => (
            <li key={dump.id} className={`${CARD} ${dump.status === "failed" ? "border-l-[3px] border-l-alert" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="text-[17px] font-bold break-all">{dump.database ?? m.allDatabases}</span>
                    <span className={`${DATA} text-mut`}>{ENGINE_LABELS[dump.engine]}</span>
                  </p>
                  <p className={`${DATA} text-mut`}>{dump.containerName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {dump.status === "done" ? (
                    <>
                      <button type="button" onClick={() => setLoading(dump.id)} className={BUTTON}>
                        {m.load}
                      </button>
                      <a href={`/api/dumps/${dump.id}/file`} download className={BUTTON}>
                        {m.download}
                      </a>
                    </>
                  ) : null}
                  {dump.status !== "running" ? (
                    <button
                      type="button"
                      onClick={() =>
                        confirm({
                          title: m.deleteTitle,
                          body: m.deleteBody(dump.fileName),
                          action: m.delete,
                          danger: true,
                          onConfirm: () => {
                            setFailure(null);
                            void deleteDump(dump.id).then(setFailure);
                          },
                        })
                      }
                      className={BUTTON_DANGER}
                    >
                      {m.delete}
                    </button>
                  ) : null}
                </div>
              </div>

              <p className={`${DATA} mt-3 flex flex-wrap items-center gap-x-4 gap-y-1`}>
                <span className="inline-flex items-center gap-2">
                  <StateGlyph kind={GLYPH[dump.status]} />
                  {m.statuses[dump.status]}
                </span>
                <span title={formatStamp(dump.createdAt)}>
                  {formatStamp(dump.createdAt)} · {messages.facts.ago(formatAge(dump.createdAt, now, messages.age))}
                </span>
                {dump.sizeBytes !== null && dump.rawBytes !== null ? (
                  <span className="text-mut">{m.sizes(formatSize(dump.sizeBytes, messages.size), formatSize(dump.rawBytes, messages.size))}</span>
                ) : null}
              </p>
              <p className={`${DATA} text-mut break-all`}>{dump.fileName}</p>
              {dump.error ? (
                <p role="alert" className={`${DATA} mt-2 max-h-32 overflow-auto break-words whitespace-pre-wrap text-alert`}>
                  {dump.error}
                </p>
              ) : null}
              <div className="mt-2">
                <Note dump={dump} />
              </div>
            </li>
              )}
            />
          ))}
        </ul>
      )}

      {picking ? (
        <PickModal
          targets={targets}
          onClose={() => setPicking(false)}
          onPick={(target) => {
            setPicking(false);
            setDumping(target);
          }}
        />
      ) : null}
      {picked ? (
        <PickModal
          targets={picked}
          onClose={() => setPicked(null)}
          onPick={(target) => {
            setPicked(null);
            setDumping(target);
          }}
        />
      ) : null}
      {dumping ? <DumpModal target={dumping} onClose={() => setDumping(null)} /> : null}
      {loading !== null ? <LoadModal dumps={dumps} targets={targets} dumpId={loading} onClose={() => setLoading(null)} /> : null}
      {confirmation}
    </div>
  );
}
