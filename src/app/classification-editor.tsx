"use client";

import { useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { STATUSES, type RegistryRow } from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { saveNote, toggleFavorite, updateStatus } from "./actions";
import { FIELD, LABEL } from "./ui";

export function StatusField({ row }: { row: RegistryRow }) {
  const messages = useMessages();
  const [, start] = useTransition();
  return (
    <label>
      <span className={`${LABEL} block pb-1`}>{messages.classification.status}</span>
      <select
        className={FIELD}
        value={row.status ?? ""}
        onChange={(event) => {
          const status = (event.target.value || null) as ProjectStatus | null;
          start(() => updateStatus([row.id], status));
        }}
      >
        <option value="">{messages.status.none}</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {messages.status[status]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Mount with `key={row.id}`: the note field keeps its own text while typing. */
export function ClassificationEditor({ row, showStatus = true }: { row: RegistryRow; showStatus?: boolean }) {
  const m = useMessages().classification;
  const [, start] = useTransition();
  const run = (action: () => Promise<void>) => start(action);

  return (
    <div className="grid gap-3">
      <div className={`grid gap-2 ${showStatus ? "grid-cols-2" : ""}`}>
        {showStatus ? <StatusField row={row} /> : null}
        <div>
          <span className={`${LABEL} block pb-1`}>{m.favorite}</span>
          <button
            type="button"
            aria-pressed={row.favorite}
            onClick={() => run(() => toggleFavorite(row.id, !row.favorite))}
            className={`${FIELD} cursor-pointer text-left hover:border-ink aria-pressed:border-ink`}
          >
            {row.favorite ? m.isFavorite : m.addFavorite}
          </button>
        </div>
      </div>

      <label>
        <span className={`${LABEL} block pb-1`}>{m.note}</span>
        <textarea
          rows={3}
          defaultValue={row.note ?? ""}
          placeholder={m.notePlaceholder}
          onBlur={(event) => {
            if (event.target.value !== (row.note ?? "")) {
              const note = event.target.value;
              run(() => saveNote(row.id, note));
            }
          }}
          className={`${FIELD} block resize-y py-2 placeholder:text-mut`}
        />
      </label>
    </div>
  );
}
