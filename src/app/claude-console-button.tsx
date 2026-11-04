"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMessages } from "@/i18n/provider";
import { BUTTON, BUTTON_SMALL } from "./ui";

// The terminal is heavy, and most visits to a page do not open it.
const ClaudeConsolePanel = dynamic(
  () => import("./projects/[id]/claude-console-panel").then(({ ClaudeConsolePanel }) => ClaudeConsolePanel),
  { ssr: false },
);

/** Without `resumeId`, a new conversation. The panel goes on the body, away from tables and lists. */
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
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${small ? BUTTON_SMALL : BUTTON} shrink-0`}>
        {resumeId ? m.resume : m.open}
      </button>
      {open
        ? createPortal(
            <ClaudeConsolePanel
              projectId={projectId}
              projectName={projectName}
              resumeId={resumeId}
              onClose={() => {
                setOpen(false);
                // The conversation has just added to what the page shows.
                router.refresh();
              }}
            />,
            document.body,
          )
        : null}
    </>
  );
}
