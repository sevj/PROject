"use client";

import { useMessages } from "@/i18n/provider";
import { useClaudeConsoles } from "./claude-consoles";
import { BUTTON, BUTTON_SMALL } from "./ui";

/** Without `resumeId`, a new conversation. */
export function ClaudeConsoleButton({
  projectId,
  projectName,
  resumeId,
  small = false,
}: {
  projectId: number;
  projectName: string;
  resumeId?: string;
  small?: boolean;
}) {
  const m = useMessages().sheet.claudeConsole;
  const { open } = useClaudeConsoles();
  return (
    <button
      type="button"
      onClick={() => open({ projectId, projectName }, resumeId)}
      className={`${small ? BUTTON_SMALL : BUTTON} shrink-0`}
    >
      {resumeId ? m.resume : m.open}
    </button>
  );
}
