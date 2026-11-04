"use client";

import { useOptimistic, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { STATUSES, type RegistryRow } from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { saveNote, toggleFavorite, updateStatus } from "./actions";
import { StarIcon } from "./icons";
import { TagPicker } from "./tag-picker";
import { LABEL } from "./ui";

const CELL = "px-4 pt-3 pb-3.5";

/** Everything decided by hand about a project, in one place. Mount with `key={row.id}`. */
export function ProjectOrganizer({ row, knownTags }: { row: RegistryRow; knownTags: string[] }) {
  const messages = useMessages();
  const m = messages.classification;
  const [, start] = useTransition();
  const [favorite, showFavorite] = useOptimistic(row.favorite);

  return (
    <section aria-label={messages.sheet.organization} className="w-full max-w-[480px] divide-y divide-rule border border-rule bg-panel">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-rule">
        <label className={`${CELL} block hover:bg-sel`}>
          <span className={`${LABEL} block pb-1`}>{m.status}</span>
          <select
            value={row.status ?? ""}
            onChange={(event) => {
              const status = (event.target.value || null) as ProjectStatus | null;
              start(() => updateStatus([row.id], status));
            }}
            className="-ml-1 w-[calc(100%+4px)] cursor-pointer bg-transparent font-medium outline-offset-4"
          >
            <option value="" className="bg-panel">
              {messages.status.none}
            </option>
            {STATUSES.map((status) => (
              <option key={status} value={status} className="bg-panel">
                {messages.status[status]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={favorite}
          onClick={() =>
            start(async () => {
              showFavorite(!favorite);
              await toggleFavorite(row.id, !favorite);
            })
          }
          className={`flex cursor-pointer items-center gap-2 px-4 font-medium hover:bg-sel hover:text-ink ${favorite ? "" : "text-mut"}`}
        >
          <StarIcon filled={favorite} />
          {favorite ? m.isFavorite : m.addToFavorites}
        </button>
      </div>

      <div className={CELL}>
        <div className={`${LABEL} pb-2`}>{messages.tags.label}</div>
        <TagPicker
          showLabel={false}
          projectIds={[row.id]}
          knownTags={knownTags}
          counts={Object.fromEntries(row.tags.map((tag) => [tag, 1]))}
        />
      </div>

      <label className={`${CELL} block focus-within:bg-sel`}>
        <span className={`${LABEL} block pb-1`}>{m.note}</span>
        <textarea
          rows={2}
          defaultValue={row.note ?? ""}
          placeholder={m.notePlaceholder}
          onBlur={(event) => {
            const note = event.target.value;
            if (note !== (row.note ?? "")) start(() => saveNote(row.id, note));
          }}
          className="block w-full resize-y bg-transparent outline-none placeholder:text-mut"
        />
      </label>
    </section>
  );
}
