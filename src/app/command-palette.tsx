"use client";

import { asksPassword } from "@/lib/vpn";
import { sayLostAnswer, stateAfterLostAnswer, stopVpnSafely } from "./vpn/vpn-controls";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/i18n/provider";
import { rank, rankActions, remember } from "@/lib/palette";
import type { PaletteData } from "@/server/palette";
import type { VpnFailure } from "@/server/vpn";
import { analyzeAllProjects, controlContainers, fetchAllProjects, fetchProject, openIde, openTerminal, refreshEverything } from "./actions";
import { useClaudeConsoles } from "./claude-consoles";
import { actOnDockerContainers } from "./docker/actions";
import { useFlash } from "./flash";
import { type Confirmation, useConfirm } from "./modal";
import type { WindowTab } from "./projects/[id]/docker-window";
import type { RemoteTab } from "./projects/[id]/remote-window";
import { SECTIONS } from "./sections";
import { DATA } from "./ui";
import { announceVpnChange } from "./vpn/vpn-events";

// Terminals are heavy, and most uses of the palette do not open one.
const DockerWindow = dynamic(() => import("./projects/[id]/docker-window").then(({ DockerWindow }) => DockerWindow), { ssr: false });
const RemoteWindow = dynamic(() => import("./projects/[id]/remote-window").then(({ RemoteWindow }) => RemoteWindow), { ssr: false });

/** Sent by the header's button, which lies outside the providers the palette needs. */
export const OPEN_PALETTE = "pm:open-palette";

const RECENT_KEY = "pm:palette-recent";
const LIMIT = 60;

type Kind = "page" | "project" | "container" | "access" | "server" | "vpn" | "action";
type Action = { id: string; label: string; confirm?: Omit<Confirmation, "onConfirm" | "action">; run: () => void | Promise<unknown> };
type Entry = { id: string; kind: Kind; title: string; subtitle?: string; keywords?: string; actions: Action[] };
type Opened = { kind: "docker"; projectId: number; first: WindowTab } | { kind: "remote"; projectId: number; first: RemoteTab };

/** One color per kind, far apart on the wheel and set for each theme in globals.css. */
const KIND_COLOR: Record<Kind, string> = {
  project: "var(--kind-project)",
  container: "var(--kind-container)",
  access: "var(--kind-access)",
  server: "var(--kind-server)",
  vpn: "var(--kind-vpn)",
  action: "var(--kind-action)",
  page: "var(--kind-page)",
};

/** What an action is about, each with its own color, apart from the kinds of items. */
type Area = "docker" | "console" | "claude" | "git" | "tools" | "vpn" | "nav";
const AREA_COLOR: Record<Area, string> = {
  docker: "var(--area-docker)",
  console: "var(--area-console)",
  claude: "var(--area-claude)",
  git: "var(--area-git)",
  tools: "var(--area-tools)",
  vpn: "var(--area-vpn)",
  nav: "var(--kind-page)",
};

/** From the item and the action's id: the ids say what each one does. */
function areaOf(entryId: string, actionId: string): Area {
  if (entryId === "action:stop-all") return "docker";
  if (entryId.startsWith("action:")) return "git";
  if (entryId.startsWith("vpn:") && actionId !== "page") return "vpn";
  if (["docker-start", "docker-stop", "restart", "stop", "start"].includes(actionId)) return "docker";
  if (["console", "logs", "terminal"].includes(actionId)) return "console";
  if (actionId === "claude") return "claude";
  if (actionId === "fetch") return "git";
  if (actionId === "ide" || actionId === "database" || actionId === "export") return "tools";
  return "nav";
}

function AreaBadge({ area, label }: { area: Area; label: string }) {
  const style = area === "nav" ? { color: AREA_COLOR.nav, boxShadow: `inset 0 0 0 1px ${AREA_COLOR.nav}` } : { background: AREA_COLOR[area], color: "var(--kind-text)" };
  return (
    <span className="inline-flex shrink-0 justify-center px-1.5 font-mono text-[11px] leading-[20px] font-medium tracking-[.04em] uppercase" style={style}>
      {label}
    </span>
  );
}

function KindBadge({ kind, label }: { kind: Kind; label: string }) {
  // Pages are where one goes, not what one acts on: an outline is enough for them.
  const style =
    kind === "page"
      ? { color: KIND_COLOR.page, boxShadow: `inset 0 0 0 1px ${KIND_COLOR.page}` }
      : { background: KIND_COLOR[kind], color: kind === "action" ? "var(--bg)" : "var(--kind-text)" };
  return (
    <span className="inline-flex w-[84px] shrink-0 justify-center px-1.5 font-mono text-[11px] leading-[20px] font-medium tracking-[.04em] uppercase" style={style}>
      {label}
    </span>
  );
}

const PROJECT_TABS = ["docker", "git", "env", "environments", "http", "claude", "security", "structure", "documentation"] as const;

/** A file to save, not a page to open: a link with `download`, clicked once. */
function download(href: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function readRecent(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(recent: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
  } catch {
    // Kept for this visit only.
  }
}

/** Ctrl+K from any page: find a project, a server, a page or an action, and act without the mouse. */
export function CommandPalette() {
  const messages = useMessages();
  const m = messages.palette;
  const a = m.actions;
  const router = useRouter();
  const flash = useFlash();
  const claude = useClaudeConsoles();
  const { confirm, confirmation } = useConfirm();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PaletteData | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [opened, setOpened] = useState<Opened | null>(null);

  const show = useCallback(() => {
    setQuery("");
    setSelected(0);
    setRecent(readRecent());
    setOpen(true);
    void fetch("/api/palette", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<PaletteData>) : null))
      .then((read) => read && setData(read))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k" || event.shiftKey || event.altKey) return;
      // In a terminal, Ctrl+K belongs to the shell: it cuts the end of the line.
      if (event.target instanceof Element && event.target.closest(".xterm")) return;
      event.preventDefault();
      if (dialog.current?.open) dialog.current.close();
      else show();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_PALETTE, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_PALETTE, show);
    };
  }, [show]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const result = (promise: Promise<string | null | boolean | { error: string } | { done: number } | { error: string | null }>) =>
      void promise.then((value) => {
        const error = typeof value === "string" ? value : value && typeof value === "object" && "error" in value ? value.error : null;
        if (error) flash("error", error);
        else flash("success", m.done);
        router.refresh();
      });
    const pages: Entry[] = SECTIONS.flatMap((section) =>
      section.pages.map((page) => ({
        id: `page:${page.href}`,
        kind: "page" as const,
        title: messages.nav[page.label],
        subtitle: section.pages.length > 1 ? messages.nav[section.label] : undefined,
        actions: [{ id: "open", label: a.open, run: () => router.push(page.href) }],
      })),
    );
    if (!data) return pages;
    const projects: Entry[] = data.projects.map((project) => ({
      id: `project:${project.id}`,
      kind: "project",
      title: project.name,
      subtitle: [project.parentName, project.branch, project.stacks.join(", ")].filter(Boolean).join(" · "),
      actions: [
        { id: "open", label: a.openSheet, run: () => router.push(`/projects/${project.id}`) },
        ...(project.hasDocker
          ? [
              { id: "docker-start", label: a.dockerStart, run: () => result(controlContainers(project.id, "start")) },
              { id: "docker-stop", label: a.dockerStop, confirm: a.dockerStopConfirm(project.name), run: () => result(controlContainers(project.id, "stop")) },
            ]
          : []),
        { id: "claude", label: a.claude, run: () => claude.open({ projectId: project.id, projectName: project.name }) },
        { id: "ide", label: a.ide, run: () => result(openIde(project.id)) },
        { id: "terminal", label: a.terminal, run: () => result(openTerminal(project.id)) },
        { id: "fetch", label: a.fetch, run: () => result(fetchProject(project.id)) },
        { id: "export", label: a.exportConfig, run: () => download(`/api/projects/${project.id}/config`) },
        { id: "import", label: a.importConfig, run: () => router.push(`/projects/${project.id}`) },
        ...PROJECT_TABS.map((tab) => ({ id: `tab-${tab}`, label: a.tab(messages.sheet[tab]), run: () => router.push(`/projects/${project.id}?tab=${tab}`) })),
      ],
    }));
    const containers: Entry[] = data.containers.map((container) => ({
      id: `container:${container.name}`,
      kind: "container",
      title: container.name,
      subtitle: [container.projectName, container.service, container.running ? null : messages.sheet.dockerTab.states.stopped].filter(Boolean).join(" · "),
      actions: [
        ...(container.running ? [{ id: "console", label: a.console, run: () => setOpened({ kind: "docker", projectId: container.projectId, first: { kind: "console", containerId: container.id } }) }] : []),
        { id: "logs", label: a.logs, run: () => setOpened({ kind: "docker", projectId: container.projectId, first: { kind: "logs", containerId: container.id } }) },
        ...(container.database && container.running ? [{ id: "database", label: a.database, run: () => router.push(`/databases?container=${encodeURIComponent(container.name)}`) }] : []),
        ...(container.running
          ? [
              { id: "restart", label: a.restart, run: () => result(actOnDockerContainers("restart", [container.id])) },
              { id: "stop", label: a.stop, run: () => result(actOnDockerContainers("stop", [container.id])) },
            ]
          : [{ id: "start", label: a.start, run: () => result(actOnDockerContainers("start", [container.id])) }]),
      ],
    }));
    const accesses: Entry[] = data.accesses.map((access) => ({
      id: `access:${access.accessId}`,
      kind: "access",
      title: `${access.environment} · ${access.label}`,
      subtitle: [access.projectName, access.server, access.protected ? messages.environments.protectedBadge : null].filter(Boolean).join(" · "),
      actions: [
        {
          id: "console",
          label: a.remoteConsole,
          confirm: access.protected ? messages.environments.consoleConfirm(access.environment, access.label) : undefined,
          run: () => setOpened({ kind: "remote", projectId: access.projectId, first: { accessId: access.accessId, confirmed: access.protected } }),
        },
        { id: "environments", label: a.environments, run: () => router.push(`/projects/${access.projectId}?tab=environments`) },
      ],
    }));
    const servers: Entry[] = data.servers.map((server) => ({
      id: `server:${server.id}`,
      kind: "server",
      title: server.name,
      subtitle: [server.kind, server.host].filter(Boolean).join(" · "),
      actions: [{ id: "servers", label: a.servers, run: () => router.push("/servers") }],
    }));
    const vpns: Entry[] = data.vpns.map((vpn) => {
      const up = vpn.state === "connected" || vpn.state === "connecting";
      const others = data.vpns.some((other) => other.id !== vpn.id && other.state === "connected");
      // What asks for a password or a token, or would cut another VPN, is done on its page.
      const asksHere = asksPassword(vpn.kind) && (!vpn.hasPassword || vpn.tokenAppended);
      const connect = () =>
        void fetch(`/api/vpns/${vpn.id}/connect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
          .then((response) => response.json() as Promise<{ ok: true } | VpnFailure>)
          .then((answer) => {
            if ("problem" in answer) flash("error", answer.detail ? `${messages.vpn.problems[answer.problem]} (${answer.detail})` : messages.vpn.problems[answer.problem]);
            else flash("success", messages.vpn.connected(vpn.name));
            announceVpnChange();
            router.refresh();
          })
          .catch(async () => {
            sayLostAnswer(await stateAfterLostAnswer(vpn.id), vpn.name, flash, messages.vpn);
            announceVpnChange();
            router.refresh();
          });
      return {
        id: `vpn:${vpn.id}`,
        kind: "vpn",
        title: vpn.name,
        subtitle: `${messages.vpn.kinds[vpn.kind]} · ${messages.vpn.states[vpn.state]}`,
        actions: [
          ...(up
            ? [{ id: "disconnect", label: a.disconnect, run: () => void stopVpnSafely(vpn.id).then(() => (announceVpnChange(), router.refresh())) }]
            : vpn.state === "unavailable" || vpn.loggedIn === false || asksHere || others
              ? []
              : [{ id: "connect", label: vpn.state === "lost" ? a.reconnect : a.connect, run: connect }]),
          { id: "page", label: a.vpnPage, run: () => router.push("/vpn") },
        ],
      };
    });
    const running = data.containers.filter(({ running }) => running).map(({ id }) => id);
    const globals: Entry[] = [
      { id: "action:fetch-all", kind: "action", title: a.fetchAll, actions: [{ id: "run", label: a.fetchAll, run: () => result(fetchAllProjects()) }] },
      { id: "action:analyze-all", kind: "action", title: a.analyzeAll, actions: [{ id: "run", label: a.analyzeAll, run: () => result(analyzeAllProjects()) }] },
      { id: "action:refresh", kind: "action", title: a.refresh, actions: [{ id: "run", label: a.refresh, run: () => result(refreshEverything()) }] },
      ...(running.length > 0
        ? [{ id: "action:stop-all", kind: "action" as const, title: a.stopAllDocker, actions: [{ id: "run", label: a.stopAllDocker, confirm: a.stopAllConfirm(running.length), run: () => result(actOnDockerContainers("stop", running)) }] }]
        : []),
    ];
    return [...projects, ...pages, ...containers, ...accesses, ...vpns, ...servers, ...globals];
  }, [data, messages, a, m.done, router, flash, claude]);

  /** An action of an entry, listed as an entry of its own; its id keeps the entry's, for the recent ones. */
  const actionEntry = (entry: Entry, action: Action): Entry => ({
    id: `${entry.id}#${action.id}`,
    kind: entry.kind,
    title: `${entry.title} › ${action.label}`,
    subtitle: entry.subtitle,
    actions: [action],
  });

  const shown = useMemo<Entry[]>(() => {
    // ">": every action of every entry.
    if (query.startsWith(">")) {
      const flat = entries.flatMap((entry) => (entry.kind === "action" ? [entry] : entry.actions.map((action) => actionEntry(entry, action))));
      return rank(flat, query.slice(1), recent).slice(0, LIMIT);
    }
    // "quich / claude": the entry first, then one of its actions.
    if (query.includes("/")) {
      return rankActions(
        entries.filter(({ kind }) => kind !== "action"),
        query,
        recent,
      )
        .map(({ entry, action }) => actionEntry(entry, action))
        .slice(0, LIMIT);
    }
    return rank(
      entries.filter(({ kind }) => kind !== "action" || query.trim()),
      query,
      recent,
    ).slice(0, LIMIT);
  }, [entries, query, recent]);

  const close = () => dialog.current?.close();

  const run = (entry: Entry, action: Action) => {
    writeRecent(remember(readRecent(), entry.id.split("#")[0]));
    close();
    if (action.confirm) confirm({ ...action.confirm, action: action.label, danger: true, onConfirm: () => void action.run() });
    else void action.run();
  };

  const choose = (index: number) => {
    const entry = shown[index];
    if (entry) run(entry, entry.actions[0]);
  };

  /** Tab writes "Name / ": the list then holds its actions, to narrow by typing on. */
  const toActions = (index: number) => {
    const entry = shown[index];
    if (!entry || entry.kind === "action" || entry.id.includes("#")) return false;
    setQuery(`${entry.title} / `);
    setSelected(0);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((current) => (shown.length === 0 ? 0 : (current + step + shown.length) % shown.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(selected);
    } else if (event.key === "Tab" || (event.key === "ArrowRight" && event.currentTarget.selectionStart === query.length)) {
      if (toActions(selected) || event.key === "Tab") event.preventDefault();
    } else if (event.key === "Escape" && query) {
      // A first Escape empties the field, a second closes.
      event.preventDefault();
      setQuery("");
      setSelected(0);
    }
  };

  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const targets =
    opened?.kind === "docker"
      ? (data?.containers ?? []).filter(({ projectId }) => projectId === opened.projectId).map(({ id, name, running }) => ({ id, name, canConsole: running }))
      : [];
  const remoteTargets =
    opened?.kind === "remote"
      ? (data?.accesses ?? []).filter(({ projectId }) => projectId === opened.projectId).map(({ accessId, environment, label, protected: isProtected }) => ({ accessId, environment, label, protected: isProtected }))
      : [];

  return (
    <>
      {open ? (
        <dialog
          ref={dialog}
          aria-label={m.label}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === dialog.current) close();
          }}
          className="mx-auto mt-[12vh] w-[min(640px,calc(100vw-32px))] border border-rule-strong bg-panel font-sans text-[14px] text-ink shadow-2xl outline-none backdrop:bg-black/50"
        >
          <div className="flex items-center gap-2 border-b-2 border-rule-strong px-3 focus-within:border-accent">
            <input
              ref={input}
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={m.placeholder}
              aria-label={m.placeholder}
              aria-controls="palette-list"
              aria-activedescendant={shown[selected] ? `palette-${selected}` : undefined}
              role="combobox"
              aria-expanded
              spellCheck={false}
              autoComplete="off"
              // The field is the whole band: the line under it shows the focus, not a ring around it.
              style={{ outline: "none" }}
              className="min-h-12 w-full bg-transparent text-[16px] placeholder:text-mut"
            />
          </div>
          <ul ref={list} id="palette-list" role="listbox" aria-label={m.label} className="max-h-[50vh] overflow-y-auto py-1">
            {shown.length === 0 ? <li className="px-3 py-2 text-mut">{data || query ? m.empty : m.loading}</li> : null}
            {shown.map((entry, index) => (
              <li
                key={entry.id}
                id={`palette-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === selected}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-1.5 ${index === selected ? "bg-accent-soft" : ""}`}
              >
                <KindBadge kind={entry.kind} label={m.kinds[entry.kind]} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{entry.title}</span>
                  {entry.subtitle ? <span className={`${DATA} block truncate text-mut`}>{entry.subtitle}</span> : null}
                </span>
                {entry.actions.length > 1 && index === selected ? <span className={`${DATA} shrink-0 text-mut`}>Tab →</span> : null}
                {entry.id.includes("#") || entry.kind === "action" ? (
                  <AreaBadge area={areaOf(entry.id.split("#")[0], entry.actions[0].id)} label={m.areas[areaOf(entry.id.split("#")[0], entry.actions[0].id)]} />
                ) : null}
              </li>
            ))}
          </ul>
          <p className={`${DATA} border-t border-rule px-3 py-1.5 text-mut`}>{m.help}</p>
        </dialog>
      ) : null}
      {opened?.kind === "docker" ? <DockerWindow projectId={opened.projectId} targets={targets} first={opened.first} onClose={() => setOpened(null)} /> : null}
      {opened?.kind === "remote" ? <RemoteWindow projectId={opened.projectId} targets={remoteTargets} first={opened.first} onClose={() => setOpened(null)} /> : null}
      {confirmation}
    </>
  );
}

/** In the header: the same palette, for whoever does not know its shortcut. */
export function PaletteButton() {
  const m = useMessages().palette;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE))}
      className="inline-flex min-h-8 items-center gap-3 self-center border border-rule-strong bg-field pr-1.5 pl-2.5 text-mut hover:border-accent/50 hover:text-ink"
    >
      {m.open}
      <kbd className="border border-rule-strong bg-panel px-1.5 font-mono text-[11px] leading-[18px]">{m.shortcut}</kbd>
    </button>
  );
}
