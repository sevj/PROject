"use client";

import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { moveProject } from "./actions";
import { BUTTON, DATA, FIELD } from "./ui";

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
      <div className={`${DATA} break-all`}>
        <span className={missing ? "text-alert" : "text-mut"}>{path}</span>{" "}
        {missing ? <span className="text-alert">{m.directory.notFound} </span> : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={m.directory.editLabel}
          className="cursor-pointer text-mut underline hover:text-ink"
        >
          {m.directory.edit}
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
      <label>
        <span className={`${DATA} block pb-1 break-all text-mut`}>
          {parentPath ? m.directory.subdirectoryOf(parentPath) : m.directory.label}
        </span>
        <input
          name="directory"
          required
          maxLength={1024}
          autoFocus
          spellCheck={false}
          defaultValue={subdirectory ?? path}
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
          }}
          className={`${FIELD} ${DATA}`}
        />
      </label>
      {error ? (
        <p role="alert" className={`${DATA} break-words text-alert`}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? m.common.saving : m.common.save}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
          {m.common.cancel}
        </button>
      </div>
    </form>
  );
}
