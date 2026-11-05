"use client";

import { useMessages } from "@/i18n/provider";
import type { ClaudeTask } from "@/lib/claude-console";
import { useClaudeConsoles } from "./claude-consoles";
import { BUTTON, BUTTON_SMALL } from "./ui";

/** Without `resumeId`, a new conversation. With `task`, one that starts on that work. */
export function ClaudeConsoleButton({
  projectId,
  projectName,
  resumeId,
  task,
  small = false,
}: {
  projectId: number;
  projectName: string;
  resumeId?: string;
  task?: ClaudeTask;
  small?: boolean;
}) {
  const messages = useMessages().sheet;
  const m = messages.claudeConsole;
  const { open } = useClaudeConsoles();
  return (
    <button
      type="button"
      onClick={() => open({ projectId, projectName }, resumeId, task)}
      className={`${small ? BUTTON_SMALL : BUTTON} shrink-0`}
    >
      {task ? messages.claudeConfig.start[task] : resumeId ? m.resume : m.open}
    </button>
  );
}
