"use client";

import { type RefObject, useCallback, useRef } from "react";
import { BUTTON } from "@/app/ui";
import { useMessages } from "@/i18n/provider";
import type { StateKind } from "@/lib/docker-state";
import { ConsolePanel } from "./console-panel";
import { LogsPanel } from "./logs-panel";
import { MENU_HEADING, MENU_ITEM, TabPanel, TabWindow, useWindowTabs } from "./tab-window";

/** A container of the project, as the window can open it. */
export type WindowTarget = { id: string; name: string; canConsole: boolean };

/** `containerId` absent on logs: all the containers of the project together. */
export type WindowTab = { kind: "console" | "logs"; containerId?: string };

type OpenTab = WindowTab & { key: number; name: string; status: StateKind };

/**
 * The consoles and logs of a project, as tabs of one window: several shells side by side, and
 * a container's logs one click away from its console. Closing the window ends its consoles.
 */
export function DockerWindow({ projectId, targets, first, onClose }: { projectId: number; targets: WindowTarget[]; first: WindowTab; onClose: () => void }) {
  const messages = useMessages();
  const m = messages.sheet.dockerWindow;
  const frame = useRef<HTMLElement>(null);
  const nameOf = (id?: string) => (id ? (targets.find((target) => target.id === id)?.name ?? id.slice(0, 12)) : "");
  const { tabs, active, setActive, add, close, setStatus } = useWindowTabs<OpenTab>({ ...first, name: nameOf(first.containerId), status: "starting" }, onClose);

  const open = (tab: WindowTab) => {
    // A container's logs are read once: their tab is shown again rather than doubled.
    const same = tab.kind === "logs" ? tabs.find((item) => item.kind === "logs" && item.containerId === tab.containerId) : undefined;
    if (same) setActive(same.key);
    else add({ ...tab, name: nameOf(tab.containerId), status: "starting" });
  };

  const label = (tab: OpenTab) => (tab.kind === "console" ? m.consoleOf(tab.name) : tab.containerId ? m.logsOf(tab.name) : m.allLogs);
  const consoles = targets.filter(({ canConsole }) => canConsole);

  return (
    <TabWindow
      label={m.label}
      addLabel={m.add}
      closeLabel={m.closeTab}
      frame={frame}
      tabs={tabs.map((tab) => ({ key: tab.key, label: label(tab), status: tab.status }))}
      active={active}
      onActivate={setActive}
      onCloseTab={close}
      onCloseAll={onClose}
      menu={(done) => (
        <>
          <p className={MENU_HEADING}>{m.consoles}</p>
          {consoles.length === 0 ? <p className="px-3 py-1 text-mut">{m.noRunning}</p> : null}
          {consoles.map((target) => (
            <button key={target.id} type="button" onClick={() => (done(), open({ kind: "console", containerId: target.id }))} className={MENU_ITEM}>
              {target.name}
            </button>
          ))}
          <p className={`${MENU_HEADING} mt-1 border-t border-rule`}>{m.logs}</p>
          {targets.length > 1 ? (
            <button type="button" onClick={() => (done(), open({ kind: "logs" }))} className={MENU_ITEM}>
              {m.allContainers}
            </button>
          ) : null}
          {targets.map((target) => (
            <button key={target.id} type="button" onClick={() => (done(), open({ kind: "logs", containerId: target.id }))} className={MENU_ITEM}>
              {target.name}
            </button>
          ))}
        </>
      )}
    >
      {tabs.map((tab) => (
        <TabPanel key={tab.key} tabKey={tab.key} active={tab.key === active}>
          <WindowPanel
            tab={tab}
            projectId={projectId}
            shown={tab.key === active}
            frame={frame}
            allLabel={messages.sheet.logs.allContainers}
            onOpen={open}
            onStatus={setStatus}
            onClose={() => close(tab.key)}
          />
        </TabPanel>
      ))}
    </TabWindow>
  );
}

function WindowPanel({
  tab,
  projectId,
  shown,
  frame,
  allLabel,
  onOpen,
  onStatus,
  onClose,
}: {
  tab: OpenTab;
  projectId: number;
  shown: boolean;
  frame: RefObject<HTMLElement | null>;
  allLabel: string;
  onOpen: (tab: WindowTab) => void;
  onStatus: (key: number, status: StateKind) => void;
  onClose: () => void;
}) {
  const m = useMessages().sheet.dockerWindow;
  const { key } = tab;
  // Stable, since the panels watch it.
  const status = useCallback((kind: StateKind) => onStatus(key, kind), [key, onStatus]);
  if (tab.kind === "console" && tab.containerId) {
    return (
      <ConsolePanel
        projectId={projectId}
        containerId={tab.containerId}
        containerName={tab.name}
        embedded={{ shown, frame }}
        onStatusChange={status}
        controls={
          <button type="button" title={m.openLogsHint} onClick={() => onOpen({ kind: "logs", containerId: tab.containerId })} className={BUTTON}>
            {m.openLogs}
          </button>
        }
        onClose={onClose}
      />
    );
  }
  return <LogsPanel projectId={projectId} containerId={tab.containerId} containerName={tab.containerId ? tab.name : allLabel} embedded onStatusChange={status} onClose={onClose} />;
}
