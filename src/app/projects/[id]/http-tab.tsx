"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { clearHttpResponses, loadHttpResponses, removeHttpRequest, sendHttpRequest } from "@/app/http-actions";
import { PlusIcon } from "@/app/icons";
import { Modal, useConfirm } from "@/app/modal";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_PRIMARY, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, CHECKBOX, DATA, FIELD, LABEL, SECTION_TITLE } from "@/app/ui";
import { useFlash } from "@/app/flash";
import { useMessages } from "@/i18n/provider";
import { HTTP_METHODS, type HttpMethod, placeholdersIn, prettyBody, statusTone, writes } from "@/lib/http-requests";
import { formatSize } from "@/lib/registry";
import type { HeaderView, HttpEnvironment, HttpView, RequestView, ResponseView, VariableView } from "@/server/http-requests";

type Draft = Omit<RequestView, "id"> & { id: number | null };

const EMPTY: Draft = { id: null, name: "", method: "GET", url: "{{baseUrl}}/", headers: [], body: "" };
const ENV_KEY = "pm:http-environment";

const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: "var(--area-docker)",
  POST: "var(--area-console)",
  PUT: "var(--area-git)",
  PATCH: "var(--area-tools)",
  DELETE: "var(--kind-access)",
  HEAD: "var(--kind-page)",
  OPTIONS: "var(--kind-page)",
};

const TONE_CLASS: Record<ReturnType<typeof statusTone>, string> = {
  ok: "bg-ok/15 text-ok",
  redirect: "bg-sel text-ink",
  client: "bg-[color-mix(in_srgb,var(--series-4)_22%,transparent)] text-[var(--series-4)]",
  server: "bg-alert/20 text-alert",
  error: "bg-alert/20 text-alert",
};

function MethodTag({ method }: { method: HttpMethod }) {
  return (
    <span className="inline-block w-[58px] shrink-0 font-mono text-[11px] font-medium" style={{ color: METHOD_COLOR[method] }}>
      {method}
    </span>
  );
}

async function post(projectId: number, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`/api/projects/${projectId}/http`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return response.ok ? ((await response.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const ENV_EVENT = "pm:http-environment";

function readEnvironment(): string {
  try {
    return localStorage.getItem(ENV_KEY) ?? "local";
  } catch {
    return "local";
  }
}

/** The environment chosen last, kept in this browser; the server renders Local. */
function useChosenEnvironment(): [string, (key: string) => void] {
  const key = useSyncExternalStore(
    (changed) => {
      window.addEventListener(ENV_EVENT, changed);
      return () => window.removeEventListener(ENV_EVENT, changed);
    },
    readEnvironment,
    () => "local",
  );
  const choose = (next: string) => {
    try {
      localStorage.setItem(ENV_KEY, next);
    } catch {
      // Not kept: the event still shows it for this visit.
    }
    window.dispatchEvent(new Event(ENV_EVENT));
  };
  return [key, choose];
}

export function HttpTab({ projectId, view, readOnly }: { projectId: number; view: HttpView; readOnly: boolean }) {
  const messages = useMessages();
  const m = messages.http;
  const router = useRouter();
  const flash = useFlash();
  const { confirm, confirmation } = useConfirm();
  const [selectedId, setSelectedId] = useState<number | null>(view.requests[0]?.id ?? null);
  const [draft, setDraft] = useState<Draft>(() => view.requests[0] ?? EMPTY);
  const [dirty, setDirty] = useState(false);
  const [envKey, chooseEnvironment] = useChosenEnvironment();
  const [editingVariables, setEditingVariables] = useState(false);
  const [responses, setResponses] = useState<ResponseView[]>([]);
  const [shownResponse, setShownResponse] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const environment: HttpEnvironment = view.environments.find((item) => String(item.id ?? "local") === envKey) ?? view.environments[0];

  useEffect(() => {
    if (draft.id === null) return;
    let live = true;
    void loadHttpResponses(projectId, draft.id).then((list) => {
      if (!live) return;
      setResponses(list);
      setShownResponse(list[0]?.id ?? null);
    });
    return () => {
      live = false;
    };
  }, [projectId, draft.id]);

  const pick = (request: RequestView | null) => {
    setSelectedId(request?.id ?? null);
    setDraft(request ?? EMPTY);
    setDirty(false);
    setProblem(null);
    setResponses([]);
    setShownResponse(null);
  };

  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  };
  const changeHeader = (index: number, patch: Partial<HeaderView>) => change({ headers: draft.headers.map((header, at) => (at === index ? { ...header, ...patch } : header)) });

  /** Saved first when changed: what is sent is always what is kept. */
  const save = async (): Promise<number | null> => {
    const answer = await post(projectId, { kind: "request", id: draft.id, request: draft });
    if (!answer) {
      setProblem(m.problems.saveFailed);
      return null;
    }
    if ("problem" in answer) {
      setProblem(m.problems[answer.problem as keyof typeof m.problems]);
      return null;
    }
    const id = answer.id as number;
    setProblem(null);
    setDirty(false);
    setDraft((current) => ({ ...current, id, headers: current.headers.map((header) => (header.secret ? { ...header, value: "", hasValue: header.hasValue || header.value !== "" } : header)) }));
    setSelectedId(id);
    router.refresh();
    return id;
  };

  const send = (confirmed = false) =>
    start(async () => {
      const id = dirty || draft.id === null ? await save() : draft.id;
      if (id === null) return;
      const result = await sendHttpRequest(projectId, id, environment.id, confirmed);
      if ("response" in result) {
        setResponses((current) => [result.response, ...current].slice(0, 10));
        setShownResponse(result.response.id);
        setProblem(null);
        return;
      }
      if (result.problem === "needsConfirm") {
        confirm({ ...m.confirmWrite(environment.name, draft.method), action: m.send, danger: true, onConfirm: () => send(true) });
        return;
      }
      setProblem(result.detail ? `${m.problems[result.problem]} (${result.detail})` : m.problems[result.problem]);
    });

  const used = placeholdersIn([draft.url, ...draft.headers.map(({ value }) => value), writes(draft.method) ? draft.body : ""].join("\n"));
  const defined = new Set([...environment.variables.map(({ name }) => name), ...(environment.baseUrl ? ["baseUrl"] : [])]);
  const missing = used.filter((name) => !defined.has(name));
  const response = responses.find(({ id }) => id === shownResponse) ?? null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      <section className={`${CARD} grid gap-3`}>
        <label>
          <span className={`${LABEL} block pb-1`}>{m.environment}</span>
          <select value={String(environment.id ?? "local")} onChange={(event) => chooseEnvironment(event.target.value)} className={FIELD}>
            {view.environments.map((item) => (
              <option key={item.id ?? "local"} value={String(item.id ?? "local")}>
                {item.name}
                {item.protected ? " 🔒" : ""}
              </option>
            ))}
          </select>
        </label>
        {readOnly ? null : (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditingVariables(true)} className={BUTTON_SMALL}>
              {m.variables} ({environment.variables.length})
            </button>
            <button type="button" onClick={() => pick(null)} className={BUTTON_SMALL}>
              <PlusIcon />
              {m.add}
            </button>
          </div>
        )}
        {view.requests.length === 0 ? <p className="text-mut">{m.none}</p> : null}
        <ul className="grid">
          {view.requests.map((request) => (
            <li key={request.id}>
              <button
                type="button"
                aria-current={request.id === selectedId ? "true" : undefined}
                onClick={() => pick(request)}
                className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-sel ${request.id === selectedId ? "bg-accent-soft" : ""}`}
              >
                <MethodTag method={request.method} />
                <span className="min-w-0 truncate">{request.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid min-w-0 gap-4">
        <section className={`${CARD} grid gap-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={m.name}
              placeholder={m.name}
              value={draft.name}
              disabled={readOnly}
              onChange={(event) => change({ name: event.target.value })}
              className={`${FIELD} min-w-[200px] flex-1 font-semibold`}
            />
            {environment.protected ? <span className={BADGE_ALERT}>{environment.name}</span> : <span className={BADGE}>{environment.name}</span>}
            {dirty ? <span className={`${DATA} text-mut`}>{m.unsaved}</span> : null}
          </div>
          <div className="flex gap-2">
            <select aria-label={m.method} value={draft.method} disabled={readOnly} onChange={(event) => change({ method: event.target.value as HttpMethod })} className={`${FIELD} ${DATA} !w-28 shrink-0`} style={{ color: METHOD_COLOR[draft.method] }}>
              {HTTP_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
            <input aria-label={m.url} value={draft.url} disabled={readOnly} spellCheck={false} onChange={(event) => change({ url: event.target.value })} className={`${FIELD} ${DATA} min-w-0 flex-1`} />
            <button type="button" disabled={readOnly || busy} onClick={() => send()} className={BUTTON_PRIMARY}>
              {busy ? m.sending : m.send}
            </button>
          </div>
          {environment.baseUrl ? <p className={`${DATA} text-mut`}>{m.baseUrlFrom(environment.baseUrl)}</p> : null}
          {missing.length > 0 ? <p className="text-alert">{m.missing(missing.join(", "))}</p> : null}

          <fieldset className="grid gap-2">
            <legend className={`${LABEL} pb-1`}>{m.headers}</legend>
            {draft.headers.map((header, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-2">
                <input aria-label={m.headerName} placeholder={m.headerName} value={header.name} disabled={readOnly} spellCheck={false} onChange={(event) => changeHeader(index, { name: event.target.value })} className={`${FIELD} ${DATA}`} />
                <input
                  aria-label={m.headerValue}
                  type={header.secret ? "password" : "text"}
                  autoComplete="off"
                  placeholder={header.secret && header.hasValue ? m.secretKept : m.headerValue}
                  value={header.value}
                  disabled={readOnly}
                  spellCheck={false}
                  onChange={(event) => changeHeader(index, { value: event.target.value })}
                  className={`${FIELD} ${DATA} placeholder:text-mut`}
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-mut">
                  <input type="checkbox" className={CHECKBOX} checked={header.secret} disabled={readOnly} onChange={(event) => changeHeader(index, { secret: event.target.checked, value: "", hasValue: false })} />
                  {m.secret}
                </label>
                <button type="button" disabled={readOnly} onClick={() => change({ headers: draft.headers.filter((_, at) => at !== index) })} className={BUTTON_SMALL_DANGER} aria-label={m.removeHeader}>
                  ✕
                </button>
              </div>
            ))}
            {readOnly ? null : (
              <div>
                <button type="button" onClick={() => change({ headers: [...draft.headers, { name: "", value: "", secret: false, hasValue: false }] })} className={BUTTON_SMALL}>
                  <PlusIcon />
                  {m.addHeader}
                </button>
              </div>
            )}
          </fieldset>

          {writes(draft.method) ? (
            <label>
              <span className={`${LABEL} block pb-1`}>{m.body}</span>
              <textarea value={draft.body} disabled={readOnly} spellCheck={false} rows={6} onChange={(event) => change({ body: event.target.value })} className={`${FIELD} ${DATA} py-2`} />
              <span className="block pt-1 text-[12px] text-mut">{m.bodyHint}</span>
            </label>
          ) : null}

          {problem ? <p role="alert" className="text-alert">{problem}</p> : null}
          {readOnly ? null : (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || (!dirty && draft.id !== null)} onClick={() => start(async () => void ((await save()) !== null && flash("success", m.saved)))} className={BUTTON}>
                {messages.common.save}
              </button>
              {draft.id !== null ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    confirm({
                      ...m.removeConfirm(draft.name),
                      action: m.remove,
                      danger: true,
                      onConfirm: () =>
                        start(async () => {
                          await removeHttpRequest(projectId, draft.id as number);
                          pick(null);
                          router.refresh();
                        }),
                    })
                  }
                  className={BUTTON_SMALL_DANGER}
                >
                  {m.remove}
                </button>
              ) : null}
            </div>
          )}
        </section>

        <section className={`${CARD} grid gap-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className={SECTION_TITLE}>{m.response}</h3>
            {responses.length > 0 && draft.id !== null ? (
              <button
                type="button"
                onClick={() =>
                  start(async () => {
                    await clearHttpResponses(projectId, draft.id as number);
                    setResponses([]);
                    setShownResponse(null);
                  })
                }
                className={BUTTON_SMALL}
              >
                {m.clearHistory}
              </button>
            ) : null}
          </div>
          {responses.length === 0 ? <p className="text-mut">{m.noResponse}</p> : null}
          {responses.length > 1 ? (
            <div className="flex flex-wrap gap-1" role="group" aria-label={m.history}>
              {responses.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={item.id === shownResponse}
                  onClick={() => setShownResponse(item.id)}
                  className={`${DATA} px-1.5 py-0.5 ${TONE_CLASS[statusTone(item.status)]} ${item.id === shownResponse ? "outline-1 outline-accent" : "opacity-70"}`}
                >
                  {item.status ?? "×"} · {new Date(item.sentAt).toLocaleTimeString()}
                </button>
              ))}
            </div>
          ) : null}
          {response ? <ResponseDetail response={response} /> : null}
          <p className="text-[12px] text-mut">{m.keptNote}</p>
        </section>
      </div>

      {editingVariables ? (
        <VariablesModal
          projectId={projectId}
          environment={environment}
          onClose={() => setEditingVariables(false)}
          onSaved={() => {
            setEditingVariables(false);
            router.refresh();
          }}
        />
      ) : null}
      {confirmation}
    </div>
  );
}

function ResponseDetail({ response }: { response: ResponseView }) {
  const messages = useMessages();
  const m = messages.http;
  const contentType = response.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? null;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${DATA} px-1.5 py-0.5 font-medium ${TONE_CLASS[statusTone(response.status)]}`}>{response.status ?? m.failed}</span>
        <span className={`${DATA} text-mut`}>
          {[response.environment, m.duration(response.durationMs), formatSize(response.size, messages.size), new Date(response.sentAt).toLocaleString()].join(" · ")}
        </span>
      </div>
      <p className={`${DATA} break-all text-mut`}>
        {response.method} {response.url}
      </p>
      {response.error ? <p className={`${DATA} text-alert`}>{response.error}</p> : null}
      {response.headers.length > 0 ? (
        <details>
          <summary className={`${LABEL} cursor-pointer`}>
            {m.responseHeaders} ({response.headers.length})
          </summary>
          <dl className={`${DATA} grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 pt-1`}>
            {response.headers.map(([name, value], index) => (
              <div key={index} className="contents">
                <dt className="text-mut">{name}</dt>
                <dd className="break-all">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {response.body ? (
        <pre className={`${DATA} max-h-[480px] overflow-auto border border-rule bg-field p-2 break-all whitespace-pre-wrap`}>{prettyBody(response.body, contentType)}</pre>
      ) : null}
      {response.truncated ? <p className="text-[12px] text-mut">{m.truncated}</p> : null}
    </div>
  );
}

function VariablesModal({ projectId, environment, onClose, onSaved }: { projectId: number; environment: HttpEnvironment; onClose: () => void; onSaved: () => void }) {
  const messages = useMessages();
  const m = messages.http;
  const [rows, setRows] = useState<VariableView[]>(environment.variables);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const change = (index: number, patch: Partial<VariableView>) => setRows((current) => current.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setPending(true);
    const answer = await post(projectId, { kind: "variables", environmentId: environment.id, variables: rows });
    setPending(false);
    if (!answer) setProblem(m.problems.saveFailed);
    else if ("problem" in answer) setProblem(m.problems[answer.problem as keyof typeof m.problems]);
    else onSaved();
  };

  return (
    <Modal title={m.variablesOf(environment.name)} wide onClose={onClose}>
      <p className="text-mut">{m.variablesHint}</p>
      {environment.baseUrl ? <p className={`${DATA} text-mut`}>{m.baseUrlFrom(environment.baseUrl)}</p> : null}
      {rows.length === 0 ? <p className="text-mut">{m.noVariables}</p> : null}
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto] items-center gap-2">
            <input aria-label={m.headerName} placeholder="token" value={row.name} spellCheck={false} onChange={(event) => change(index, { name: event.target.value })} className={`${FIELD} ${DATA}`} />
            <input
              aria-label={m.headerValue}
              type={row.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={row.secret && row.hasValue ? m.secretKept : m.headerValue}
              value={row.value}
              spellCheck={false}
              onChange={(event) => change(index, { value: event.target.value })}
              className={`${FIELD} ${DATA} placeholder:text-mut`}
            />
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-mut">
              <input type="checkbox" className={CHECKBOX} checked={row.secret} onChange={(event) => change(index, { secret: event.target.checked, value: "", hasValue: false })} />
              {m.secret}
            </label>
            <button type="button" onClick={() => setRows((current) => current.filter((_, at) => at !== index))} className={BUTTON_SMALL_DANGER} aria-label={m.removeHeader}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div>
        <button type="button" onClick={() => setRows((current) => [...current, { name: "", value: "", secret: false, hasValue: false }])} className={BUTTON_SMALL}>
          <PlusIcon />
          {m.addVariable}
        </button>
      </div>
      {problem ? <p role="alert" className="text-alert">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => void save()} className={BUTTON_PRIMARY}>
          {pending ? messages.common.saving : messages.common.save}
        </button>
        <button type="button" onClick={onClose} className={BUTTON}>
          {messages.common.cancel}
        </button>
      </div>
    </Modal>
  );
}
