"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { formatSize } from "@/lib/registry";
import type { DiskReport, VolumeRow } from "@/server/resources";
import { useFlash } from "../flash";
import { ProjectCleanup } from "../project-cleanup";
import { Modal } from "../modal";
import {
  BADGE,
  BADGE_ALERT,
  BUTTON,
  BUTTON_PRIMARY_DANGER,
  BUTTON_SMALL,
  BUTTON_SMALL_DANGER,
  CARD,
  DATA,
  FIELD,
  LABEL,
  LINK,
  SECTION_TITLE,
} from "../ui";
import { deleteVolume, runCleanup } from "./actions";
import { Bar, useLiveStats } from "./live-stats";

function LiveSection() {
  const messages = useMessages();
  const m = messages.resources.live;
  const live = useLiveStats();
  const size = (bytes: number) => formatSize(bytes, messages.size);
  const stats = [...(live?.stats ?? [])].sort((a, b) => b.cpuPercent - a.cpuPercent || b.memBytes - a.memBytes);
  const cpu = stats.reduce((sum, item) => sum + item.cpuPercent, 0);
  const memory = stats.reduce((sum, item) => sum + item.memBytes, 0);
  return (
    <section className={CARD}>
      <h2 className={SECTION_TITLE}>{m.title}</h2>
      {live === null ? (
        <p className="pt-3 text-mut">{messages.common.loading}</p>
      ) : live.error ? (
        <p className="pt-3 text-alert">{messages.resources.dockerUnavailable(live.error)}</p>
      ) : stats.length === 0 ? (
        <p className="pt-3 text-mut">{m.none}</p>
      ) : (
        <>
          <div className="overflow-x-auto pt-3">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className={LABEL}>
                  <th className="py-1 pr-3 font-normal">{m.name}</th>
                  <th className="py-1 pr-3 font-normal">{m.cpu}</th>
                  <th className="py-1 pr-3 font-normal">{m.memory}</th>
                  <th className="py-1 text-right font-normal">{m.pids}</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((item) => (
                  <tr key={item.id} className="border-t border-rule">
                    <td className="py-1.5 pr-3 break-all">{item.name}</td>
                    <td className="py-1.5 pr-3">
                      <Bar value={item.cpuPercent} label={`${item.cpuPercent.toFixed(1)} %`} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <Bar value={item.memPercent} label={size(item.memBytes)} />
                    </td>
                    <td className={`${DATA} py-1.5 text-right`}>{item.pids}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pt-2 text-mut">{m.total(`${cpu.toFixed(1)} %`, size(memory))}</p>
        </>
      )}
      <p className="pt-1 text-[12px] text-mut">{m.sampled}</p>
    </section>
  );
}

type CleanupKind = "images" | "containers" | "cache";

function DiskSection({ disk }: { disk: DiskReport }) {
  const messages = useMessages();
  const m = messages.resources;
  const size = (bytes: number) => formatSize(bytes, messages.size);
  const rows = (["images", "containers", "volumes", "cache"] as const).map((key) => ({
    key,
    label: m.disk[key],
    ...disk.summary[key],
  }));
  return (
    <section>
      <h2 className={SECTION_TITLE}>{m.disk.title}</h2>
      <div className="grid grid-cols-2 gap-3 pt-3 lg:grid-cols-4">
        {rows.map((row) => (
          <div key={row.key} className={CARD}>
            <p className={LABEL}>{row.label}</p>
            <p className="pt-1 text-[24px] leading-tight font-bold tracking-tight">{size(row.bytes)}</p>
            <p className="text-mut">{m.disk.count(row.count)}</p>
            <p className={row.reclaimableBytes > 0 ? "text-ink" : "text-mut"}>
              {row.reclaimableBytes > 0 ? m.disk.reclaimable(size(row.reclaimableBytes)) : m.disk.nothing}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

const SHOWN = 12;

function CleanupSection({ disk }: { disk: DiskReport }) {
  const messages = useMessages();
  const m = messages.resources.cleanup;
  const flash = useFlash();
  const router = useRouter();
  const [asked, setAsked] = useState<CleanupKind | null>(null);
  const [pending, startTransition] = useTransition();
  const size = (bytes: number) => formatSize(bytes, messages.size);
  const { plan } = disk;

  const items: Record<CleanupKind, { label: string; hint: string; lines: { key: string; text: string }[]; bytes: number }> = {
    images: {
      label: m.images,
      hint: m.imagesHint,
      lines: plan.danglingImages.map((image) => ({ key: image.id, text: `${image.id.slice(0, 12)} · ${size(image.bytes)}` })),
      bytes: plan.danglingImages.reduce((sum, image) => sum + image.bytes, 0),
    },
    containers: {
      label: m.containers,
      hint: m.containersHint,
      lines: plan.stoppedContainers.map((item) => ({ key: item.id, text: `${item.name} · ${item.image}` })),
      bytes: plan.stoppedContainers.reduce((sum, item) => sum + item.bytes, 0),
    },
    cache: {
      label: m.cache,
      hint: m.cacheHint,
      // Docker's own figure: summing the entries counts shared layers several times.
      lines: disk.summary.cache.reclaimableBytes > 0 ? [{ key: "cache", text: size(disk.summary.cache.reclaimableBytes) }] : [],
      bytes: disk.summary.cache.reclaimableBytes,
    },
  };
  const kinds = Object.keys(items) as CleanupKind[];
  const current = asked ? items[asked] : null;

  const confirm = () => {
    if (!asked || !current) return;
    const what = current.label;
    startTransition(async () => {
      const result = await runCleanup(asked);
      setAsked(null);
      if ("error" in result) flash("error", m.failed(result.error));
      else flash("success", m.done(what, result.reclaimed));
      router.refresh();
    });
  };

  return (
    <section>
      <h2 className={SECTION_TITLE}>{m.title}</h2>
      <p className="pt-3 text-mut">{m.intro}</p>
      <ul className="grid gap-2 pt-3">
        {kinds.map((kind) => {
          const item = items[kind];
          return (
            <li key={kind} className={`${CARD} flex flex-wrap items-center gap-3`}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{item.label}</p>
                <p className="text-mut">{item.hint}</p>
              </div>
              <span className={`${DATA} text-mut`}>
                {item.lines.length === 0 ? m.nothing : `${kind === "cache" ? "" : `${item.lines.length} · `}${size(item.bytes)}`}
              </span>
              <button type="button" disabled={item.lines.length === 0 || pending} onClick={() => setAsked(kind)} className={BUTTON}>
                {m.clean}
              </button>
            </li>
          );
        })}
      </ul>
      {asked && current ? (
        <Modal title={m.confirmTitle(current.label)} onClose={() => setAsked(null)}>
          <p>{m.willRemove}</p>
          <ul className={`${DATA} grid max-h-60 gap-0.5 overflow-y-auto break-all`}>
            {current.lines.slice(0, SHOWN).map((line) => (
              <li key={line.key}>{line.text}</li>
            ))}
            {current.lines.length > SHOWN ? <li className="text-mut">{m.andMore(current.lines.length - SHOWN)}</li> : null}
          </ul>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setAsked(null)} className={BUTTON}>
              {m.cancel}
            </button>
            <button type="button" disabled={pending} onClick={confirm} className={BUTTON_PRIMARY_DANGER}>
              {m.confirm}
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}

function VolumeRemoval({ volume, onClose }: { volume: VolumeRow; onClose: () => void }) {
  const messages = useMessages();
  const m = messages.resources.volumes;
  const flash = useFlash();
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = typed === volume.name;

  const remove = () =>
    startTransition(async () => {
      const result = await deleteVolume(volume.name, typed);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      flash("success", m.done(volume.name));
      onClose();
      router.refresh();
    });

  return (
    <Modal title={m.confirmTitle(volume.name.length > 24 ? `${volume.name.slice(0, 12)}…` : volume.name)} onClose={onClose}>
      <p className="text-alert">{volume.owner ? m.warnProject(volume.owner.name) : m.warnData}</p>
      <p className={`${DATA} break-all`}>
        {volume.name} · {formatSize(volume.bytes, messages.size)}
      </p>
      <label>
        <span className={`${LABEL} block pb-1`}>{m.typeName}</span>
        <input value={typed} onChange={(event) => setTyped(event.target.value)} className={FIELD} autoComplete="off" spellCheck={false} />
      </label>
      {error ? <p role="alert" className="text-alert">{error}</p> : null}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={BUTTON}>
          {messages.resources.cleanup.cancel}
        </button>
        <button type="button" disabled={!ready || pending} onClick={remove} className={BUTTON_PRIMARY_DANGER}>
          {m.confirm}
        </button>
      </div>
    </Modal>
  );
}

function VolumesSection({ disk }: { disk: DiskReport }) {
  const messages = useMessages();
  const m = messages.resources.volumes;
  const [onlyUnused, setOnlyUnused] = useState(true);
  const [removing, setRemoving] = useState<VolumeRow | null>(null);
  const shown = disk.volumes.filter((volume) => !onlyUnused || volume.links === 0);
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className={`${SECTION_TITLE} flex-1`}>{m.title}</h2>
        <button type="button" aria-pressed={onlyUnused} onClick={() => setOnlyUnused(!onlyUnused)} className={BUTTON_SMALL}>
          {onlyUnused ? m.showAll : m.onlyUnused}
        </button>
      </div>
      <p className="pt-3 text-mut">{m.intro}</p>
      {shown.length === 0 ? (
        <p className="pt-3 text-mut">{m.none}</p>
      ) : (
        <ul className="grid gap-1 pt-3">
          {shown.map((volume) => (
            <li key={volume.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule py-1.5">
              <span className={`${DATA} min-w-0 flex-1 break-all`}>{volume.name}</span>
              {volume.anonymous ? <span className={BADGE}>{m.anonymous}</span> : null}
              {volume.owner ? (
                <Link href={`/projects/${volume.owner.id}?tab=docker`} className={`${LINK} ${BADGE_ALERT}`}>
                  {volume.owner.name}
                </Link>
              ) : volume.composeProject ? (
                <span className={BADGE}>{volume.composeProject}</span>
              ) : null}
              <span className="w-36 text-mut">{volume.links > 0 ? m.inUse(volume.links) : m.unused}</span>
              <span className={`${DATA} w-20 text-right`}>{formatSize(volume.bytes, messages.size)}</span>
              <button type="button" disabled={volume.links > 0} onClick={() => setRemoving(volume)} className={BUTTON_SMALL_DANGER}>
                {m.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
      {removing ? <VolumeRemoval volume={removing} onClose={() => setRemoving(null)} /> : null}
    </section>
  );
}

export function ResourcesView({ disk }: { disk: DiskReport }) {
  const m = useMessages().resources;
  return (
    <div className="grid gap-8">
      <header>
        <h1 className="text-[32px] leading-none font-bold tracking-tight">{m.title}</h1>
        <p className="mt-2 max-w-2xl text-mut">{m.intro}</p>
      </header>
      <LiveSection />
      {disk.error ? (
        <p className="text-alert">{m.dockerUnavailable(disk.error)}</p>
      ) : (
        <>
          <DiskSection disk={disk} />
          <CleanupSection disk={disk} />
          <ProjectCleanup />
          <VolumesSection disk={disk} />
        </>
      )}
    </div>
  );
}
