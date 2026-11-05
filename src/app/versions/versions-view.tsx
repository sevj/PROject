"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { PRODUCT_LABELS, type SupportState } from "@/lib/versions";
import type { VersionCell, VersionsReport } from "@/server/versions";
import { BUTTON, CARD, DATA, LABEL, LINK, PAGE_TITLE } from "../ui";
import { reloadSupportDates } from "./actions";

const TONE: Record<SupportState, string> = {
  eol: "bg-alert/20 text-alert",
  soon: "bg-[color-mix(in_srgb,var(--series-4)_22%,transparent)] text-[var(--series-4)]",
  security: "bg-sel text-ink",
  active: "bg-ok/15 text-ok",
  unknown: "bg-sel text-mut",
};

function Cell({ cell }: { cell: VersionCell | undefined }) {
  const m = useMessages().versions;
  if (!cell) return <td className="border-t border-rule px-2 py-2 text-mut">·</td>;
  const lines = [
    `${m.detail.from} ${cell.from}`,
    `${m.detail.line} ${cell.line ?? m.detail.none}`,
    `${m.detail.activeUntil} ${cell.eoasFrom ?? m.detail.none}`,
    `${m.detail.eolOn} ${cell.eolFrom ?? m.detail.none}`,
    `${m.detail.latest} ${cell.latest ?? m.detail.none}`,
  ];
  return (
    <td className="border-t border-rule px-2 py-2 align-top">
      <span title={lines.join("\n")} className={`${DATA} inline-grid cursor-help gap-0.5 px-1.5 py-0.5 ${TONE[cell.support]}`}>
        <span>
          {cell.version}
          {cell.source === "constraint" ? <span className="opacity-70"> ({m.sources.constraint})</span> : null}
        </span>
        <span className="text-[11px] opacity-80">
          {m.states[cell.support]}
          {cell.eolFrom && cell.support !== "active" ? ` · ${cell.eolFrom}` : ""}
        </span>
      </span>
    </td>
  );
}

export function VersionsView({ report }: { report: VersionsReport }) {
  const m = useMessages().versions;
  const [pending, start] = useTransition();
  const all = report.rows.flatMap(({ cells }) => cells);
  const count = (state: SupportState) => all.filter(({ support }) => support === state).length;

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[80ch]">
          <h1 className={PAGE_TITLE}>{m.title}</h1>
        </div>
        <button type="button" disabled={pending} onClick={() => start(() => reloadSupportDates())} className={BUTTON}>
          {pending ? m.reloading : m.reload}
        </button>
      </div>

      <p className={`${DATA} text-mut`}>
        {report.fetchedAt ? m.fetchedAt(new Date(report.fetchedAt).toLocaleString()) : m.never}
        {all.length > 0 ? ` · ${m.summary(count("eol"), count("soon"))}` : null}
      </p>
      {report.failed.length > 0 ? <p className="text-alert">{m.failed(report.failed.map((product) => PRODUCT_LABELS[product]).join(", "))}</p> : null}

      {report.rows.length === 0 ? (
        <p className="text-mut">{m.none}</p>
      ) : (
        <div className={`${CARD} overflow-x-auto p-0`}>
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className={LABEL}>
                <th className="px-3 py-2 font-normal">{m.project}</th>
                {report.products.map((product) => (
                  <th key={product} className="px-2 py-2 font-normal">
                    {PRODUCT_LABELS[product]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.id}>
                  <td className="border-t border-rule px-3 py-2 align-top">
                    <Link href={`/projects/${row.id}`} className={`${LINK} font-semibold`}>
                      {row.name}
                    </Link>
                    {row.parentName ? <span className={`${DATA} block text-mut`}>{row.parentName}</span> : null}
                  </td>
                  {report.products.map((product) => (
                    <Cell key={product} cell={row.cells.find((cell) => cell.product === product)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
