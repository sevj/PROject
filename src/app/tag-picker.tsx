"use client";

import { useOptimistic, useState, useTransition } from "react";
import { addTagTo, removeTagFrom } from "./actions";
import { FIELD, LABEL } from "./ui";

const TAG =
  "min-h-8 max-w-full cursor-pointer truncate border px-2.5 text-[13px] border-rule hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:font-medium aria-pressed:text-bg aria-[pressed=mixed]:border-dashed aria-[pressed=mixed]:bg-transparent aria-[pressed=mixed]:text-ink";

type Change = { name: string; on: boolean };

/**
 * Lists every tag: a click adds it to the given projects, or removes it when they
 * all carry it. With several projects, a tag only some of them carry shows as mixed.
 */
export function TagPicker({
  projectIds,
  knownTags,
  counts,
}: {
  projectIds: number[];
  knownTags: string[];
  /** For each tag, how many of `projectIds` carry it. */
  counts: Record<string, number>;
}) {
  const [query, setQuery] = useState("");
  const [, start] = useTransition();
  const [changes, applyChange] = useOptimistic<Change[], Change>([], (current, change) => [
    ...current.filter((item) => item.name !== change.name),
    change,
  ]);

  const created = changes.map(({ name }) => name).filter((name) => !knownTags.includes(name));
  const names = [...knownTags, ...created];
  const stateOf = (name: string): "all" | "some" | "none" => {
    const change = changes.find((item) => item.name === name);
    if (change) return change.on ? "all" : "none";
    const count = counts[name] ?? 0;
    if (count === 0) return "none";
    return count === projectIds.length ? "all" : "some";
  };

  const setTag = (name: string, on: boolean) => {
    start(async () => {
      applyChange({ name, on });
      await (on ? addTagTo(projectIds, name) : removeTagFrom(projectIds, name));
    });
  };

  const clean = query.trim().replace(/\s+/g, " ");
  const lower = clean.toLocaleLowerCase("fr");
  const exact = names.find((name) => name.toLocaleLowerCase("fr") === lower);
  const shown = names.filter((name) => name.toLocaleLowerCase("fr").includes(lower));

  const submit = () => {
    if (!clean) return;
    if (exact) {
      if (stateOf(exact) !== "all") setTag(exact, true);
    } else {
      setTag(clean, true);
    }
    setQuery("");
  };

  return (
    <div>
      <div className={`${LABEL} pb-1.5`}>Tags</div>
      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {shown.map((name) => {
            const state = stateOf(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
                title={state === "all" ? `Retirer ${name}` : `Ajouter ${name}`}
                onClick={() => setTag(name, state !== "all")}
                className={TAG}
              >
                {state === "all" ? "✓ " : state === "some" ? "– " : "+ "}
                {name}
              </button>
            );
          })}
        </div>
      ) : null}
      <form
        className="flex gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Chercher ou créer un tag</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={names.length > 0 ? "Chercher ou créer un tag" : "Nom du premier tag"}
            maxLength={80}
            className={`${FIELD} placeholder:text-mut`}
          />
        </label>
        {clean && !exact ? (
          <button type="submit" className="min-h-10 max-w-[55%] cursor-pointer truncate border border-ink px-3 font-medium hover:bg-ink hover:text-bg">
            Créer « {clean} »
          </button>
        ) : null}
      </form>
    </div>
  );
}
