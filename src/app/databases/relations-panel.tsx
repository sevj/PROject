"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { type ForeignKey, layoutRelations, relationsOf, type TableKey, tableId, tableLabel, touching } from "@/lib/db-schema";
import { BUTTON_SMALL, DATA, LABEL, SEGMENT_SMALL } from "../ui";

// The canvas measures the screen: it is drawn in the browser only.
const RelationsCanvas = dynamic(() => import("./relations-canvas").then((module) => module.RelationsCanvas), { ssr: false });

/** What this table points to, and what points to it: each one opens the other table. */
export function TableRelations({
  foreignKeys,
  table,
  onOpen,
}: {
  foreignKeys: ForeignKey[];
  table: TableKey;
  onOpen: (table: TableKey) => void;
}) {
  const m = useMessages().databases.relations;
  const { outgoing, incoming } = relationsOf(foreignKeys, table);
  const groups = [
    { title: m.references, keys: outgoing, other: (key: ForeignKey) => key.to, glyph: "→" },
    { title: m.referencedBy, keys: incoming, other: (key: ForeignKey) => key.from, glyph: "←" },
  ];
  return (
    <>
      {groups.map(({ title, keys, other, glyph }) =>
        keys.length === 0 ? null : (
          <div key={title} className="flex flex-wrap items-center gap-1.5">
            <span className={LABEL}>{title}</span>
            {keys.map((key) => (
              <button
                key={`${tableId(key.from)}/${key.name}`}
                type="button"
                onClick={() => onOpen(other(key))}
                title={m.open(tableLabel(other(key)))}
                className={`${BUTTON_SMALL} ${DATA}`}
              >
                <span aria-hidden="true">{glyph}</span> {tableLabel(other(key))}
                <span className="text-[11px] opacity-70">{key.columns.join(", ")}</span>
              </button>
            ))}
          </div>
        ),
      )}
    </>
  );
}

export function RelationsPanel({
  foreignKeys,
  failure,
  selected,
  tableCount,
  onOpen,
}: {
  /** Null while they are being read. */
  foreignKeys: ForeignKey[] | null;
  failure: string | null;
  selected: TableKey | null;
  tableCount: number;
  onOpen: (table: TableKey) => void;
}) {
  const databases = useMessages().databases;
  const m = databases.relations;
  const [wide, setWide] = useState(false);
  const whole = wide || selected === null;
  const shownKeys = useMemo(
    () => (!foreignKeys ? [] : whole || !selected ? foreignKeys : touching(foreignKeys, selected)),
    [foreignKeys, whole, selected],
  );
  const layout = useMemo(() => layoutRelations(shownKeys), [shownKeys]);

  if (failure) return <p className={`${DATA} text-alert`}>{m.failed(failure)}</p>;
  if (!foreignKeys) return <p className="text-mut">{databases.loading}</p>;
  if (foreignKeys.length === 0) return <p className="text-mut">{m.none}</p>;

  const allTables = new Set(foreignKeys.flatMap(({ from, to }) => [tableId(from), tableId(to)]));
  const unrelated = Math.max(0, tableCount - allTables.size);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {selected ? (
          <div className="flex gap-1">
            <button type="button" aria-pressed={!wide} onClick={() => setWide(false)} className={SEGMENT_SMALL}>
              {tableLabel(selected)}
            </button>
            <button type="button" aria-pressed={wide} onClick={() => setWide(true)} className={SEGMENT_SMALL}>
              {m.wholeDatabase}
            </button>
          </div>
        ) : null}
        <span className="text-[12px] text-mut">
          {m.hint}
          {whole && unrelated > 0 ? ` ${m.unrelated(unrelated)}` : ""}
        </span>
      </div>
      {shownKeys.length === 0 ? (
        <p className="text-mut">{m.tableNone}</p>
      ) : (
        <div className="h-[640px] max-h-[75vh] border border-rule">
          <RelationsCanvas
            key={whole || !selected ? "whole" : tableId(selected)}
            layout={layout}
            showLabels={!whole}
            onOpen={onOpen}
          />
        </div>
      )}
    </div>
  );
}
