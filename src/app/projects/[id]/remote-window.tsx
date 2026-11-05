"use client";

import { useCallback, useRef } from "react";
import { BADGE_ALERT } from "@/app/ui";
import { useConfirm } from "@/app/modal";
import { useMessages } from "@/i18n/provider";
import type { StateKind } from "@/lib/docker-state";
import { openRemoteConsole } from "../../environment-actions";
import { MENU_HEADING, MENU_ITEM, TabPanel, TabWindow, useWindowTabs } from "./tab-window";
import { TerminalPanel } from "./terminal-panel";

/** An access of one of the project's environments that a console can be opened on. */
export type RemoteTarget = { accessId: number; environment: string; label: string; protected: boolean };

/** `confirmed`: asked for an environment that asks first, and kept for its reconnections. */
export type RemoteTab = { accessId: number; confirmed: boolean };

type OpenTab = RemoteTab & { key: number; status: StateKind };

/** The SSH and kubectl consoles of a project, as tabs of one window. */
export function RemoteWindow({ projectId, targets, first, onClose }: { projectId: number; targets: RemoteTarget[]; first: RemoteTab; onClose: () => void }) {
  const messages = useMessages();
  const m = messages.environments;
  const frame = useRef<HTMLElement>(null);
  const { confirm, confirmation } = useConfirm();
  const { tabs, active, setActive, add, close, setStatus } = useWindowTabs<OpenTab>({ ...first, status: "starting" }, onClose);
  const targetOf = (accessId: number) => targets.find((target) => target.accessId === accessId);
  const label = (accessId: number) => {
    const target = targetOf(accessId);
    return target ? `${target.environment} · ${target.label}` : String(accessId);
  };

  const ask = (target: RemoteTarget) => {
    if (!target.protected) {
      add({ accessId: target.accessId, confirmed: false, status: "starting" });
      return;
    }
    confirm({
      ...m.consoleConfirm(target.environment, target.label),
      action: m.console,
      danger: true,
      onConfirm: () => add({ accessId: target.accessId, confirmed: true, status: "starting" }),
    });
  };

  const environments = [...new Set(targets.map(({ environment }) => environment))];

  return (
    <>
      <TabWindow
        label={m.windowLabel}
        addLabel={m.windowAdd}
        closeLabel={messages.sheet.dockerWindow.closeTab}
        frame={frame}
        tabs={tabs.map((tab) => ({ key: tab.key, label: label(tab.accessId), status: tab.status }))}
        active={active}
        onActivate={setActive}
        onCloseTab={close}
        onCloseAll={onClose}
        menu={(done) =>
          environments.map((environment) => (
            <div key={environment} className="grid">
              <p className={MENU_HEADING}>{environment}</p>
              {targets
                .filter((target) => target.environment === environment)
                .map((target) => (
                  <button key={target.accessId} type="button" onClick={() => (done(), ask(target))} className={MENU_ITEM}>
                    {target.label}
                    {target.protected ? <span className={`${BADGE_ALERT} ml-2`}>{m.protectedBadge}</span> : null}
                  </button>
                ))}
            </div>
          ))
        }
      >
        {tabs.map((tab) => (
          <TabPanel key={tab.key} tabKey={tab.key} active={tab.key === active}>
            <RemotePanel
              tab={tab}
              projectId={projectId}
              title={label(tab.accessId)}
              isProtected={targetOf(tab.accessId)?.protected ?? false}
              shown={tab.key === active}
              frame={frame}
              onStatus={setStatus}
              onClose={() => close(tab.key)}
            />
          </TabPanel>
        ))}
      </TabWindow>
      {confirmation}
    </>
  );
}

function RemotePanel({
  tab,
  projectId,
  title,
  isProtected,
  shown,
  frame,
  onStatus,
  onClose,
}: {
  tab: OpenTab;
  projectId: number;
  title: string;
  isProtected: boolean;
  shown: boolean;
  frame: React.RefObject<HTMLElement | null>;
  onStatus: (key: number, status: StateKind) => void;
  onClose: () => void;
}) {
  const messages = useMessages();
  const { key, accessId, confirmed } = tab;
  const status = useCallback((kind: StateKind) => onStatus(key, kind), [key, onStatus]);
  const open = useCallback(() => openRemoteConsole(projectId, accessId, confirmed), [projectId, accessId, confirmed]);
  return (
    <TerminalPanel
      title={title}
      open={open}
      reconnectLabel={messages.sheet.console.reconnect}
      info={isProtected ? <span className={BADGE_ALERT}>{messages.environments.protectedBadge}</span> : undefined}
      embedded={{ shown, frame }}
      onStatusChange={status}
      onClose={onClose}
    />
  );
}
