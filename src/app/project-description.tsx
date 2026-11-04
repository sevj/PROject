"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { saveDescription } from "./actions";
import { PencilIcon, PlusIcon } from "./icons";
import { BUTTON_ICON, BUTTON_SMALL, FIELD } from "./ui";

export function ProjectDescription({
  projectId,
  description,
  detected,
}: {
  projectId: number;
  /** Written by the user. */
  description: string | null;
  /** Found in the project's manifest, shown until the user writes their own. */
  detected: string | null;
}) {
  const m = useMessages().description;
  const [editing, setEditing] = useState(false);
  const [, start] = useTransition();
  const [shown, show] = useOptimistic(description);
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
    if (clean === (description ?? "")) return;
    start(async () => {
      show(clean || null);
      await saveDescription(projectId, clean);
    });
  };

  if (editing) {
    return (
      <label>
        <span className="sr-only">{m.label}</span>
        <textarea
          rows={3}
          maxLength={500}
          defaultValue={description ?? detected ?? ""}
          autoFocus
          placeholder={m.placeholder}
          onBlur={(event) => save(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closed.current = true;
              setEditing(false);
            } else if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              save(event.currentTarget.value);
            }
          }}
          className={`${FIELD} block resize-y py-2 placeholder:text-mut`}
        />
      </label>
    );
  }

  const text = shown ?? detected;
  return (
    text ? (
      <div className="flex items-start gap-1.5">
        <p className={`min-w-0 pt-1 break-words whitespace-pre-line ${shown ? "" : "text-mut"}`}>{text}</p>
        <button type="button" onClick={open} aria-label={m.edit} title={m.edit} className={BUTTON_ICON}>
          <PencilIcon />
        </button>
      </div>
    ) : (
      <button type="button" onClick={open} className={BUTTON_SMALL}>
        <PlusIcon />
        {m.add}
      </button>
    )
  );
}
