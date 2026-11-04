"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { moveProject } from "./actions";
import { DirectoryInput } from "./directory-input";
import { PencilIcon } from "./icons";
import { BUTTON, BUTTON_ICON, BUTTON_PRIMARY, DATA } from "./ui";

/** Shows where a project lives, and follows a folder that was moved. */
export function ProjectDirectory({
  projectId,
  path,
  subdirectory,
  parentPath,
  missing,
}: {
  projectId: number;
  path: string;
  /** Set for a sub-project, which is edited relative to its multi-project. */
  subdirectory: string | null;
  parentPath: string | null;
  missing: boolean;
}) {
  const m = useMessages();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className={`${DATA} flex items-start gap-1`}>
        <span className={`min-w-0 pt-1.5 break-all ${missing ? "text-alert" : "text-mut"}`}>
          {path}
          {missing ? ` · ${m.directory.notFound}` : ""}
        </span>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={m.directory.editLabel}
          title={m.directory.editLabel}
          className={BUTTON_ICON}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("directory") ?? "");
        setError(null);
        start(async () => {
          const message = await moveProject(projectId, value);
          if (message) setError(message);
          else setEditing(false);
        });
      }}
    >
      <div>
        <label htmlFor={`directory-${projectId}`} className={`${DATA} block pb-1 break-all text-mut`}>
          {parentPath ? m.directory.subdirectoryOf(parentPath) : m.directory.label}
        </label>
        <DirectoryInput
          id={`directory-${projectId}`}
          name="directory"
          autoFocus
          defaultValue={subdirectory ?? path}
          root={parentPath ?? undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className={`${DATA} break-words text-alert`}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON_PRIMARY}>
          {pending ? m.common.saving : m.common.save}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
          {m.common.cancel}
        </button>
      </div>
    </form>
  );
}
