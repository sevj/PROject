"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { BROWSABLE_LABELS } from "@/lib/db-engines";
import { followFilter, type ForeignKey, linksOf, type RowFilter, type TableKey, tableLabel } from "@/lib/db-schema";
import { formatAge } from "@/lib/registry";
import type { QueryResult } from "@/lib/sql-result";
import type { ColumnInfo, TableInfo } from "@/server/databases";
import type { DatabaseTarget as ServerTarget, RedisContainer } from "@/server/dumps/containers";
import type { SqliteTarget } from "@/server/sqlite";
import type { HistoryEntry } from "@/server/query-history";
import type { Plan } from "@/lib/explain";
import { BADGE, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, CHECKBOX, DATA, FIELD, LABEL, LINK, SECTION_TITLE, PAGE_TITLE } from "../ui";
import {
  clearProjectHistory,
  executeFilter,
  explainSql,
  executeSql,
  loadColumns,
  loadDatabases,
  loadForeignKeys,
  loadHistory,
  loadPage,
  loadTables,
} from "./actions";
import { PlanView } from "./plan-view";
import { RedisBrowser } from "./redis-browser";
import { RelationsPanel, TableRelations } from "./relations-panel";

type Tab = "browse" | "query" | "relations";
type Output = { result: QueryResult; elapsedMs: number; hasMore: boolean };
type DatabaseTarget = ServerTarget | SqliteTarget | RedisContainer;
/** Where to come back to after following a key. */
type Visit = { table: TableKey; page: number; filter: RowFilter | null };
type Relations = { foreignKeys: ForeignKey[] | null; failure: string | null };
const NO_RELATIONS: Relations = { foreignKeys: null, failure: null };

function ResultTable({
  result,
  links,
  onFollow,
}: {
  result: QueryResult;
  /** The columns that are foreign keys: their values lead to the row they designate. */
  links?: Map<string, ForeignKey>;
  onFollow?: (key: ForeignKey, filter: RowFilter) => void;
}) {
  const m = useMessages().databases;
  if (result.columns.length === 0) return <p className="text-mut">{m.noRows}</p>;
  return (
    <div className="max-h-[560px] overflow-auto border border-rule">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 bg-panel">
          <tr>
            {result.columns.map((column, index) => (
              <th key={`${column}-${index}`} className={`${LABEL} border-b border-rule-strong px-2 py-1.5 font-normal whitespace-nowrap`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-rule align-top">
              {row.map((cell, index) => {
                const shown = cell === null ? m.nullValue : cell.length > 2000 ? `${cell.slice(0, 2000)}…` : cell;
                const key = links?.get(result.columns[index]);
                const filter = key ? followFilter(key, result.columns, row) : null;
                return (
                  <td key={index} className={`${DATA} max-w-[420px] px-2 py-1 break-words whitespace-pre-wrap ${cell === null ? "text-mut italic" : ""}`}>
                    {key && filter && onFollow ? (
                      <button type="button" title={m.relations.follow(tableLabel(key.to))} onClick={() => onFollow(key, filter)} className={`${LINK} text-left`}>
                        {shown}
                      </button>
                    ) : (
                      shown
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 ? <p className="p-2 text-mut">{m.noRows}</p> : null}
    </div>
  );
}

function Summary({ output, limit }: { output: Output; limit: number }) {
  const m = useMessages().databases;
  return (
    <p className="text-mut">
      {m.rows(output.result.rows.length)} · {m.elapsed(output.elapsedMs)}
      {output.result.truncated ? ` · ${m.truncated(limit)}` : ""}
    </p>
  );
}

export function DatabasesView({
  targets,
  error,
  initialContainer,
  histories,
  initialNow,
}: {
  targets: DatabaseTarget[];
  error: string | null;
  initialContainer: string | null;
  histories: Record<number, HistoryEntry[]>;
  initialNow: number;
}) {
  const messages = useMessages();
  const m = messages.databases;
  const [containerId, setContainerId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState("");
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selected, setSelected] = useState<TableKey | null>(null);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [relations, setRelations] = useState<Relations>(NO_RELATIONS);
  const [rowFilter, setRowFilter] = useState<RowFilter | null>(null);
  const [trail, setTrail] = useState<Visit[]>([]);
  const [tab, setTab] = useState<Tab>("browse");
  const [page, setPage] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [plan, setPlan] = useState<{ plan: Plan; elapsedMs: number } | null>(null);
  const [analyze, setAnalyze] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [history, setHistory] = useState(histories);
  const [now, setNow] = useState(initialNow);

  const target = targets.find(({ id }) => id === containerId) ?? null;
  const mongo = target?.engine === "mongodb";
  const redis = target?.engine === "redis";
  const entries = target ? (history[target.projectId] ?? []) : [];
  const shownTab: Tab = tab === "relations" && mongo ? "browse" : tab;
  const links = useMemo(() => (selected ? linksOf(relations.foreignKeys ?? [], selected) : undefined), [relations.foreignKeys, selected]);
  const engine = target?.engine;

  // Read once per database, beside the rest: a failure here leaves the rows without links, and nothing else.
  useEffect(() => {
    if (!containerId || !database || engine === undefined || engine === "mongodb" || engine === "redis") return;
    let stale = false;
    void loadForeignKeys(containerId, database).then((result) => {
      if (stale) return;
      setRelations("error" in result ? { foreignKeys: null, failure: result.error } : { foreignKeys: result.foreignKeys, failure: null });
    });
    return () => {
      stale = true;
    };
  }, [containerId, database, engine]);

  const groups = useMemo(() => {
    const byProject = new Map<string, DatabaseTarget[]>();
    for (const item of targets) byProject.set(item.projectName, [...(byProject.get(item.projectName) ?? []), item]);
    return [...byProject.entries()];
  }, [targets]);

  const fail = (reason: string | null) => setFailure(reason);

  const pickContainer = async (id: string | null) => {
    setContainerId(id);
    setDatabases([]);
    setDatabase("");
    setTables([]);
    setSelected(null);
    setColumns([]);
    setOutput(null);
    setRelations(NO_RELATIONS);
    setRowFilter(null);
    setTrail([]);
    fail(null);
    if (!id) return;
    setBusy("databases");
    const result = await loadDatabases(id);
    setBusy(null);
    if ("error" in result) return fail(result.error);
    setDatabases(result.databases);
    const preferred = result.databases.includes(result.defaultDatabase ?? "") ? (result.defaultDatabase ?? "") : (result.databases[0] ?? "");
    if (preferred) await pickDatabase(id, preferred);
  };

  const pickDatabase = async (id: string, name: string) => {
    setDatabase(name);
    setTables([]);
    setSelected(null);
    setColumns([]);
    setOutput(null);
    setRelations(NO_RELATIONS);
    setRowFilter(null);
    setTrail([]);
    fail(null);
    if (!name) return;
    setBusy("tables");
    const result = await loadTables(id, name);
    setBusy(null);
    if ("error" in result) return fail(result.error);
    setTables(result.tables);
  };

  const openTable = async (table: TableKey, pageNumber = 0, filter: RowFilter | null = null) => {
    if (!containerId) return;
    const sameTable = selected?.name === table.name && selected.schema === table.schema;
    setSelected(table);
    setRowFilter(filter);
    setTab("browse");
    setPage(pageNumber);
    fail(null);
    setBusy("rows");
    const [cols, rows] = await Promise.all([
      pageNumber === 0 || !sameTable ? loadColumns(containerId, database, table.schema, table.name) : Promise.resolve(null),
      loadPage(containerId, database, table.schema, table.name, pageNumber, filter),
    ]);
    setBusy(null);
    if (cols) setColumns("error" in cols ? [] : cols.columns);
    if ("error" in rows) {
      setOutput(null);
      return fail(rows.error);
    }
    setOutput({ result: rows.result, elapsedMs: rows.elapsedMs, hasMore: rows.hasMore });
  };

  /** Choosing a table starts over; only following a key can be come back from. */
  const chooseTable = (table: TableKey) => {
    setTrail([]);
    void openTable(table);
  };

  const followKey = (key: ForeignKey, filter: RowFilter) => {
    if (selected) setTrail((current) => [...current, { table: selected, page, filter: rowFilter }]);
    void openTable(key.to, 0, filter);
  };

  const goBack = () => {
    const last = trail.at(-1);
    if (!last) return;
    setTrail(trail.slice(0, -1));
    void openTable(last.table, last.page, last.filter);
  };

  const refreshHistory = async () => {
    if (!target) return;
    const entriesNow = await loadHistory(target.projectId);
    setHistory((current) => ({ ...current, [target.projectId]: entriesNow }));
    setNow(Date.now());
  };

  const run = async (pageNumber = 0) => {
    if (!containerId || !database) return;
    fail(null);
    setBusy("query");
    setPlan(null);
    setPage(pageNumber);
    const result = mongo
      ? await executeFilter(containerId, database, selected?.name ?? "", text, pageNumber)
      : await executeSql(containerId, database, text);
    setBusy(null);
    if ("error" in result) {
      setOutput(null);
      fail(result.error);
    } else {
      setOutput(result);
    }
    void refreshHistory();
  };

  const explain = async () => {
    if (!containerId || !database) return;
    fail(null);
    setBusy("explain");
    setOutput(null);
    setPlan(null);
    const result = await explainSql(containerId, database, text, analyze);
    setBusy(null);
    if ("error" in result) fail(result.error);
    else setPlan(result);
  };

  // The page can be opened on a given container, from a link.
  const opener = useRef(pickContainer);
  useEffect(() => {
    opener.current = pickContainer;
  });
  useEffect(() => {
    if (initialContainer) void opener.current(initialContainer);
  }, [initialContainer]);

  // SQLite files do not need Docker: when it is down, they are still there to open.
  if (error && targets.length === 0) return <p className="text-alert">{messages.errors.dockerUnavailable(error)}</p>;

  const statements = text.trim();
  return (
    <div className="grid gap-5">
      <header>
        <h1 className={PAGE_TITLE}>{m.title}</h1>
        {error ? <p className="mt-2 text-alert">{messages.errors.dockerUnavailable(error)}</p> : null}
      </header>

      {targets.length === 0 ? (
        <p className="text-mut">{m.none}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className={`${LABEL} block pb-1`}>{m.container}</span>
            <select value={containerId ?? ""} onChange={(event) => void pickContainer(event.target.value || null)} className={FIELD}>
              <option value="">{m.pickContainer}</option>
              {groups.map(([project, items]) => (
                <optgroup key={project} label={project}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {BROWSABLE_LABELS[item.engine]}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span className={`${LABEL} block pb-1`}>{m.database}</span>
            <select
              value={database}
              disabled={!containerId || databases.length === 0}
              onChange={(event) => containerId && void pickDatabase(containerId, event.target.value)}
              className={FIELD}
            >
              <option value="">{busy === "databases" ? m.loading : m.pickDatabase}</option>
              {databases.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {targets.length > 0 && !containerId ? (
        <section aria-label={m.detected} className="grid gap-3">
          <h2 className={SECTION_TITLE}>{m.detected}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map(([project, items]) => (
              <div key={project} className={`${CARD} grid content-start gap-2`}>
                <h3 className="font-semibold break-words">{project}</h3>
                <div className="flex flex-wrap gap-2">
                  {items.map((item) => (
                    <button key={item.id} type="button" onClick={() => void pickContainer(item.id)} className={BUTTON_SMALL}>
                      {item.name}
                      <span className="text-[12px] text-mut">{BROWSABLE_LABELS[item.engine]}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {failure ? (
        <p role="alert" className={`${DATA} border border-alert px-3 py-2 break-words whitespace-pre-wrap text-alert`}>
          {failure}
        </p>
      ) : null}
      {containerId && databases.length === 0 && busy === null && !failure ? <p className="text-mut">{m.noDatabases}</p> : null}

      {database && redis && containerId ? <RedisBrowser key={`${containerId}/${database}`} containerId={containerId} database={database} onError={fail} /> : null}
      {database && !redis ? (
        <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <section className={`${CARD} grid gap-2`}>
            <h2 className={SECTION_TITLE}>{mongo ? m.collections : m.tables}</h2>
            {busy === "tables" ? <p className="text-mut">{m.loading}</p> : null}
            {busy !== "tables" && tables.length === 0 ? <p className="text-mut">{m.noTables}</p> : null}
            <ul className="grid max-h-[520px] gap-0.5 overflow-y-auto">
              {tables.map((table) => {
                const active = selected?.name === table.name && selected.schema === table.schema;
                return (
                  <li key={`${table.schema ?? ""}.${table.name}`}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => chooseTable({ schema: table.schema, name: table.name })}
                      className="flex w-full cursor-pointer items-baseline justify-between gap-2 px-2 py-1 text-left hover:bg-accent-soft aria-pressed:bg-accent-soft aria-pressed:text-accent"
                    >
                      <span className={`${DATA} min-w-0 break-all`}>
                        {table.schema && table.schema !== "public" ? <span className="text-mut">{table.schema}.</span> : null}
                        {table.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-mut">
                        {table.kind === "view" ? m.kinds.view : table.estimatedRows !== null ? m.estimated(table.estimatedRows) : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="grid min-w-0 gap-3">
            <div className="flex gap-2">
              <button type="button" aria-pressed={shownTab === "browse"} onClick={() => setTab("browse")} className={`${BUTTON_SMALL} aria-pressed:bg-accent aria-pressed:text-bg`}>
                {m.tab.browse}
              </button>
              <button type="button" aria-pressed={shownTab === "query"} onClick={() => setTab("query")} className={`${BUTTON_SMALL} aria-pressed:bg-accent aria-pressed:text-bg`}>
                {mongo ? m.tab.filter : m.tab.sql}
              </button>
              {mongo ? null : (
                <button type="button" aria-pressed={shownTab === "relations"} onClick={() => setTab("relations")} className={`${BUTTON_SMALL} aria-pressed:bg-accent aria-pressed:text-bg`}>
                  {m.tab.relations}
                </button>
              )}
            </div>

            {shownTab === "relations" ? (
              <RelationsPanel
                foreignKeys={relations.foreignKeys}
                failure={relations.failure}
                selected={selected}
                tableCount={tables.filter(({ kind }) => kind === "table").length}
                onOpen={chooseTable}
              />
            ) : shownTab === "browse" ? (
              selected ? (
                <div className="grid gap-3">
                  <h3 className="text-[18px] font-bold">
                    {selected.schema ? `${selected.schema}.` : ""}
                    {selected.name}
                  </h3>
                  {columns.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {columns.map((column) => (
                        <span key={column.name} className={BADGE} title={`${column.type}${column.nullable ? ` · ${m.nullable}` : ""}`}>
                          {column.key ? `${column.name} ★` : column.name} <span className="text-mut">{column.type}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {relations.foreignKeys ? <TableRelations foreignKeys={relations.foreignKeys} table={selected} onOpen={chooseTable} /> : null}
                  {rowFilter || trail.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-rule bg-panel px-3 py-2">
                      {trail.length > 0 ? (
                        <button type="button" onClick={goBack} className={BUTTON_SMALL}>
                          {m.relations.back(tableLabel(trail[trail.length - 1].table))}
                        </button>
                      ) : null}
                      {rowFilter ? (
                        <>
                          <span className={`${DATA} min-w-0 break-all`}>{rowFilter.map(({ column, value }) => `${column} = ${value}`).join(" · ")}</span>
                          <button type="button" onClick={() => void openTable(selected)} className={BUTTON_SMALL}>
                            {m.relations.showAll}
                          </button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  {busy === "rows" ? <p className="text-mut">{m.loading}</p> : null}
                  {output && busy !== "rows" ? (
                    <>
                      <ResultTable result={output.result} links={links} onFollow={followKey} />
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" disabled={page === 0} onClick={() => void openTable(selected, page - 1, rowFilter)} className={BUTTON_SMALL}>
                          {m.previous}
                        </button>
                        <span className="text-mut">
                          {m.page(page + 1)} · {m.elapsed(output.elapsedMs)}
                        </span>
                        <button type="button" disabled={!output.hasMore} onClick={() => void openTable(selected, page + 1, rowFilter)} className={BUTTON_SMALL}>
                          {m.next}
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="text-mut">{m.pickTable}</p>
              )
            ) : (
              <div className="grid gap-3">
                <label>
                  <span className={`${LABEL} block pb-1`}>{mongo ? `${m.filterLabel}${selected ? ` — ${selected.name}` : ""}` : m.sqlLabel}</span>
                  <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                        event.preventDefault();
                        void run();
                      }
                    }}
                    rows={7}
                    spellCheck={false}
                    placeholder={mongo ? m.filterPlaceholder : m.sqlPlaceholder}
                    className={`${FIELD} ${DATA} min-h-40 resize-y py-2`}
                  />
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={busy === "query" || (!mongo && statements === "") || (mongo && !selected)}
                    onClick={() => void run()}
                    className={BUTTON_PRIMARY}
                  >
                    {busy === "query" ? m.running : m.run}
                  </button>
                  {mongo ? null : (
                    <>
                      <button
                        type="button"
                        disabled={busy !== null || statements === ""}
                        onClick={() => void explain()}
                        className={BUTTON_SMALL}
                      >
                        {busy === "explain" ? m.explaining : m.explain}
                      </button>
                      {target?.engine === "postgres" ? (
                        <label className="flex items-center gap-1.5 text-[12px]" title={m.analyzeHint}>
                          <input type="checkbox" className={CHECKBOX} checked={analyze} onChange={(event) => setAnalyze(event.target.checked)} />
                          {m.analyze}
                        </label>
                      ) : null}
                    </>
                  )}
                  <span className="text-[12px] text-mut">{m.shortcut}</span>
                </div>
                {plan && busy !== "explain" ? <PlanView plan={plan.plan} elapsedMs={plan.elapsedMs} /> : null}
                {output && busy !== "query" ? (
                  <>
                    <Summary output={output} limit={1000} />
                    <ResultTable result={output.result} />
                    {mongo ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" disabled={page === 0} onClick={() => void run(page - 1)} className={BUTTON_SMALL}>
                          {m.previous}
                        </button>
                        <span className="text-mut">{m.page(page + 1)}</span>
                        <button type="button" disabled={!output.hasMore} onClick={() => void run(page + 1)} className={BUTTON_SMALL}>
                          {m.next}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}

                <div className={`${CARD} grid gap-1`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className={SECTION_TITLE}>{m.history}</h3>
                    {entries.length > 0 && target ? (
                      <button
                        type="button"
                        className={BUTTON_SMALL_DANGER}
                        onClick={async () => {
                          await clearProjectHistory(target.projectId);
                          await refreshHistory();
                        }}
                      >
                        {m.clearHistory}
                      </button>
                    ) : null}
                  </div>
                  {entries.length === 0 ? <p className="pt-2 text-mut">{m.noHistory}</p> : null}
                  <ul className="grid max-h-72 overflow-y-auto">
                    {entries.map((entry) => (
                      <li key={entry.id} className="border-b border-rule last:border-b-0">
                        <button
                          type="button"
                          title={m.useQuery}
                          onClick={() => {
                            setText((mongo ? /^[^.]+\.find\(([\s\S]*)\)$/.exec(entry.statement)?.[1] : null) ?? entry.statement);
                            setTab("query");
                          }}
                          className="grid w-full cursor-pointer gap-0.5 py-1.5 text-left hover:bg-accent-soft"
                        >
                          <span className={`${DATA} line-clamp-2 break-all`}>{entry.statement}</span>
                          <span className="text-[11px] text-mut">
                            {entry.containerName} · {entry.database} · {formatAge(entry.ranAt, now, messages.age)} ·{" "}
                            {entry.ok && entry.rowCount !== null ? m.rows(entry.rowCount) : m.historyFailed}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
      {containerId ? null : <p className="sr-only">{m.pickContainer}</p>}
    </div>
  );
}
