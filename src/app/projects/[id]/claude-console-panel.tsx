"use client";

import { useEffect, useRef, useState } from "react";
import { openClaudeConsole, readClaudeConsoleUsage } from "@/app/actions";
import { DATA } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import { TerminalPanel } from "./terminal-panel";

const USAGE_REFRESH_MS = 5000;

export function ClaudeConsolePanel({
  projectId,
  projectName,
  resumeId,
  onClose,
}: {
  projectId: number;
  projectName: string;
  resumeId?: string;
  onClose: () => void;
}) {
  const messages = useMessages();
  const m = messages.sheet.claudeConsole;
  // Connecting again goes back to the conversation that was open, rather than starting another.
  const session = useRef(resumeId ?? null);
  const [openedAt] = useState(() => Date.now());
  const [usage, setUsage] = useState({ costInDollars: 0, calls: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
      readClaudeConsoleUsage(projectId, openedAt).then(setUsage, () => undefined);
    }, USAGE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [projectId, openedAt]);

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
        if ("sessionId" in grant) session.current = grant.sessionId;
        return grant;
      }}
      reconnectLabel={m.resume}
      onClose={onClose}
      info={
        <span className={`${DATA} text-mut`} title={m.usageTitle}>
          {m.usage(cost, usage.calls)}
        </span>
      }
    />
  );
}
