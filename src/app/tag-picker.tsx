"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { addTagTo, removeTagFrom } from "./actions";
import { BUTTON, BUTTON_TOGGLE_SMALL, FIELD, LABEL } from "./ui";

const TAG = `${BUTTON_TOGGLE_SMALL} max-w-full aria-[pressed=mixed]:border-dashed aria-[pressed=mixed]:border-accent aria-[pressed=mixed]:bg-control aria-[pressed=mixed]:text-ink`;

type Change = { name: string; on: boolean };

/**
 * Lists every tag: a click adds it to the given projects, or removes it when they
 * all carry it. With several projects, a tag only some of them carry shows as mixed.
 */
export function TagPicker({
  projectIds,
  knownTags,
  counts,
  showLabel = true,
}: {
  showLabel?: boolean;
  projectIds: number[];
  knownTags: string[];
  /** For each tag, how many of `projectIds` carry it. */
  counts: Record<string, number>;
}) {
  const m = useMessages().tags;
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
      {showLabel ? <div className={`${LABEL} pb-1.5`}>{m.label}</div> : null}
      {shown.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pb-2">
          {shown.map((name) => {
            const state = stateOf(name);
            return (
              <button
                key={name}
                type="button"
                aria-pressed={state === "all" ? true : state === "some" ? "mixed" : false}
                title={state === "all" ? m.remove(name) : m.add(name)}
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
          <span className="sr-only">{m.search}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={names.length > 0 ? m.search : m.first}
            maxLength={80}
            className={`${FIELD} placeholder:text-mut`}
          />
        </label>
        {clean && !exact ? (
          <button type="submit" className={`${BUTTON} max-w-[55%] truncate`}>
            {m.create(clean)}
          </button>
        ) : null}
      </form>
    </div>
  );
}
