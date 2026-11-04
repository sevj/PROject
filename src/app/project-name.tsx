"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { renameProject } from "./actions";

export function ProjectName({
  projectId,
  name,
  folderName,
  className,
  compact = false,
}: {
  projectId: number;
  name: string;
  folderName: string;
  className: string;
  /** For a table row: one line, and not a page heading. */
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  const [shownName, showName] = useOptimistic(name);
  // Enter and Escape unmount the field, which must not count as a second save on blur.
  const closed = useRef(false);

  const open = () => {
    closed.current = false;
    setEditing(true);
  };

  const save = (value: string) => {
    if (closed.current) return;
    closed.current = true;
    setEditing(false);
    const clean = value.trim();
    if (clean === name) return;
    start(async () => {
      showName(clean || folderName);
      await renameProject(projectId, clean);
    });
  };

  if (editing) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save(new FormData(event.currentTarget).get("name") as string);
        }}
      >
        <label>
          <span className="sr-only">Nom du projet, vide pour reprendre le nom du dossier</span>
          <input
            name="name"
            defaultValue={name === folderName ? "" : name}
            placeholder={folderName}
            maxLength={80}
            autoFocus
            onBlur={(event) => save(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                closed.current = true;
                setEditing(false);
              }
            }}
            className={`${className} w-full border border-ink bg-transparent px-1 placeholder:text-mut`}
          />
        </label>
      </form>
    );
  }

  if (compact) {
    return (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={`${className} truncate`}>{shownName}</span>
        <button
          type="button"
          onClick={open}
          aria-label={`Renommer ${shownName}`}
          className="shrink-0 cursor-pointer text-[12px] text-mut underline hover:text-ink"
        >
          Renommer
        </button>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h1 className={`${className} min-w-0 break-words`}>{shownName}</h1>
      <button type="button" onClick={open} className="min-h-8 cursor-pointer text-mut underline hover:text-ink">
        Renommer
      </button>
    </div>
  );
}
