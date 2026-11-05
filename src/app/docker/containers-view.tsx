"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import type { ContainerGroup, OverviewAction, OverviewContainer } from "@/lib/docker-overview";
import { formatSize } from "@/lib/registry";
import { readablePorts } from "@/lib/remote";
import type { ContainerStat } from "@/lib/resources";
import type { DockerOverview } from "@/server/docker-overview";
import { useFlash } from "../flash";
import { useConfirm } from "../modal";
import { StateBadge } from "../projects/[id]/state-badge";
import { Bar, useLiveStats } from "../resources/live-stats";
import { BUTTON, BUTTON_DANGER, BUTTON_SMALL, BUTTON_SMALL_DANGER, CARD, CHECKBOX, DATA, LABEL, LINK, PAGE_TITLE } from "../ui";
import { actOnDockerContainers } from "./actions";

/** States change behind the page, as when a project is started from elsewhere. */
const REFRESH_MS = 10_000;

const runningIds = (containers: OverviewContainer[]) => containers.filter(({ running }) => running).map(({ id }) => id);

export function ContainersView({ overview }: { overview: DockerOverview }) {
  const messages = useMessages();
  const m = messages.containers;
  const router = useRouter();
  const flash = useFlash();
  const live = useLiveStats();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const { confirm, confirmation } = useConfirm();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  const stats = new Map((live?.stats ?? []).map((stat) => [stat.name, stat]));
  const all = overview.groups.flatMap(({ containers }) => containers);
  const running = runningIds(all);
  const stoppedCount = all.length - running.length;

  /** `key` marks what is busy, so that only its buttons wait. */
  const act = (key: string, action: OverviewAction, ids: string[]) => {
    setBusy(key);
    start(async () => {
      try {
        const result = await actOnDockerContainers(action, ids);
        if ("error" in result) flash("error", result.error);
        else flash("success", m.done(result.done));
      } finally {
        setBusy(null);
        router.refresh();
      }
    });
  };

  const groups = overview.groups
    .map((group) => ({ ...group, containers: showStopped ? group.containers : group.containers.filter(({ running }) => running) }))
    .filter(({ containers }) => containers.length > 0);

  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className={PAGE_TITLE}>{m.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className={DATA}>{m.running(running.length)}</span>
          <button type="button" disabled={pending} onClick={() => router.refresh()} className={BUTTON}>
            {m.refresh}
          </button>
          <button
            type="button"
            disabled={pending || running.length === 0}
            onClick={() =>
              confirm({ ...m.stopAllConfirm(running.length), action: m.stopAll, danger: true, onConfirm: () => act("all", "stop", running) })
            }
            className={BUTTON_DANGER}
          >
            {m.stopAll}
          </button>
        </div>
      </div>

      {overview.error ? <p role="alert" className="text-alert">{m.dockerUnavailable(overview.error)}</p> : null}

      {stoppedCount > 0 ? (
        <label className="flex cursor-pointer items-center gap-2 self-start">
          <input type="checkbox" className={CHECKBOX} checked={showStopped} onChange={(event) => setShowStopped(event.target.checked)} />
          {m.showStopped(stoppedCount)}
        </label>
      ) : null}

      {all.length === 0 && !overview.error ? <p className="text-mut">{m.none}</p> : null}
      {all.length > 0 && groups.length === 0 ? <p className="text-mut">{m.running(0)}</p> : null}

      {groups.map((group) => {
        const full = overview.groups.find(({ key }) => key === group.key) ?? group;
        const others = running.filter((id) => !full.containers.some((container) => container.id === id));
        return (
          <GroupCard
            key={group.key}
            group={group}
            stats={stats}
            busy={pending ? busy : null}
            onAct={(action, ids, key) => act(key, action, ids)}
            onOnlyThis={
              others.length > 0
                ? () =>
                    confirm({
                      ...m.onlyThisConfirm(group.label || m.loose, others.length),
                      action: m.onlyThis,
                      danger: true,
                      onConfirm: () => act(`only:${group.key}`, "stop", others),
                    })
                : null
            }
            stoppedIds={full.containers.filter(({ running }) => !running).map(({ id }) => id)}
          />
        );
      })}
      {confirmation}
    </section>
  );
}

function GroupCard({
  group,
  stats,
  busy,
  onAct,
  onOnlyThis,
  stoppedIds,
}: {
  group: ContainerGroup;
  stats: Map<string, ContainerStat>;
  busy: string | null;
  onAct: (action: OverviewAction, ids: string[], key: string) => void;
  onOnlyThis: (() => void) | null;
  stoppedIds: string[];
}) {
  const messages = useMessages();
  const m = messages.containers;
  const d = messages.sheet.dockerTab;
  const size = (bytes: number) => formatSize(bytes, messages.size);
  const up = runningIds(group.containers);
  const label = group.label || m.loose;
  const waiting = busy !== null;

  return (
    <article className={CARD}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-strong pb-2">
        <h2 className="min-w-0 font-semibold break-words">
          {group.projectId !== null ? (
            <Link href={`/projects/${group.projectId}`} className={LINK}>
              {label}
            </Link>
          ) : (
            label
          )}
          {group.projectId === null && group.key !== "loose" ? <span className={`${DATA} pl-2 text-mut`}>compose</span> : null}
        </h2>
        <div className="flex flex-wrap gap-2">
          {stoppedIds.length > 0 ? (
            <button type="button" disabled={waiting} onClick={() => onAct("start", stoppedIds, group.key)} className={BUTTON_SMALL}>
              {busy === group.key ? messages.common.loading : m.startGroup}
            </button>
          ) : null}
          {up.length > 0 ? (
            <button type="button" disabled={waiting} onClick={() => onAct("stop", up, group.key)} className={BUTTON_SMALL_DANGER}>
              {m.stopGroup}
            </button>
          ) : null}
          {onOnlyThis ? (
            <button type="button" disabled={waiting} onClick={onOnlyThis} className={BUTTON_SMALL}>
              {m.onlyThis}
            </button>
          ) : null}
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className={LABEL}>
              <th className="py-1.5 pr-3 font-normal">{messages.resources.live.name}</th>
              <th className="py-1.5 pr-3 font-normal">{m.image}</th>
              <th className="py-1.5 pr-3 font-normal">{m.ports}</th>
              <th className="py-1.5 pr-3 font-normal">{m.cpu}</th>
              <th className="py-1.5 pr-3 font-normal">{m.memory}</th>
              <th className="py-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {group.containers.map((container) => {
              const stat = stats.get(container.name);
              return (
                <tr key={container.id} className="border-t border-rule align-top">
                  <td className="py-2 pr-3">
                    <span className="block font-semibold break-all">{container.service || container.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2">
                      <StateBadge kind={container.kind} label={d.states[container.kind]} quiet={container.kind === "running"} />
                      <span className={`${DATA} text-mut`}>{container.status}</span>
                    </span>
                  </td>
                  <td className={`${DATA} py-2 pr-3 break-all text-mut`}>{container.image}</td>
                  <td className={`${DATA} max-w-[260px] py-2 pr-3 text-mut`}>
                    {readablePorts(container.ports).map((port, index) => (
                        <span key={index} className="block whitespace-nowrap">
                          {port}
                        </span>
                      ))}
                  </td>
                  <td className="py-2 pr-3">{stat ? <Bar value={stat.cpuPercent} label={`${stat.cpuPercent.toFixed(1)} %`} /> : null}</td>
                  <td className="py-2 pr-3">{stat ? <Bar value={stat.memPercent} label={size(stat.memBytes)} /> : null}</td>
                  <td className="py-2">
                    <div className="flex justify-end gap-2">
                      {container.running ? (
                        <>
                          <button type="button" disabled={waiting} onClick={() => onAct("restart", [container.id], container.id)} className={BUTTON_SMALL}>
                            {d.restart}
                          </button>
                          <button type="button" disabled={waiting} onClick={() => onAct("stop", [container.id], container.id)} className={BUTTON_SMALL_DANGER}>
                            {d.stop}
                          </button>
                        </>
                      ) : (
                        <button type="button" disabled={waiting} onClick={() => onAct("start", [container.id], container.id)} className={BUTTON_SMALL}>
                          {d.start}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </article>
  );
}
