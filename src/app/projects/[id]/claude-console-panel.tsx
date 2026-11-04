"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { openClaudeConsole, readClaudeConsoleUsage } from "@/app/actions";
import { DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { StateKind } from "@/lib/docker-state";
import { TerminalPanel } from "./terminal-panel";

const USAGE_REFRESH_MS = 5000;

export function ClaudeConsolePanel({
  projectId,
  projectName,
  resumeId,
  shown,
  frame,
  controls,
  onSession,
  onStatusChange,
  onClose,
}: {
  projectId: number;
  projectName: string;
  resumeId?: string;
  shown: boolean;
  frame: RefObject<HTMLElement | null>;
  controls: React.ReactNode;
  onSession: (sessionId: string) => void;
  onStatusChange: (kind: StateKind) => void;
  onClose: () => void;
}) {
  const messages = useMessages();
  const m = messages.sheet.claudeConsole;
  // Connecting again goes back to the conversation that was open, rather than starting another.
  const session = useRef(resumeId ?? null);
  const [openedAt] = useState(() => Date.now());
  const [usage, setUsage] = useState({ costInDollars: 0, calls: 0 });

  // Only the console being looked at asks: a request of the app waits for the one before it.
  useEffect(() => {
    if (!shown) return;
    const refresh = () => {
      readClaudeConsoleUsage(projectId, session.current, openedAt).then(({ costInDollars, calls, sessionId }) => {
        setUsage({ costInDollars, calls });
        if (sessionId && sessionId !== session.current) {
          session.current = sessionId;
          onSession(sessionId);
        }
      }, () => undefined);
    };
    refresh();
    const timer = setInterval(refresh, USAGE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [shown, projectId, openedAt, onSession]);

  const cost = new Intl.NumberFormat(messages.gitTab.dateLocale, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  }).format(usage.costInDollars);

  return (
    <TerminalPanel
      title={m.title(projectName)}
      open={async () => {
        const grant = await openClaudeConsole(projectId, session.current);
        if ("sessionId" in grant) {
          session.current = grant.sessionId;
          onSession(grant.sessionId);
        }
        return grant;
      }}
      reconnectLabel={m.resume}
      closeLabel={m.endSession}
      embedded={{ shown, frame }}
      controls={controls}
      onStatusChange={onStatusChange}
      onClose={onClose}
      info={
        <span className={`${DATA} text-mut`} title={m.usageTitle}>
          {m.usage(cost, usage.calls)}
        </span>
      }
    />
  );
}
