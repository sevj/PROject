"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useMessages } from "@/i18n/provider";
import { type DependencyAnalysis, type EcosystemResult, type Severity, SEVERITIES, summarize } from "@/lib/dependencies";
import { formatAge } from "@/lib/registry";
import { useFlash } from "@/app/flash";
import { BADGE, BADGE_ALERT, BUTTON, BUTTON_PRIMARY, CARD, DATA, LABEL, LINK, SECTION_TITLE } from "@/app/ui";
import { analyzeProject } from "./security-actions";

const STALE_AFTER_MS = 7 * 24 * 3600 * 1000;
const SHOWN_ADVISORIES = 30;

function SeverityBadge({ severity }: { severity: Severity }) {
  const m = useMessages().dependencies;
  return <span className={severity === "critical" || severity === "high" ? BADGE_ALERT : BADGE}>{m.severity[severity]}</span>;
}

function Failure({ reason, kind }: { reason: string; kind: "outdated" | "audit" }) {
  const m = useMessages().dependencies;
  const text = reason === "composer" ? m.composerMissing : kind === "outdated" ? m.outdatedError(reason) : m.auditError(reason);
  return <p className="text-alert">{text}</p>;
}

function EcosystemCard({ result }: { result: EcosystemResult }) {
  const m = useMessages().dependencies;
  const shownAdvisories = result.advisories.slice(0, SHOWN_ADVISORIES);
  return (
    <section className={`${CARD} grid gap-3`}>
      <h3 className={SECTION_TITLE}>
        {result.ecosystem} · {m.folder(result.folder)}
        {result.runner === "-" ? "" : ` · ${m.runner(result.runner)}`}
      </h3>
      {result.outdatedError ? <Failure reason={result.outdatedError} kind="outdated" /> : null}
      {result.auditError && result.auditError !== result.outdatedError ? <Failure reason={result.auditError} kind="audit" /> : null}

      {result.advisories.length > 0 ? (
        <div>
          <p className={`${LABEL} pb-1`}>{m.advisories}</p>
          <ul className="grid gap-1">
            {shownAdvisories.map((advisory, index) => (
              <li key={`${advisory.package}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-rule py-1.5">
                <SeverityBadge severity={advisory.severity} />
                <span className={`${DATA} font-medium`}>{advisory.package}</span>
                {advisory.url ? (
                  <a href={advisory.url} target="_blank" rel="noreferrer noopener" className={LINK}>
                    {advisory.title || m.details}
                  </a>
                ) : (
                  <span>{advisory.title}</span>
                )}
                {advisory.range ? (
                  <span className={`${DATA} max-w-full truncate text-mut`} title={advisory.range}>
                    {advisory.range}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {result.advisories.length > shownAdvisories.length ? (
            <p className="pt-1 text-mut">{m.moreAdvisories(result.advisories.length - shownAdvisories.length)}</p>
          ) : null}
        </div>
      ) : null}

      {result.outdated.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse text-left">
            <thead>
              <tr className={LABEL}>
                <th className="py-1 pr-3 font-normal">{m.package}</th>
                <th className="py-1 pr-3 font-normal">{m.current}</th>
                <th className="py-1 font-normal">{m.latest}</th>
              </tr>
            </thead>
            <tbody>
              {result.outdated.map((item) => (
                <tr key={item.name} className="border-t border-rule">
                  <td className={`${DATA} py-1 pr-3 break-all`}>
                    {item.name} {item.dev ? <span className={BADGE}>{m.dev}</span> : null}
                  </td>
                  <td className={`${DATA} py-1 pr-3 text-mut`}>{item.current ?? "—"}</td>
                  <td className={`${DATA} py-1`}>
                    {item.latest ?? "—"} {item.major ? <span className={BADGE_ALERT}>{m.majorBadge}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {!result.outdatedError && !result.auditError && result.advisories.length === 0 && result.outdated.length === 0 ? (
        <p className="text-mut">
          {m.none} · {m.allUpToDate}
        </p>
      ) : null}
    </section>
  );
}

export function SecurityTab({
  projectId,
  stored,
  now,
  readOnly,
}: {
  projectId: number;
  stored: { analysis: DependencyAnalysis; analyzedAt: number } | null;
  now: number;
  readOnly: boolean;
}) {
  const messages = useMessages();
  const m = messages.dependencies;
  const flash = useFlash();
  const router = useRouter();
  const [pending, start] = useTransition();

  const analyze = () =>
    start(async () => {
      const error = await analyzeProject(projectId);
      if (error) flash("error", error);
      router.refresh();
    });

  const summary = stored ? summarize(stored.analysis) : null;
  const old = stored !== null && now - stored.analyzedAt > STALE_AFTER_MS;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[20px] leading-tight font-bold tracking-tight">{m.title}</h2>
          <p className="text-mut">{m.intro}</p>
        </div>
        <div className="flex items-center gap-3">
          {stored ? (
            <span className="text-mut">
              {m.analyzedAgo(formatAge(stored.analyzedAt, now, messages.age))}
              {old ? ` · ${m.stale}` : ""}
            </span>
          ) : null}
          <button type="button" disabled={pending || readOnly} onClick={analyze} className={stored ? BUTTON : BUTTON_PRIMARY}>
            {pending ? m.analyzing : stored ? m.again : m.analyze}
          </button>
        </div>
      </div>
      {pending ? <p className="text-mut">{m.analyzingHint}</p> : null}

      {!stored ? (
        <section className={CARD}>
          <p className="font-medium">{m.never}</p>
          <p className="pt-1 text-mut">{m.neverHint}</p>
        </section>
      ) : stored.analysis.results.length === 0 ? (
        <section className={CARD}>
          <p className="text-mut">{m.noManifest}</p>
        </section>
      ) : (
        <>
          {summary ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={CARD}>
                <p className={LABEL}>{m.vulnerabilities}</p>
                <p className={`pt-1 text-[24px] leading-tight font-bold tracking-tight ${summary.vulnerabilities > 0 ? "text-alert" : ""}`}>
                  {summary.vulnerabilities}
                </p>
                <p className="flex flex-wrap gap-1 pt-1 text-mut">
                  {summary.vulnerabilities === 0
                    ? m.none
                    : SEVERITIES.filter((severity) => summary.bySeverity[severity] > 0).map((severity) => (
                        <span key={severity} className={severity === "critical" || severity === "high" ? BADGE_ALERT : BADGE}>
                          {summary.bySeverity[severity]} {m.severity[severity]}
                        </span>
                      ))}
                </p>
              </div>
              <div className={CARD}>
                <p className={LABEL}>{m.outdated}</p>
                <p className="pt-1 text-[24px] leading-tight font-bold tracking-tight">{summary.outdated}</p>
                <p className="text-mut">{summary.outdated === 0 ? m.allUpToDate : summary.major > 0 ? m.major(summary.major) : ""}</p>
              </div>
            </div>
          ) : null}
          {stored.analysis.results.map((result) => (
            <EcosystemCard key={`${result.ecosystem}-${result.folder}`} result={result} />
          ))}
        </>
      )}
    </div>
  );
}
