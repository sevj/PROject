"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  computeStats,
  countTags,
  countView,
  formatAge,
  formatSize,
  groupRows,
  type ProjectGroup,
  type RegistryRow,
  type RegistrySort,
  type RegistryView as View,
  runningCount,
  selectRows,
  STATUS_LABELS,
} from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { markAbandoned, scanNow, updateStatus } from "./actions";
import { ClassificationEditor } from "./classification-editor";
import { ProjectButtons } from "./project-buttons";
import { TagList } from "./tag-list";
import { TagPicker } from "./tag-picker";
import { BUTTON, CHECKBOX, DATA, LABEL } from "./ui";

const BULK_FIELD = "min-h-10 border border-rule bg-panel px-2.5";
const COLUMNS =
  "grid min-w-[798px] flex-1 grid-cols-[minmax(150px,1.4fr)_104px_100px_56px_68px_134px_56px_64px] items-center gap-x-2.5 pr-4";

const VIEWS: { id: View; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "abandoned", label: "Abandonnés" },
];

const PICK =
  "group flex min-h-10 w-full cursor-pointer items-center justify-between gap-2 px-4 text-left hover:bg-sel aria-pressed:bg-ink aria-pressed:text-bg aria-pressed:hover:bg-ink";

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

function GroupHeader({
  group,
  collapsed,
  checkedCount,
  now,
  onToggle,
  onCheck,
}: {
  group: ProjectGroup;
  collapsed: boolean;
  checkedCount: number;
  now: number;
  onToggle: () => void;
  onCheck: (value: boolean) => void;
}) {
  const total = group.rows.length;
  return (
    <div className="flex min-h-11 bg-panel hover:bg-sel">
      <label className="flex w-9 shrink-0 cursor-pointer items-center justify-center">
        <span className="sr-only">Sélectionner les projets de {group.name}</span>
        <input
          type="checkbox"
          className={CHECKBOX}
          ref={(input) => {
            if (input) input.indeterminate = checkedCount > 0 && checkedCount < total;
          }}
          checked={checkedCount === total}
          onChange={(event) => onCheck(event.target.checked)}
        />
      </label>
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className={`${COLUMNS} min-h-11 cursor-pointer py-1.5 text-left`}
      >
        <span className="flex min-w-0 items-baseline gap-2 font-bold">
          <span aria-hidden="true" className="font-mono text-mut">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className="truncate">{group.name}</span>
        </span>
        <span className={`${DATA} col-span-2 text-mut`}>
          {total} sous-projet{total > 1 ? "s" : ""}
        </span>
        <span className={`${DATA} text-right ${group.dirtyCount > 0 ? "font-medium text-alert" : "text-mut"}`}>
          {group.dirtyCount || "—"}
        </span>
        <span className={DATA}>{group.lastCommitAt === null ? "—" : formatAge(group.lastCommitAt, now)}</span>
        <ActivityStrip weeks={group.weeklyCommits} />
        <span className={`${DATA} ${group.running > 0 ? "" : "text-mut"}`}>{group.running > 0 ? `${group.running} up` : "—"}</span>
        <span className={`${DATA} text-right text-mut`}>{formatSize(group.sizeBytes)}</span>
      </button>
    </div>
  );
}

function dockerLabel(row: RegistryRow): string {
  const running = runningCount(row);
  if (running > 0) return `${running} up`;
  return row.hasCompose || row.containers.length > 0 ? "arrêté" : "—";
}

function BulkBar({
  selected,
  rows,
  view,
  knownTags,
  onClear,
}: {
  selected: number[];
  rows: RegistryRow[];
  view: View;
  knownTags: string[];
  onClear: () => void;
}) {
  const [pending, start] = useTransition();
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!selected.includes(row.id)) continue;
    for (const tag of row.tags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-ink bg-panel px-4 py-2" role="group" aria-label="Actions groupées">
      <span className="font-semibold">
        {selected.length} sélectionné{selected.length > 1 ? "s" : ""}
      </span>
      <select
        aria-label="Changer le statut"
        disabled={pending}
        value=""
        onChange={(event) => {
          const { value } = event.target;
          if (!value) return;
          start(() => updateStatus(selected, value === "none" ? null : (value as ProjectStatus)));
        }}
        className={BULK_FIELD}
      >
        <option value="">Statut…</option>
        <option value="none">Sans statut</option>
        {Object.entries(STATUS_LABELS).map(([status, label]) => (
          <option key={status} value={status}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending}
        className={BUTTON}
        onClick={() =>
          start(async () => {
            await markAbandoned(selected, view !== "abandoned");
            onClear();
          })
        }
      >
        {view === "abandoned" ? "Restaurer" : "Abandonner"}
      </button>
      <button type="button" onClick={onClear} className={BUTTON}>
        Désélectionner
      </button>
      <div className="w-full max-w-3xl pt-1">
        <TagPicker projectIds={selected} knownTags={knownTags} counts={counts} />
      </div>
    </div>
  );
}

function Inspector({ row, now, knownTags }: { row: RegistryRow; now: number; knownTags: string[] }) {
  const ahead = row.upstream ? `+${row.ahead ?? 0} −${row.behind ?? 0}` : "pas de suivi distant";
  return (
    <section aria-label="Projet sélectionné" className="min-w-0 flex-[1_1_340px] bg-panel px-5 pt-5 pb-6">
      <div className={`${DATA} break-all text-mut`}>{row.path}</div>
      <h1 className="mt-1 mb-4 text-[32px] leading-[1.05] font-bold tracking-tight break-words">{row.name}</h1>
      {row.scanError ? <p className={`${DATA} mb-4 break-words text-alert`}>{row.scanError}</p> : null}
      <div className="mb-5">
        <ProjectButtons key={row.id} row={row} />
      </div>
      <div className="mb-5">
        <TagPicker
          key={row.id}
          projectIds={[row.id]}
          knownTags={knownTags}
          counts={Object.fromEntries(row.tags.map((tag) => [tag, 1]))}
        />
      </div>
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
      <div className="mt-5">
        <ClassificationEditor key={row.id} row={row} />
      </div>
      <Link href={`/projects/${row.id}`} className="mt-3 inline-flex min-h-11 items-center font-medium underline">
        Ouvrir la fiche complète
      </Link>
    </section>
  );
}

export function RegistryView({
  rows,
  lastScan,
  now,
  sizing,
  knownTags,
}: {
  rows: RegistryRow[];
  knownTags: string[];
  lastScan: { status: string; at: number; error: string | null; warning: string | null } | null;
  now: number;
  sizing: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untagged, setUntagged] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
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
  const visible = useMemo(
    () => selectRows(rows, { view, query, sort, tags: selectedTags, untagged }),
    [rows, view, query, sort, selectedTags, untagged],
  );
  const tagCounts = useMemo(() => countTags(rows, view), [rows, view]);
  // A tag removed from its last project must not keep filtering the list on its own.
  const activeTags = selectedTags.filter((tag) => knownTags.includes(tag));
  if (activeTags.length !== selectedTags.length) setSelectedTags(activeTags);

  const switchView = (next: View) => {
    setView(next);
    setSelectedTags([]);
    setUntagged(false);
    // A selection left in the other view would be acted on without being visible.
    setChecked(new Set());
  };
  const toggleTag = (tag: string) => {
    setUntagged(false);
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag],
    );
  };
  const allChecked = visible.length > 0 && visible.every((row) => checked.has(row.id));
  const toggleChecked = (id: number, value: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const setCheckedRows = (list: RegistryRow[], value: boolean) => {
    setChecked((current) => {
      const next = new Set(current);
      for (const row of list) {
        if (value) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  };
  // In the abandoned view, the folder's size would describe what was left behind, not these projects.
  const items = useMemo(() => groupRows(visible, { useFolderSize: view !== "abandoned" }), [visible, view]);
  const toggleGroup = (parentId: number) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  };

  const renderRow = (row: RegistryRow, nested: boolean) => (
    <div
      key={row.id}
      className={`flex min-h-11 hover:bg-sel has-[button[aria-pressed=true]]:bg-sel has-[button[aria-pressed=true]]:shadow-[inset_3px_0_0_var(--ink)] ${nested ? "border-t border-rule" : "border-b border-rule"}`}
    >
      <label className="flex w-9 shrink-0 cursor-pointer items-center justify-center">
        <span className="sr-only">Sélectionner {row.name}</span>
        <input
          type="checkbox"
          className={CHECKBOX}
          checked={checked.has(row.id)}
          onChange={(event) => toggleChecked(row.id, event.target.checked)}
        />
      </label>
      <button
        type="button"
        aria-pressed={row.id === selected?.id}
        onClick={() => setSelectedId(row.id)}
        className={`${COLUMNS} min-h-11 cursor-pointer py-1.5 text-left`}
      >
        <span className={`min-w-0 ${nested ? "border-l-2 border-rule pl-3" : ""}`}>
          <span className="block truncate font-semibold">
            {row.favorite ? <span aria-label="Favori">★ </span> : null}
            {row.name}
          </span>
          <TagList tags={row.tags} />
        </span>
        <span className={`${DATA} truncate text-mut`}>{row.stacks.join(" + ") || "—"}</span>
        <span className={`${DATA} truncate ${row.hasGit ? "" : "text-mut"}`}>
          {row.hasGit ? (row.branch ?? "détachée") : "sans git"}
        </span>
        <span className={`${DATA} text-right ${(row.dirtyCount ?? 0) > 0 ? "font-medium text-alert" : "text-mut"}`}>
          {row.dirtyCount || "—"}
        </span>
        <span className={DATA}>{row.hasGit ? formatAge(row.lastCommitAt, now) : "—"}</span>
        <ActivityStrip weeks={row.weeklyCommits} />
        <span className={`${DATA} ${runningCount(row) > 0 ? "" : "text-mut"}`}>{dockerLabel(row)}</span>
        <span className={`${DATA} text-right text-mut`}>{formatSize(row.sizeBytes)}</span>
      </button>
    </div>
  );
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

      {checked.size > 0 ? (
        <BulkBar selected={[...checked]} rows={rows} view={view} knownTags={knownTags} onClear={() => setChecked(new Set())} />
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
          {VIEWS.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => switchView(id)} className={PICK}>
              <span>{label}</span>
              <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{countView(rows, id)}</span>
            </button>
          ))}
          <div className={`${LABEL} px-4 pt-5 pb-2`}>Tags</div>
          <button
            type="button"
            aria-pressed={untagged}
            onClick={() => {
              setSelectedTags([]);
              setUntagged((current) => !current);
            }}
            className={PICK}
          >
            <span>Sans tag</span>
            <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{tagCounts.untagged}</span>
          </button>
          {knownTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
              className={PICK}
            >
              <span className="truncate">{tag}</span>
              <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{tagCounts.counts.get(tag) ?? 0}</span>
            </button>
          ))}
        </aside>

        <div className="min-w-0 flex-[999_1_620px] border-r border-rule">
          <div className="overflow-x-auto">
            <div className="flex h-[38px] border-b border-ink">
              <label className="flex w-9 shrink-0 items-center justify-center">
                <span className="sr-only">Tout sélectionner</span>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={allChecked}
                  onChange={(event) => setCheckedRows(visible, event.target.checked)}
                />
              </label>
              <div className={COLUMNS}>
              <SortButton id="name" sort={sort} onSort={setSort}>Projet</SortButton>
              <span className={LABEL}>Stack</span>
              <span className={LABEL}>Branche</span>
              <SortButton id="dirty" sort={sort} onSort={setSort} right>Modifs</SortButton>
              <SortButton id="commit" sort={sort} onSort={setSort}>Commit</SortButton>
              <span className={LABEL}>26 semaines</span>
              <span className={LABEL}>Docker</span>
              <SortButton id="size" sort={sort} onSort={setSort} right>Taille</SortButton>
              </div>
            </div>
            {items.map((item) =>
              item.kind === "project" ? (
                renderRow(item.row, false)
              ) : (
                <div
                  key={`group-${item.group.parentId}`}
                  role="group"
                  aria-label={item.group.name}
                  className="border-y border-ink"
                >
                  <GroupHeader
                    group={item.group}
                    collapsed={collapsedGroups.has(item.group.parentId)}
                    checkedCount={item.group.rows.filter((row) => checked.has(row.id)).length}
                    now={now}
                    onToggle={() => toggleGroup(item.group.parentId)}
                    onCheck={(value) => setCheckedRows(item.group.rows, value)}
                  />
                  {collapsedGroups.has(item.group.parentId) ? null : item.group.rows.map((row) => renderRow(row, true))}
                </div>
              ),
            )}
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-mut">
              {scanning
                ? "Premier scan en cours…"
                : view === "abandoned" && countView(rows, "abandoned") === 0
                  ? "Aucun projet abandonné."
                  : "Aucun projet ne correspond à ce filtre."}
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

        {selected ? <Inspector row={selected} now={now} knownTags={knownTags} /> : null}
      </div>
    </main>
  );
}
