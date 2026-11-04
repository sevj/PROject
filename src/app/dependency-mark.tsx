"use client";

import { useMessages } from "@/i18n/provider";
import type { RegistryRow } from "@/lib/registry";
import { BADGE, BADGE_ALERT } from "./ui";

/** What the last analysis found, in the list. Nothing when the project was never analyzed or is clean. */
export function DependencyMark({ alerts }: { alerts: RegistryRow["dependencies"] }) {
  const m = useMessages().dependencies;
  if (!alerts || (alerts.vulnerabilities === 0 && alerts.outdated === 0)) return null;
  return (
    <span className="ml-2 inline-flex gap-1 align-middle">
      {alerts.vulnerabilities > 0 ? (
        <span
          className={alerts.worst === "critical" || alerts.worst === "high" ? BADGE_ALERT : BADGE}
          title={`${m.vulnerabilities}: ${alerts.vulnerabilities}${alerts.worst ? ` (${m.severity[alerts.worst]})` : ""}`}
        >
          ⚠ {alerts.vulnerabilities}
        </span>
      ) : null}
      {alerts.outdated > 0 ? (
        <span className={BADGE} title={`${m.outdated}: ${alerts.outdated}${alerts.major > 0 ? ` · ${m.major(alerts.major)}` : ""}`}>
          ↑ {alerts.outdated}
        </span>
      ) : null}
    </span>
  );
}
