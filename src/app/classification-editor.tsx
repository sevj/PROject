"use client";

import { useTransition } from "react";
import { STATUS_LABELS, type RegistryRow } from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { addTagTo, removeTagFrom, saveNote, toggleFavorite, updateStatus } from "./actions";
import { DATA, FIELD, LABEL } from "./ui";

/** Mount with `key={row.id}`: the note field keeps its own text while typing. */
export function ClassificationEditor({ row, knownTags }: { row: RegistryRow; knownTags: string[] }) {
  const [, start] = useTransition();
  const run = (action: () => Promise<void>) => start(action);

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className={`${LABEL} block pb-1`}>Statut</span>
          <select
            className={FIELD}
            value={row.status ?? ""}
            onChange={(event) =>
              run(() => updateStatus([row.id], (event.target.value || null) as ProjectStatus | null))
            }
          >
            <option value="">Sans statut</option>
            {Object.entries(STATUS_LABELS).map(([status, label]) => (
              <option key={status} value={status}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className={`${LABEL} block pb-1`}>Favori</span>
          <button
            type="button"
            aria-pressed={row.favorite}
            onClick={() => run(() => toggleFavorite(row.id, !row.favorite))}
            className={`${FIELD} cursor-pointer text-left hover:border-ink aria-pressed:border-ink`}
          >
            {row.favorite ? "★ Favori" : "☆ Ajouter"}
          </button>
        </div>
      </div>

      <div>
        <span className={`${LABEL} block pb-1`}>Tags</span>
        {row.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {row.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                aria-label={`Retirer le tag ${tag}`}
                onClick={() => run(() => removeTagFrom([row.id], tag))}
                className={`${DATA} min-h-7 cursor-pointer border border-rule px-2 hover:border-alert hover:text-alert`}
              >
                {tag} ×
              </button>
            ))}
          </div>
        ) : null}
        <form
          action={(data) => {
            const name = String(data.get("tag") ?? "");
            run(() => addTagTo([row.id], name));
          }}
        >
          <label>
            <span className="sr-only">Ajouter un tag</span>
            <input
              name="tag"
              list={`known-tags-${row.id}`}
              placeholder="Ajouter un tag, puis Entrée"
              className={`${FIELD} placeholder:text-mut`}
              maxLength={80}
            />
          </label>
          <datalist id={`known-tags-${row.id}`}>
            {knownTags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </form>
      </div>

      <label>
        <span className={`${LABEL} block pb-1`}>Note</span>
        <textarea
          rows={3}
          defaultValue={row.note ?? ""}
          placeholder="Prochaine étape, point à ne pas oublier"
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
