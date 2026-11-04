"use client";

import { useState, useTransition } from "react";
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
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className={`${DATA} break-all`}>
        <span className={missing ? "text-alert" : "text-mut"}>{path}</span>{" "}
        {missing ? <span className="text-alert">introuvable </span> : null}
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Modifier le répertoire"
          className="cursor-pointer text-mut underline hover:text-ink"
        >
          Modifier
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
          {parentPath ? `Sous-répertoire de ${parentPath}` : "Répertoire"}
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
          {pending ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" onClick={() => setEditing(false)} className={BUTTON}>
          Annuler
        </button>
      </div>
    </form>
  );
}
