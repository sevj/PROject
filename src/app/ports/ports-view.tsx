"use client";

import Link from "next/link";
import { useState } from "react";
import { useMessages } from "@/i18n/provider";
import type { PortRow } from "@/lib/ports";
import type { PortReport } from "@/server/ports";
import { BADGE, BADGE_ALERT, BUTTON_SMALL, CARD, DATA, FIELD, LINK, PAGE_TITLE } from "../ui";

function Row({ row }: { row: PortRow }) {
  const m = useMessages().ports;
  const collides = row.status !== "ok";
  return (
    <li className={`${CARD} grid gap-2 sm:grid-cols-[9rem_1fr]`} style={collides ? { borderColor: "var(--alert)" } : undefined}>
      <div>
        <p className="text-[22px] leading-tight font-bold tracking-tight tabular-nums">
          {row.port}
          <span className="pl-1 text-[12px] font-normal text-mut">{row.protocol}</span>
        </p>
        {collides ? (
          <p className="pt-1">
            <span className={BADGE_ALERT} title={row.status === "taken" ? m.status.takenHint : m.status.overlapHint}>
              {row.status === "taken" ? m.status.taken : m.status.overlap}
            </span>
          </p>
        ) : null}
      </div>
      <ul className="grid gap-1">
        {row.entries.map((entry) => (
          <li key={`${entry.kind}-${entry.owner}-${entry.address ?? ""}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={BADGE}>{m.kinds[entry.kind]}</span>
            {entry.projectId !== null ? (
              <Link href={`/projects/${entry.projectId}?tab=docker`} className={LINK} title={m.project(entry.projectName ?? "")}>
                {entry.projectName}
              </Link>
            ) : null}
            <span className={DATA}>{entry.label}</span>
            {entry.address ? <span className="text-mut">{m.address(entry.address)}</span> : null}
          </li>
        ))}
      </ul>
    </li>
  );
}

export function PortsView({ report }: { report: PortReport }) {
  const m = useMessages().ports;
  const [onlyCollisions, setOnlyCollisions] = useState(false);
  const [query, setQuery] = useState("");
  const collisions = report.rows.filter((row) => row.status !== "ok").length;
  const needle = query.trim().toLowerCase();
  const shown = report.rows
    .filter((row) => !onlyCollisions || row.status !== "ok")
    .filter(
      (row) =>
        needle === "" ||
        String(row.port).includes(needle) ||
        row.entries.some((entry) => `${entry.projectName ?? ""} ${entry.label}`.toLowerCase().includes(needle)),
    );
  return (
    <div className="grid gap-5">
      <header>
        <h1 className={PAGE_TITLE}>{m.title}</h1>
      </header>
      {report.dockerError ? <p className="text-alert">{m.dockerUnavailable(report.dockerError)}</p> : null}
      {report.hostError ? <p className="text-alert">{m.hostUnavailable(report.hostError)}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <p className={collisions > 0 ? "font-medium text-alert" : "text-mut"}>
          {collisions > 0 ? m.collisions(collisions) : m.noCollision}
        </p>
        <button type="button" aria-pressed={onlyCollisions} onClick={() => setOnlyCollisions(!onlyCollisions)} className={BUTTON_SMALL}>
          {onlyCollisions ? m.showAll : m.onlyCollisions}
        </button>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={m.search}
          aria-label={m.search}
          className={`${FIELD} max-w-72 sm:ml-auto`}
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-mut">{m.none}</p>
      ) : (
        <ul className="grid gap-2">
          {shown.map((row) => (
            <Row key={`${row.port}/${row.protocol}`} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
