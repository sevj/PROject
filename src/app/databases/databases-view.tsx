"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { ENGINE_LABELS } from "@/lib/db-engines";
import { formatAge } from "@/lib/registry";
import type { QueryResult } from "@/lib/sql-result";
import type { ColumnInfo, TableInfo } from "@/server/databases";
import type { DatabaseTarget } from "@/server/dumps/containers";
import type { HistoryEntry } from "@/server/query-history";
import { BADGE, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, DATA, FIELD, LABEL, SECTION_TITLE } from "../ui";
import {
  clearProjectHistory,
  executeFilter,
  executeSql,
  loadColumns,
  loadDatabases,
  loadHistory,
  loadPage,
  loadTables,
} from "./actions";

type Tab = "browse" | "query";
type Output = { result: QueryResult; elapsedMs: number; hasMore: boolean };
type TableKey = { schema: string | null; name: string };

function ResultTable({ result }: { result: QueryResult }) {
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
              {row.map((cell, index) => (
                <td key={index} className={`${DATA} max-w-[420px] px-2 py-1 break-words whitespace-pre-wrap ${cell === null ? "text-mut italic" : ""}`}>
                  {cell === null ? m.nullValue : cell.length > 2000 ? `${cell.slice(0, 2000)}…` : cell}
                </td>
              ))}
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
  const [tab, setTab] = useState<Tab>("browse");
  const [page, setPage] = useState(0);
  const [output, setOutput] = useState<Output | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [history, setHistory] = useState(histories);
  const [now, setNow] = useState(initialNow);

  const target = targets.find(({ id }) => id === containerId) ?? null;
  const mongo = target?.engine === "mongodb";
  const entries = target ? (history[target.projectId] ?? []) : [];

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
    fail(null);
    if (!name) return;
    setBusy("tables");
    const result = await loadTables(id, name);
    setBusy(null);
    if ("error" in result) return fail(result.error);
    setTables(result.tables);
  };

  const openTable = async (table: TableKey, pageNumber = 0) => {
    if (!containerId) return;
    setSelected(table);
    setTab("browse");
    setPage(pageNumber);
    fail(null);
    setBusy("rows");
    const [cols, rows] = await Promise.all([
      pageNumber === 0 ? loadColumns(containerId, database, table.schema, table.name) : Promise.resolve(null),
      loadPage(containerId, database, table.schema, table.name, pageNumber),
    ]);
    setBusy(null);
    if (cols) setColumns("error" in cols ? [] : cols.columns);
    if ("error" in rows) {
      setOutput(null);
      return fail(rows.error);
    }
    setOutput({ result: rows.result, elapsedMs: rows.elapsedMs, hasMore: rows.hasMore });
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

  // The page can be opened on a given container, from a link.
  const opener = useRef(pickContainer);
  useEffect(() => {
    opener.current = pickContainer;
  });
  useEffect(() => {
    if (initialContainer) void opener.current(initialContainer);
  }, [initialContainer]);

  if (error) return <p className="text-alert">{messages.errors.dockerUnavailable(error)}</p>;

  const statements = text.trim();
  return (
    <div className="grid gap-5">
      <header>
        <h1 className="text-[32px] leading-none font-bold tracking-tight">{m.title}</h1>
        <p className="mt-2 max-w-2xl text-mut">{m.intro}</p>
        <p className="mt-1 max-w-2xl text-[12px] text-mut">{m.readOnly}</p>
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
                      {item.name} · {ENGINE_LABELS[item.engine]}
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

      {failure ? (
        <p role="alert" className={`${DATA} border border-alert px-3 py-2 break-words whitespace-pre-wrap text-alert`}>
          {failure}
        </p>
      ) : null}
      {containerId && databases.length === 0 && busy === null && !failure ? <p className="text-mut">{m.noDatabases}</p> : null}

      {database ? (
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
                      onClick={() => void openTable({ schema: table.schema, name: table.name })}
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
              <button type="button" aria-pressed={tab === "browse"} onClick={() => setTab("browse")} className={`${BUTTON_SMALL} aria-pressed:bg-accent aria-pressed:text-bg`}>
                {m.tab.browse}
              </button>
              <button type="button" aria-pressed={tab === "query"} onClick={() => setTab("query")} className={`${BUTTON_SMALL} aria-pressed:bg-accent aria-pressed:text-bg`}>
                {mongo ? m.tab.filter : m.tab.sql}
              </button>
            </div>

            {tab === "browse" ? (
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
                  {busy === "rows" ? <p className="text-mut">{m.loading}</p> : null}
                  {output && busy !== "rows" ? (
                    <>
                      <ResultTable result={output.result} />
                      <div className="flex flex-wrap items-center gap-3">
                        <button type="button" disabled={page === 0} onClick={() => void openTable(selected, page - 1)} className={BUTTON_SMALL}>
                          {m.previous}
                        </button>
                        <span className="text-mut">
                          {m.page(page + 1)} · {m.elapsed(output.elapsedMs)}
                        </span>
                        <button type="button" disabled={!output.hasMore} onClick={() => void openTable(selected, page + 1)} className={BUTTON_SMALL}>
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
                  <span className="text-[12px] text-mut">{m.shortcut}</span>
                </div>
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
