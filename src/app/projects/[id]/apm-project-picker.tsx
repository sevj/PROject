"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import type { ApmProblem, ApmProject } from "@/server/apm";
import { linkApmProject, readApmProjects } from "../../actions";
import { useFlash } from "../../flash";
import { useConfirm } from "../../modal";
import { BADGE, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, DATA, FIELD, LABEL, LINK } from "../../ui";

/** Chooses the APM project of this one: from the list APM gives for the token, or by its id when it is not there. */
export function ApmProjectPicker({ projectId, linked }: { projectId: number; linked: boolean }) {
  const messages = useMessages();
  const m = messages.tickets;
  const flash = useFlash();
  const [pending, start] = useTransition();
  const { confirm, confirmation } = useConfirm();
  const [open, setOpen] = useState(!linked);
  const [projects, setProjects] = useState<ApmProject[] | ApmProblem | null>(null);
  const [filter, setFilter] = useState("");
  const [manualId, setManualId] = useState("");

  // Asked to APM's API when the picker first opens, once: the list is kept while the page stays.
  const load = () =>
    start(async () => {
      const read = await readApmProjects();
      setProjects("problem" in read ? read.problem : read.projects);
    });
  const show = () => {
    setOpen(true);
    if (projects === null) load();
  };
  useEffect(() => {
    if (!linked) load();
    // Only for a project not linked yet, which opens on the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const link = (apmProjectId: number | null, done: string) =>
    start(async () => {
      const error = await linkApmProject(projectId, apmProjectId);
      if (error) return flash("error", error);
      flash("success", done);
      setOpen(apmProjectId === null);
      setFilter("");
      setManualId("");
    });

  const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = Array.isArray(projects)
    ? projects.filter((project) => words.every((word) => `${project.id} ${project.name} ${project.client ?? ""}`.toLowerCase().includes(word)))
    : [];

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} className={BUTTON_SMALL} onClick={show}>
          {m.change}
        </button>
        <button
          type="button"
          disabled={pending}
          className={BUTTON_SMALL_DANGER}
          onClick={() => confirm({ ...m.confirmUnlink, action: m.unlink, danger: true, onConfirm: () => link(null, m.unlinked) })}
        >
          {m.unlink}
        </button>
        {confirmation}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <label>
        <span className={`${LABEL} block pb-1`}>{m.pick}</span>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={m.filter}
          autoFocus
          className={`${FIELD} placeholder:text-mut`}
        />
      </label>
      {projects === null ? <p className="text-mut">{m.loadingProjects}</p> : null}
      {typeof projects === "string" ? (
        <p className="text-alert">
          {m.problems[projects]}{" "}
          <Link href="/settings#apm" className={LINK}>
            {m.settings}
          </Link>
        </p>
      ) : null}
      {Array.isArray(projects) ? (
        <div className="max-h-80 overflow-auto border border-rule">
          {shown.length === 0 ? <p className="p-2 text-mut">{m.noMatch}</p> : null}
          {shown.map((project) => (
            <button
              key={project.id}
              type="button"
              disabled={pending}
              onClick={() => link(project.id, m.linked(project.name))}
              className="flex w-full cursor-pointer flex-wrap items-baseline gap-x-2 border-b border-rule px-2.5 py-1.5 text-left last:border-b-0 hover:bg-accent-soft disabled:cursor-default"
            >
              <span className={`${DATA} text-mut`}>#{project.id}</span>
              <span className="min-w-0 break-words">{project.name}</span>
              {project.client ? <span className={`${DATA} text-mut`}>{project.client}</span> : null}
              {project.active ? null : <span className={BADGE}>{m.inactive}</span>}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        action={() => {
          const id = Number(manualId);
          if (!Number.isSafeInteger(id) || id <= 0) return flash("error", m.invalidId);
          link(id, m.linked(`#${id}`));
        }}
      >
        <label className="min-w-[160px] flex-1">
          <span className={`${LABEL} block pb-1`}>{m.manualId}</span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={manualId}
            onChange={(event) => setManualId(event.target.value.trim())}
            required
            className={`${FIELD} ${DATA}`}
          />
        </label>
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {m.save}
        </button>
        {linked ? (
          <button type="button" disabled={pending} className={BUTTON_SMALL} onClick={() => setOpen(false)}>
            {messages.common.cancel}
          </button>
        ) : null}
      </form>
    </div>
  );
}
