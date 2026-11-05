"use client";

import { useEffect, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { formatSize } from "@/lib/registry";
import { cleanProject, loadCleanable, type ProjectCleanable } from "./cleanup-actions";
import { useFlash } from "./flash";
import { useConfirm } from "./modal";
import { BUTTON, BUTTON_DANGER, CARD, CHECKBOX, DATA, SECTION_TITLE } from "./ui";

function ProjectBlock({ project, showName, onCleaned }: { project: ProjectCleanable; showName: boolean; onCleaned: () => void }) {
  const messages = useMessages();
  const m = messages.cleanup;
  const flash = useFlash();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const size = (bytes: number) => formatSize(bytes, messages.size);
  const selected = project.items.filter(({ name }) => chosen.has(name));
  const total = selected.reduce((sum, { bytes }) => sum + bytes, 0);

  const ask = () =>
    confirm({
      ...m.confirm(project.name, selected.map(({ name }) => name), size(total), project.running),
      action: m.remove,
      danger: true,
      onConfirm: () =>
        start(async () => {
          const result = await cleanProject(project.projectId, selected.map(({ name }) => name), true);
          if ("error" in result) {
            flash("error", result.error);
          } else if (result.failures.length > 0) {
            flash("error", m.failed(result.failures.map(({ name }) => name).join(", ")));
          } else {
            flash("success", m.freed(size(result.freedBytes)));
          }
          setChosen(new Set());
          onCleaned();
        }),
    });

  return (
    <div className="grid gap-1 border-b border-rule py-2 last:border-b-0">
      {showName ? <h3 className="font-semibold break-words">{project.name}</h3> : null}
      {project.items.map(({ name, kind, bytes }) => (
        <label key={name} className="flex cursor-pointer items-center gap-2.5 py-0.5">
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={chosen.has(name)}
            onChange={(event) => {
              const next = new Set(chosen);
              if (event.target.checked) next.add(name);
              else next.delete(name);
              setChosen(next);
            }}
          />
          <span className={`${DATA} min-w-0 flex-1 break-all`}>{name}</span>
          <span className="shrink-0 text-[12px] text-mut">{m.kinds[kind]}</span>
          <span className={`${DATA} w-20 shrink-0 text-right`}>{size(bytes)}</span>
        </label>
      ))}
      {selected.length > 0 ? (
        <div className="pt-1">
          <button type="button" disabled={pending} onClick={ask} className={BUTTON_DANGER}>
            {pending ? messages.common.saving : m.removeSelected(selected.length, size(total))}
          </button>
        </div>
      ) : null}
      {confirmation}
    </div>
  );
}

/** With `projectId`, that project and its folders are read at once. Otherwise, all of them on request. */
export function ProjectCleanup({ projectId }: { projectId?: number }) {
  const messages = useMessages();
  const m = messages.cleanup;
  const [found, setFound] = useState<ProjectCleanable[] | null>(null);
  const [loading, startLoading] = useTransition();
  const size = (bytes: number) => formatSize(bytes, messages.size);

  const load = () => startLoading(async () => setFound(await loadCleanable(projectId)));

  useEffect(() => {
    if (projectId === undefined) return;
    let current = true;
    void loadCleanable(projectId).then((result) => {
      if (current) setFound(result);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, [projectId]);

  const total = (found ?? []).reduce((sum, { items }) => sum + items.reduce((all, { bytes }) => all + bytes, 0), 0);
  const ordered = [...(found ?? [])].sort(
    (a, b) => b.items.reduce((all, { bytes }) => all + bytes, 0) - a.items.reduce((all, { bytes }) => all + bytes, 0),
  );

  return (
    <section className={CARD}>
      <div className={`${SECTION_TITLE} flex flex-wrap items-center justify-between gap-x-4 gap-y-1`}>
        <h2>{m.title}</h2>
        {found && total > 0 ? <span className={DATA}>{size(total)}</span> : null}
      </div>
      <p className="pt-2 text-[12px] text-mut">{m.hint}</p>
      {projectId === undefined ? (
        <div className="pt-3">
          <button type="button" disabled={loading} onClick={load} className={BUTTON}>
            {loading ? m.scanning : found ? m.rescan : m.scan}
          </button>
        </div>
      ) : found === null ? (
        <p className="pt-3 text-mut">{m.scanning}</p>
      ) : null}
      {found?.length === 0 ? <p className="pt-3 text-mut">{m.nothing}</p> : null}
      {found && found.length > 0 ? (
        <div className="pt-2">
          {ordered.map((project) => (
            <ProjectBlock key={project.projectId} project={project} showName={projectId === undefined} onCleaned={load} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
