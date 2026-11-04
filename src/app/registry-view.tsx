"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import {
  countTags,
  countView,
  dockerLabel,
  formatAge,
  formatSize,
  groupRows,
  type ProjectGroup,
  type RegistryRow,
  type RegistrySort,
  type RegistryView as View,
  runningCount,
  selectRows,
  STATUSES,
} from "@/lib/registry";
import type { ProjectStatus } from "@/server/db/schema";
import { markAbandoned, refreshEverything, removeFromList, updateStatus } from "./actions";
import { AddProjectForm, AddSubProjectForm } from "./add-project-form";
import { ClassificationEditor } from "./classification-editor";
import { ProjectDescription } from "./project-description";
import { ProjectDirectory } from "./project-directory";
import { ProjectFacts } from "./project-facts";
import { ProjectName } from "./project-name";
import { TagList } from "./tag-list";
import { TagPicker } from "./tag-picker";
import { BUTTON, CHECKBOX, DATA, LABEL } from "./ui";

const BULK_FIELD = "min-h-10 border border-rule bg-panel px-2.5";
const COLUMNS =
  "grid min-w-[798px] flex-1 grid-cols-[minmax(150px,1.4fr)_104px_100px_56px_68px_134px_56px_64px] items-center gap-x-2.5 pr-4";

const VIEWS: View[] = ["all", "abandoned"];

const PANEL =
  "min-w-0 flex-[1_1_clamp(360px,36vw,560px)] bg-panel px-5 pt-5 pb-6 lg:sticky lg:top-0 lg:h-screen lg:self-start lg:overflow-y-auto";
const PANEL_TITLE = "text-[32px] leading-[1.05] font-bold tracking-tight";
const FILTER =
  "group inline-flex min-h-9 max-w-full cursor-pointer items-center gap-2 border border-rule px-2.5 hover:border-ink aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-bg";
const VIEW_TAB =
  "group -ml-px inline-flex min-h-10 cursor-pointer items-center gap-2 border border-ink px-3 font-medium first:ml-0 aria-pressed:bg-ink aria-pressed:text-bg";

function cellColor(commits: number): string {
  if (commits === 0) return "var(--r0)";
  if (commits < 5) return "var(--r1)";
  if (commits < 20) return "var(--r2)";
  return "var(--r3)";
}

function ActivityStrip({ weeks }: { weeks: number[] | null }) {
  const m = useMessages().registry;
  if (!weeks) return <span className={`${DATA} text-mut`}>—</span>;
  const total = weeks.reduce((sum, commits) => sum + commits, 0);
  return (
    <span className="flex h-4 gap-px" role="img" aria-label={m.activity(total)}>
      {weeks.map((commits, index) => (
        <span
          key={index}
          className="block h-4 w-1"
          style={{ background: cellColor(commits) }}
          title={m.activityWeek(weeks.length - 1 - index, commits)}
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

function GroupHeader({
  group,
  collapsed,
  checkedCount,
  now,
  selected,
  onToggle,
  onSelect,
  onCheck,
}: {
  group: ProjectGroup;
  collapsed: boolean;
  checkedCount: number;
  now: number;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onCheck: (value: boolean) => void;
}) {
  const messages = useMessages();
  const m = messages.registry;
  const total = group.rows.length;
  return (
    <div className={`flex min-h-11 hover:bg-sel ${selected ? "bg-sel shadow-[inset_3px_0_0_var(--ink)]" : "bg-panel"}`}>
      <label className="flex w-9 shrink-0 cursor-pointer items-center justify-center">
        <span className="sr-only">{m.selectGroup(group.name)}</span>
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
      {/* A click anywhere opens the multi-project; its name is the real control for the keyboard. */}
      <div onClick={onSelect} className={`${COLUMNS} min-h-11 cursor-pointer py-1.5 text-left`}>
        <span className="flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? m.expand(group.name) : m.collapse(group.name)}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            className="shrink-0 cursor-pointer font-mono text-mut hover:text-ink"
          >
            {collapsed ? "▸" : "▾"}
          </button>
          <button
            type="button"
            aria-pressed={selected}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className="min-w-0 cursor-pointer truncate text-left font-bold"
          >
            {group.name}
          </button>
        </span>
        <span className={`${DATA} col-span-2 text-mut`}>
          {m.repositoryCount(total)}
        </span>
        <span className={`${DATA} text-right ${group.dirtyCount > 0 ? "font-medium text-alert" : "text-mut"}`}>
          {group.dirtyCount || "—"}
        </span>
        <span className={DATA}>{group.lastCommitAt === null ? "—" : formatAge(group.lastCommitAt, now, messages.age)}</span>
        <ActivityStrip weeks={group.weeklyCommits} />
        <span className={`${DATA} ${group.running > 0 ? "" : "text-mut"}`}>{group.running > 0 ? messages.docker.up(group.running) : "—"}</span>
        <span className={`${DATA} text-right text-mut`}>{formatSize(group.sizeBytes, messages.size)}</span>
      </div>
    </div>
  );
}

function RemoveButton({ projectId, subject }: { projectId: number; subject: string }) {
  const m = useMessages().panel;
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className="mt-3 flex min-h-11 cursor-pointer items-center text-mut underline hover:text-alert"
      onClick={() => {
        if (window.confirm(m.confirmRemoval(subject))) start(() => removeFromList([projectId]));
      }}
    >
      {m.removeFromList}
    </button>
  );
}

function GroupInspector({
  group,
  knownTags,
  onSelect,
  onCreated,
}: {
  group: ProjectGroup;
  knownTags: string[];
  onSelect: (id: number) => void;
  onCreated: (id: number) => void;
}) {
  const m = useMessages().panel;
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label={m.selectedMultiProject} className={PANEL}>
      <ProjectDirectory
        key={`path-${group.parentId}`}
        projectId={group.parentId}
        path={group.path}
        subdirectory={null}
        parentPath={null}
        missing={group.missing}
      />
      <div className="mt-1 mb-4">
        <ProjectName
          key={group.parentId}
          projectId={group.parentId}
          name={group.name}
          folderName={group.folderName}
          className={PANEL_TITLE}
        />
      </div>
      <div className="mb-5">
        <ProjectDescription key={group.parentId} projectId={group.parentId} description={group.description} detected={null} />
      </div>
      <h2 className={`${LABEL} border-b border-ink pb-1`}>{m.repositories}</h2>
      <ul className="mb-4">
        {group.rows.map((row) => (
          <li key={row.id} className="border-b border-rule">
            <button
              type="button"
              onClick={() => onSelect(row.id)}
              className="flex min-h-11 w-full cursor-pointer items-baseline justify-between gap-4 py-2 text-left hover:bg-sel"
            >
              <span className="min-w-0 truncate font-semibold">{row.name}</span>
              <span className={`${DATA} shrink-0 ${row.missing ? "text-alert" : "text-mut"}`}>{row.subdirectory}</span>
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <AddSubProjectForm
          groupId={group.parentId}
          root={group.path}
          knownTags={knownTags}
          onCancel={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            onCreated(id);
          }}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={BUTTON}>
          {m.addRepository}
        </button>
      )}
      <RemoveButton projectId={group.parentId} subject={m.withRepositories(group.name)} />
    </section>
  );
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
  const messages = useMessages();
  const m = messages.bulk;
  const [pending, start] = useTransition();
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!selected.includes(row.id)) continue;
    for (const tag of row.tags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-ink bg-panel px-4 py-2" role="group" aria-label={m.label}>
      <span className="font-semibold">
        {m.selected(selected.length)}
      </span>
      <select
        aria-label={m.changeStatus}
        disabled={pending}
        value=""
        onChange={(event) => {
          const { value } = event.target;
          if (!value) return;
          start(() => updateStatus(selected, value === "none" ? null : (value as ProjectStatus)));
        }}
        className={BULK_FIELD}
      >
        <option value="">{m.statusPlaceholder}</option>
        <option value="none">{messages.status.none}</option>
        {STATUSES.map((status) => (
          <option key={status} value={status}>
            {messages.status[status]}
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
        {view === "abandoned" ? m.restore : m.abandon}
      </button>
      <button
        type="button"
        disabled={pending}
        className={BUTTON}
        onClick={() => {
          if (!window.confirm(messages.panel.confirmRemoval(m.projects(selected.length)))) return;
          start(async () => {
            await removeFromList(selected);
            onClear();
          });
        }}
      >
        {messages.panel.removeFromList}
      </button>
      <button type="button" onClick={onClear} className={BUTTON}>
        {m.deselect}
      </button>
      <div className="w-full max-w-3xl pt-1">
        <TagPicker projectIds={selected} knownTags={knownTags} counts={counts} />
      </div>
    </div>
  );
}

function Inspector({
  row,
  now,
  knownTags,
  onSelect,
}: {
  row: RegistryRow;
  now: number;
  knownTags: string[];
  onSelect: (id: number) => void;
}) {
  const m = useMessages().panel;
  return (
    <section aria-label={m.selectedProject} className={PANEL}>
      {row.parentId !== null ? (
        <button
          type="button"
          onClick={() => row.parentId !== null && onSelect(row.parentId)}
          className="mb-1 block max-w-full cursor-pointer truncate text-mut underline hover:text-ink"
        >
          {row.parentName}
        </button>
      ) : null}
      <ProjectDirectory
        key={`path-${row.id}`}
        projectId={row.id}
        path={row.path}
        subdirectory={row.subdirectory}
        parentPath={row.parentPath}
        missing={row.missing}
      />
      <div className="mt-1 mb-4">
        <ProjectName
          key={row.id}
          projectId={row.id}
          name={row.name}
          folderName={row.folderName}
          className={PANEL_TITLE}
        />
      </div>
      <div className="mb-4">
        <ProjectDescription
          key={row.id}
          projectId={row.id}
          description={row.description}
          detected={row.manifestDescription}
        />
      </div>
      {row.scanError ? <p className={`${DATA} mb-4 break-words text-alert`}>{row.scanError}</p> : null}
      {/* Stays open from one project to the next, to tag several in a row. */}
      <details className="group/tags mb-5 border-y border-rule">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className={`${LABEL} block`}>{m.tags}</span>
            {row.tags.length > 0 ? <TagList tags={row.tags} /> : <span className="text-mut">{m.noTags}</span>}
          </span>
          <span aria-hidden="true" className="font-mono text-mut group-open/tags:rotate-90">
            ▸
          </span>
        </summary>
        <div className="pt-1 pb-3">
          <TagPicker
            key={row.id}
            showLabel={false}
            projectIds={[row.id]}
            knownTags={knownTags}
            counts={Object.fromEntries(row.tags.map((tag) => [tag, 1]))}
          />
        </div>
      </details>
      <ProjectFacts row={row} now={now} />
      <div className="mt-5">
        <ClassificationEditor key={row.id} row={row} />
      </div>
      <Link href={`/projects/${row.id}`} className="mt-3 inline-flex min-h-11 items-center font-medium underline">
        {m.openSheet}
      </Link>
      <RemoveButton projectId={row.id} subject={row.name} />
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
  const messages = useMessages();
  const m = messages.registry;
  const router = useRouter();
  const [view, setView] = useState<View>("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [untagged, setUntagged] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RegistrySort>("commit");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const refresh = () => {
    startRefresh(async () => {
      setRefreshError((await refreshEverything()).error);
    });
  };

  // Sizes arrive after the facts: new values appear as they are measured.
  useEffect(() => {
    if (!sizing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [sizing, router]);

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

  const select = (id: number) => {
    setAdding(false);
    setSelectedId(id);
  };
  /** A filter left on could hide what was just added. */
  const showCreated = (id: number) => {
    setQuery("");
    setSelectedTags([]);
    setUntagged(false);
    setView("all");
    select(id);
  };

  const renderRow = (row: RegistryRow, nested: boolean) => (
    <div
      key={row.id}
      className={`flex min-h-11 hover:bg-sel has-[button[aria-pressed=true]]:bg-sel has-[button[aria-pressed=true]]:shadow-[inset_3px_0_0_var(--ink)] ${nested ? "border-t border-rule" : "border-b border-rule"}`}
    >
      <label className="flex w-9 shrink-0 cursor-pointer items-center justify-center">
        <span className="sr-only">{m.select(row.name)}</span>
        <input
          type="checkbox"
          className={CHECKBOX}
          checked={checked.has(row.id)}
          onChange={(event) => toggleChecked(row.id, event.target.checked)}
        />
      </label>
      <button
        type="button"
        aria-pressed={!showForm && row.id === selected?.id}
        onClick={() => select(row.id)}
        className={`${COLUMNS} min-h-11 cursor-pointer py-1.5 text-left`}
      >
        <span className={`min-w-0 ${nested ? "border-l-2 border-rule pl-3" : ""}`}>
          <span className="block truncate font-semibold">
            {row.favorite ? <span aria-label={m.favorite}>★ </span> : null}
            {row.name}
          </span>
          <TagList tags={row.tags} />
        </span>
        {row.missing ? (
          <span className={`${DATA} truncate font-medium text-alert`}>{m.notFound}</span>
        ) : (
          <span className={`${DATA} truncate text-mut`}>{row.stacks.join(" + ") || "—"}</span>
        )}
        <span className={`${DATA} truncate ${row.hasGit ? "" : "text-mut"}`}>
          {row.hasGit ? (row.branch ?? m.detached) : m.noGit}
        </span>
        <span className={`${DATA} text-right ${(row.dirtyCount ?? 0) > 0 ? "font-medium text-alert" : "text-mut"}`}>
          {row.dirtyCount || "—"}
        </span>
        <span className={DATA}>{row.hasGit ? formatAge(row.lastCommitAt, now, messages.age) : "—"}</span>
        <ActivityStrip weeks={row.weeklyCommits} />
        <span className={`${DATA} ${runningCount(row) > 0 ? "" : "text-mut"}`}>{dockerLabel(row, messages.docker)}</span>
        <span className={`${DATA} text-right text-mut`}>{formatSize(row.sizeBytes, messages.size)}</span>
      </button>
    </div>
  );
  const selectedGroup =
    items.flatMap((item) => (item.kind === "group" && item.group.parentId === selectedId ? [item.group] : []))[0] ?? null;
  const selected = visible.find((row) => row.id === selectedId) ?? (selectedGroup ? null : (visible[0] ?? null));
  const error = refreshError ?? lastScan?.error ?? null;
  // With nothing to show, the panel has only one use.
  const showForm = adding || rows.length === 0;

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink px-4 py-2.5">
        <label className="min-w-[200px] flex-[0_1_260px]">
          <span className="sr-only">{m.search}</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={m.search}
            className={`${DATA} h-10 w-full border border-rule bg-panel px-2.5 placeholder:text-mut`}
          />
        </label>

        <div role="group" aria-label={m.filterByTag} className="flex min-w-0 flex-[1_1_320px] flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={untagged}
            onClick={() => {
              setSelectedTags([]);
              setUntagged((current) => !current);
            }}
            className={FILTER}
          >
            <span>{m.untagged}</span>
            <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{tagCounts.untagged}</span>
          </button>
          {knownTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
              className={FILTER}
            >
              <span className="truncate">{tag}</span>
              <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{tagCounts.counts.get(tag) ?? 0}</span>
            </button>
          ))}
        </div>

        <div role="group" aria-label={m.view} className="flex">
          {VIEWS.map((id) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => switchView(id)} className={VIEW_TAB}>
              <span>{m[id]}</span>
              <span className={`${DATA} text-mut group-aria-pressed:text-bg`}>{countView(rows, id)}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className={`${DATA} text-mut`} role="status">
            {refreshing
              ? m.refreshing
              : sizing
                ? m.sizing
                : lastScan
                  ? m.refreshedAgo(formatAge(lastScan.at, now, messages.age))
                  : null}
          </span>
          <button type="button" onClick={refresh} disabled={refreshing || rows.length === 0} className={BUTTON}>
            {m.refresh}
          </button>
          <button
            type="button"
            aria-pressed={showForm}
            onClick={() => setAdding(true)}
            className={`${BUTTON} bg-ink text-bg hover:bg-transparent hover:text-ink`}
          >
            {m.addProject}
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className={`${DATA} border-b border-alert px-4 py-2 text-alert`}>
          {m.refreshFailed(error)}
        </p>
      ) : null}

      {lastScan?.warning ? (
        <p role="status" className={`${DATA} border-b border-rule px-4 py-2 text-mut`}>
          {m.dockerSilent}
        </p>
      ) : null}

      {checked.size > 0 ? (
        <BulkBar selected={[...checked]} rows={rows} view={view} knownTags={knownTags} onClear={() => setChecked(new Set())} />
      ) : null}

      <div className="flex flex-wrap items-stretch">
        <div className="min-w-0 flex-[999_1_620px] border-r border-rule">
          <div className="overflow-x-auto">
            <div className="flex h-[38px] border-b border-ink">
              <label className="flex w-9 shrink-0 items-center justify-center">
                <span className="sr-only">{m.selectAll}</span>
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={allChecked}
                  onChange={(event) => setCheckedRows(visible, event.target.checked)}
                />
              </label>
              <div className={COLUMNS}>
              <SortButton id="name" sort={sort} onSort={setSort}>{m.columns.project}</SortButton>
              <span className={LABEL}>{m.columns.stack}</span>
              <span className={LABEL}>{m.columns.branch}</span>
              <SortButton id="dirty" sort={sort} onSort={setSort} right>{m.columns.changes}</SortButton>
              <SortButton id="commit" sort={sort} onSort={setSort}>{m.columns.commit}</SortButton>
              <span className={LABEL}>{m.columns.weeks}</span>
              <span className={LABEL}>{m.columns.docker}</span>
              <SortButton id="size" sort={sort} onSort={setSort} right>{m.columns.size}</SortButton>
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
                    selected={!showForm && selectedGroup?.parentId === item.group.parentId}
                    onSelect={() => select(item.group.parentId)}
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
              {rows.length === 0
                ? m.noProjects
                : view === "abandoned" && countView(rows, "abandoned") === 0
                  ? m.noAbandoned
                  : m.noMatch}
            </p>
          ) : null}
          <div className={`${DATA} flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-mut`}>
            <span>{m.shown(visible.length)}</span>
            <span className="flex items-center gap-1.5">
              {m.commitsPerWeek}
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

        {showForm ? (
          <section aria-label={messages.panel.newProject} className={PANEL}>
            <AddProjectForm
              knownTags={knownTags}
              onCreated={showCreated}
              onCancel={rows.length > 0 ? () => setAdding(false) : undefined}
            />
          </section>
        ) : selectedGroup ? (
          <GroupInspector key={selectedGroup.parentId} group={selectedGroup} knownTags={knownTags} onSelect={select} onCreated={showCreated} />
        ) : selected ? (
          <Inspector row={selected} now={now} knownTags={knownTags} onSelect={select} />
        ) : null}
      </div>
    </main>
  );
}
