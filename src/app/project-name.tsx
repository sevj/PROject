"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { renameProject } from "./actions";

export function ProjectName({
  projectId,
  name,
  folderName,
  className,
}: {
  projectId: number;
  name: string;
  folderName: string;
  className: string;
}) {
  const m = useMessages().name;
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
          <span className="sr-only">{m.label}</span>
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

  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h1 className={`${className} min-w-0 break-words`}>{shownName}</h1>
      <button type="button" onClick={open} className="min-h-8 cursor-pointer text-mut underline hover:text-ink">
        {m.rename}
      </button>
    </div>
  );
}
