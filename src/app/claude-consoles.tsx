"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { type ClaudeTask, MAX_CLAUDE_CONSOLES } from "@/lib/claude-console";
import { endClaudeConsole, listClaudeConsoles } from "./actions";
import type { StateKind } from "@/lib/docker-state";

type Project = { projectId: number; projectName: string };

export type OpenConsole = Project & {
  key: number;
  label: string;
  resumeId?: string;
  /** The conversation it is on, known once it has connected. */
  sessionId?: string;
  /** What the server knows it by, known once it has connected. */
  consoleId?: string;
  /** Set when it was found running rather than opened here: it connects when first shown. */
  since?: number;
  /** What it is asked to do when it starts. */
  task?: ClaudeTask;
  status: StateKind;
};

type Consoles = { open: (project: Project, resumeId?: string, task?: ClaudeTask) => void };

const ConsolesContext = createContext<Consoles>({ open: () => undefined });

export const useClaudeConsoles = () => useContext(ConsolesContext);

// The terminal is heavy, and most visits to a page do not open it.
const ClaudeConsoleDock = dynamic(() => import("./claude-console-dock").then(({ ClaudeConsoleDock }) => ClaudeConsoleDock), {
  ssr: false,
});

/** Above the pages, so that a console goes on while the user moves from one to the other. */
export function ClaudeConsolesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [consoles, setConsoles] = useState<OpenConsole[]>([]);
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const nextKey = useRef(1);
  const openedByProject = useRef(new Map<number, number>());

  const open = useCallback(
    ({ projectId, projectName }: Project, resumeId?: string, task?: ClaudeTask) => {
      setVisible(true);
      const existing = resumeId ? consoles.find((item) => item.sessionId === resumeId) : undefined;
      if (existing) {
        setActiveKey(existing.key);
        return;
      }
      if (consoles.length >= MAX_CLAUDE_CONSOLES) {
        setLimitReached(true);
        return;
      }
      // Numbered from the second of a project, and never reused while the page lives.
      const number = (openedByProject.current.get(projectId) ?? 0) + 1;
      openedByProject.current.set(projectId, number);
      const key = nextKey.current;
      nextKey.current += 1;
      setConsoles([
        ...consoles,
        {
          key,
          projectId,
          projectName,
          resumeId,
          sessionId: resumeId,
          task,
          label: number === 1 ? projectName : `${projectName} ${number}`,
          status: "starting",
        },
      ]);
      setActiveKey(key);
    },
    [consoles],
  );

  // What was left running before this page was loaded comes back, reduced to the button.
  useEffect(() => {
    let current = true;
    listClaudeConsoles().then((running) => {
      if (!current || running.length === 0) return;
      const found = running.map(({ consoleId, projectId, projectName, sessionId, startedAt }): OpenConsole => {
        const number = (openedByProject.current.get(projectId) ?? 0) + 1;
        openedByProject.current.set(projectId, number);
        const key = nextKey.current;
        nextKey.current += 1;
        return {
          key,
          projectId,
          projectName,
          consoleId,
          sessionId,
          resumeId: sessionId,
          since: startedAt,
          label: number === 1 ? projectName : `${projectName} ${number}`,
          status: "running",
        };
      });
      setConsoles((known) => [...known, ...found.filter(({ consoleId }) => !known.some((item) => item.consoleId === consoleId))]);
      setActiveKey((key) => key ?? found[0].key);
    }, () => undefined);
    return () => {
      current = false;
    };
  }, []);

  const end = (key: number) => {
    const index = consoles.findIndex((item) => item.key === key);
    // Closing the terminal only lets go of it: ending the session is what stops Claude.
    void endClaudeConsole(consoles[index]?.consoleId);
    const rest = consoles.filter((item) => item.key !== key);
    setConsoles(rest);
    setLimitReached(false);
    if (activeKey === key) setActiveKey(rest[Math.min(index, rest.length - 1)]?.key ?? null);
    if (rest.length === 0) setVisible(false);
    // The conversation has just added to what the page shows.
    router.refresh();
  };

  const endAll = () => {
    for (const item of consoles) void endClaudeConsole(item.consoleId);
    setConsoles([]);
    setLimitReached(false);
    setActiveKey(null);
    setVisible(false);
    router.refresh();
  };

  const onConsole = useCallback((key: number, consoleId: string) => {
    setConsoles((current) => current.map((item) => (item.key === key ? { ...item, consoleId } : item)));
  }, []);
  const onSession = useCallback((key: number, sessionId: string) => {
    setConsoles((current) => current.map((item) => (item.key === key ? { ...item, sessionId } : item)));
  }, []);
  const onStatus = useCallback((key: number, status: StateKind) => {
    setConsoles((current) => current.map((item) => (item.key === key ? { ...item, status } : item)));
  }, []);

  const anyOpen = consoles.length > 0;
  const value = useMemo(() => ({ open }), [open]);
  const active = consoles.find((item) => item.key === activeKey);

  return (
    <ConsolesContext.Provider value={value}>
      {children}
      {anyOpen ? (
        <ClaudeConsoleDock
          consoles={consoles}
          activeKey={activeKey}
          visible={visible}
          limitReached={limitReached}
          onActivate={setActiveKey}
          onShow={() => setVisible(true)}
          onHide={() => {
            setVisible(false);
            router.refresh();
          }}
          onNew={() => active && open(active)}
          onEnd={end}
          onEndAll={endAll}
          onConsole={onConsole}
          onSession={onSession}
          onStatus={onStatus}
        />
      ) : null}
    </ConsolesContext.Provider>
  );
}
