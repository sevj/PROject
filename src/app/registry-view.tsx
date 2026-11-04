"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  computeStats,
  countView,
  formatAge,
  formatSize,
  type RegistryRow,
  type RegistrySort,
  type RegistryView as View,
  runningCount,
  selectRows,
} from "@/lib/registry";
import { scanNow } from "./actions";

const COLUMNS =
  "grid min-w-[834px] grid-cols-[minmax(150px,1.4fr)_104px_100px_56px_68px_134px_56px_64px] items-center gap-x-2.5 px-4";
const LABEL = "font-mono text-[11px] uppercase tracking-[.06em] text-mut";
const DATA = "font-mono text-[12.5px] tabular-nums";

const VIEWS: { id: View; label: string; alwaysShown: boolean }[] = [
  { id: "all", label: "Tous", alwaysShown: true },
  { id: "dirty", label: "Modifiés", alwaysShown: true },
  { id: "docker", label: "Docker lancé", alwaysShown: true },
  { id: "nogit", label: "Sans git", alwaysShown: true },
  { id: "folders", label: "Autres dossiers", alwaysShown: true },
  { id: "errors", label: "Erreurs de scan", alwaysShown: false },
  { id: "missing", label: "Disparus", alwaysShown: false },
];

function cellColor(commits: number): string {
  if (commits === 0) return "var(--r0)";
  if (commits < 5) return "var(--r1)";
  if (commits < 20) return "var(--r2)";
  return "var(--r3)";
}

function ActivityStrip({ weeks }: { weeks: number[] | null }) {
  if (!weeks) return <span className={`${DATA} text-mut`}>—</span>;
  const total = weeks.reduce((sum, commits) => sum + commits, 0);
  return (
    <span className="flex h-4 gap-px" role="img" aria-label={`${total} commits sur 26 semaines`}>
      {weeks.map((commits, index) => (
        <span
          key={index}
          className="block h-4 w-1"
          style={{ background: cellColor(commits) }}
          title={`Il y a ${weeks.length - 1 - index} sem. : ${commits} commit${commits > 1 ? "s" : ""}`}
        />
      ))}
    </span>
  );
}

function SortButton({
  id,
  sort,
  onSort,
  right,
  children,
}: {
  id: RegistrySort;
  sort: RegistrySort;
  onSort: (sort: RegistrySort) => void;
  right?: boolean;
  children: string;
}) {
  const active = id === sort;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSort(id)}
      className={`${LABEL} h-9 cursor-pointer hover:text-ink ${right ? "text-right" : "text-left"} ${active ? "text-ink" : ""}`}
    >
      {children}
      {active ? " ↓" : ""}
    </button>
  );
}

function Fact({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule py-2">
      <dt className="text-mut">{label}</dt>
      <dd className={`${DATA} truncate ${alert ? "font-medium text-alert" : ""}`}>{value}</dd>
    </div>
  );
}

function dockerLabel(row: RegistryRow): string {
  const running = runningCount(row);
  if (running > 0) return `${running} up`;
  return row.hasCompose || row.containers.length > 0 ? "arrêté" : "—";
}

function Inspector({ row, now }: { row: RegistryRow; now: number }) {
  const ahead = row.upstream ? `+${row.ahead ?? 0} −${row.behind ?? 0}` : "pas de suivi distant";
  return (
    <section aria-label="Projet sélectionné" className="min-w-0 flex-[1_1_340px] bg-panel px-5 pt-5 pb-6">
      <div className={`${DATA} break-all text-mut`}>{row.path}</div>
      <h1 className="mt-1 mb-4 text-[32px] leading-[1.05] font-bold tracking-tight break-words">{row.name}</h1>
      {row.scanError ? <p className={`${DATA} mb-4 break-words text-alert`}>{row.scanError}</p> : null}
      {row.hasGit ? (
        <>
          <div className={`${LABEL} pb-1.5`}>Dernier commit</div>
          <p className="mb-5 break-words">
            {row.lastCommitSubject ?? "Pas encore de commit"}{" "}
            {row.lastCommitAt ? <span className={`${DATA} text-mut`}>{formatAge(row.lastCommitAt, now)}</span> : null}
          </p>
        </>
      ) : null}
      <dl className="border-t border-rule">
        <Fact label="Stack" value={row.stacks.join(" + ") || "—"} />
        <Fact label="Git" value={row.hasGit ? "oui" : "non"} />
        {row.hasGit ? (
          <>
            <Fact label="Branche" value={row.branch ?? "HEAD détachée"} />
            <Fact label="Distant" value={row.remoteUrl ?? "aucun"} />
            <Fact label="Écart" value={ahead} />
            <Fact label="Commits" value={String(row.commitCount ?? 0)} />
            <Fact label="Fichiers modifiés" value={String(row.dirtyCount ?? 0)} alert={(row.dirtyCount ?? 0) > 0} />
          </>
        ) : null}
        <Fact label="Docker" value={dockerLabel(row)} />
        <Fact label="Taille hors dépendances" value={formatSize(row.sizeBytes)} />
      </dl>
    </section>
  );
}

export function RegistryView({
  rows,
  lastScan,
  now,
  sizing,
}: {
  rows: RegistryRow[];
  lastScan: { status: string; at: number; error: string | null; warning: string | null } | null;
  now: number;
  sizing: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RegistrySort>("commit");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, startScan] = useTransition();

  const scan = () => {
    startScan(async () => {
      setScanError((await scanNow()).error);
    });
  };

  // The only automatic scan: the database is empty on the very first launch.
  const neverScanned = lastScan === null;
  useEffect(() => {
    if (neverScanned) scan();
  }, [neverScanned]);

  // Sizes arrive after the scan: new values appear as they are measured.
  useEffect(() => {
    if (!sizing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [sizing, router]);

  const stats = useMemo(() => computeStats(rows, now), [rows, now]);
  const visible = useMemo(() => selectRows(rows, { view, query, sort }), [rows, view, query, sort]);
  const selected = visible.find((row) => row.id === selectedId) ?? visible[0] ?? null;
  const error = scanError ?? lastScan?.error ?? null;

  const statCells = [
    { label: "Projets", value: stats.projects },
    { label: "Sous git", value: stats.git },
    { label: "Modifs non commitées", value: stats.dirty, alert: true },
    { label: "Actifs sur 30 jours", value: stats.active30 },
    { label: "Sans commit depuis 1 an", value: stats.dormant },
    { label: "Conteneurs lancés", value: stats.running },
  ];

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2">
        <label className="min-w-[200px] flex-[0_1_320px]">
          <span className="sr-only">Rechercher un projet</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un projet"
            className={`${DATA} h-10 w-full border border-rule bg-panel px-2.5 placeholder:text-mut`}
          />
        </label>
        <div className="flex items-center gap-3">
          <span className={`${DATA} text-mut`} role="status">
            {scanning
              ? "Scan en cours…"
              : sizing
                ? "Calcul des tailles…"
                : lastScan
                  ? `Scanné il y a ${formatAge(lastScan.at, now)}`
                  : "Jamais scanné"}
          </span>
          <button
            type="button"
            onClick={scan}
            disabled={scanning}
            className="h-10 cursor-pointer border border-ink px-3.5 font-medium hover:bg-ink hover:text-bg disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-ink"
          >
            Rescanner
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className={`${DATA} border-b border-alert px-4 py-2 text-alert`}>
          Le dernier scan a échoué : {error}
        </p>
      ) : null}

      {lastScan?.warning ? (
        <p role="status" className={`${DATA} border-b border-rule px-4 py-2 text-mut`}>
          Docker n&apos;a pas répondu pendant le scan, l&apos;état des conteneurs est inconnu.
        </p>
      ) : null}

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] border-b border-ink">
        {statCells.map(({ label, value, alert }) => (
          <div key={label} className="flex flex-col-reverse border-r border-rule px-4 py-3.5 last:border-r-0">
            <dt className={LABEL}>{label}</dt>
            <dd className={`text-[30px] leading-[1.1] font-semibold tracking-tight tabular-nums ${alert ? "text-alert" : ""}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-stretch">
        <aside className="max-w-full flex-[1_1_208px] border-r border-rule py-3.5">
          <div className={`${LABEL} px-4 pb-2`}>Vues</div>
          {VIEWS.filter(({ id, alwaysShown }) => alwaysShown || countView(rows, id) > 0).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={view === id}
              onClick={() => setView(id)}
              className="group flex min-h-10 w-full cursor-pointer items-center justify-between px-4 text-left hover:bg-sel aria-pressed:bg-ink aria-pressed:text-bg aria-pressed:hover:bg-ink"
            >
              <span>{label}</span>
              <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{countView(rows, id)}</span>
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-[999_1_620px] border-r border-rule">
          <div className="overflow-x-auto">
            <div className={`${COLUMNS} h-[38px] border-b border-ink`}>
              <SortButton id="name" sort={sort} onSort={setSort}>Projet</SortButton>
              <span className={LABEL}>Stack</span>
              <span className={LABEL}>Branche</span>
              <SortButton id="dirty" sort={sort} onSort={setSort} right>Modifs</SortButton>
              <SortButton id="commit" sort={sort} onSort={setSort}>Commit</SortButton>
              <span className={LABEL}>26 semaines</span>
              <span className={LABEL}>Docker</span>
              <SortButton id="size" sort={sort} onSort={setSort} right>Taille</SortButton>
            </div>
            {visible.map((row) => (
              <button
                key={row.id}
                type="button"
                aria-pressed={row.id === selected?.id}
                onClick={() => setSelectedId(row.id)}
                className={`${COLUMNS} h-11 w-full cursor-pointer border-b border-rule text-left hover:bg-sel aria-pressed:bg-sel aria-pressed:shadow-[inset_3px_0_0_var(--ink)]`}
              >
                <span className="truncate font-semibold">
                  {row.parentName ? <span className="font-normal text-mut">{row.parentName} / </span> : null}
                  {row.name}
                </span>
                <span className={`${DATA} truncate text-mut`}>{row.stacks.join(" + ") || "—"}</span>
                <span className={`${DATA} truncate ${row.hasGit ? "" : "text-mut"}`}>
                  {row.hasGit ? (row.branch ?? "détachée") : "sans git"}
                </span>
                <span
                  className={`${DATA} text-right ${(row.dirtyCount ?? 0) > 0 ? "font-medium text-alert" : "text-mut"}`}
                >
                  {row.dirtyCount || "—"}
                </span>
                <span className={DATA}>{row.hasGit ? formatAge(row.lastCommitAt, now) : "—"}</span>
                <ActivityStrip weeks={row.weeklyCommits} />
                <span className={`${DATA} ${runningCount(row) > 0 ? "" : "text-mut"}`}>{dockerLabel(row)}</span>
                <span className={`${DATA} text-right text-mut`}>{formatSize(row.sizeBytes)}</span>
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-mut">
              {scanning ? "Premier scan en cours…" : "Aucun projet ne correspond à ce filtre."}
            </p>
          ) : null}
          <div className={`${DATA} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-mut`}>
            <span>{visible.length} affichés</span>
            <span className="flex items-center gap-1.5">
              Commits par semaine
              {[
                ["var(--r0)", "0"],
                ["var(--r1)", "1–4"],
                ["var(--r2)", "5–19"],
                ["var(--r3)", "20+"],
              ].map(([color, label]) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </span>
          </div>
        </div>

        {selected ? <Inspector row={selected} now={now} /> : null}
      </div>
    </main>
  );
}
