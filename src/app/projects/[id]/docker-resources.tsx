"use client";

import Link from "next/link";
import { useMessages } from "@/i18n/provider";
import { formatSize } from "@/lib/registry";
import { Bar, useLiveStats } from "@/app/resources/live-stats";
import { CARD, DATA, LABEL, LINK, SECTION_TITLE } from "@/app/ui";

/** What this project's running containers use right now: the page of every container, narrowed. */
export function DockerResources({ containerNames }: { containerNames: string[] }) {
  const messages = useMessages();
  const m = messages.resources.live;
  const live = useLiveStats();
  const stats = (live?.stats ?? []).filter((item) => containerNames.includes(item.name)).sort((a, b) => b.cpuPercent - a.cpuPercent);
  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h3 className={`${SECTION_TITLE} flex-1`}>{messages.nav.resources}</h3>
        <Link href="/resources" className={`${LINK} text-[13px]`}>
          {messages.resources.title} →
        </Link>
      </div>
      {live === null ? (
        <p className="pt-3 text-mut">{messages.common.loading}</p>
      ) : live.error ? (
        <p className="pt-3 text-alert">{messages.resources.dockerUnavailable(live.error)}</p>
      ) : stats.length === 0 ? (
        <p className="pt-3 text-mut">{m.none}</p>
      ) : (
        <div className="overflow-x-auto pt-3">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className={LABEL}>
                <th className="py-1 pr-3 font-normal">{m.name}</th>
                <th className="py-1 pr-3 font-normal">{m.cpu}</th>
                <th className="py-1 font-normal">{m.memory}</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((item) => (
                <tr key={item.id} className="border-t border-rule">
                  <td className={`${DATA} py-1.5 pr-3 break-all`}>{item.name}</td>
                  <td className="py-1.5 pr-3">
                    <Bar value={item.cpuPercent} label={`${item.cpuPercent.toFixed(1)} %`} />
                  </td>
                  <td className="py-1.5">
                    <Bar value={item.memPercent} label={formatSize(item.memBytes, messages.size)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pt-2 text-[12px] text-mut">{m.sampled}</p>
    </section>
  );
}
