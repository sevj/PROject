"use client";

import type { ReactNode } from "react";
import { useMessages } from "@/i18n/provider";
import { dockerLabel, formatAge, formatSize, type RegistryRow, runningCount } from "@/lib/registry";
import { parseRemote, publishedPorts } from "@/lib/remote";
import { DATA, LABEL } from "./ui";

function Fact({ label, children, alert }: { label: string; children: ReactNode; alert?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0">
      <dt className="shrink-0 text-mut">{label}</dt>
      <dd className={`${DATA} min-w-0 truncate text-right ${alert ? "font-medium text-alert" : ""}`}>{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className={`${LABEL} border-b border-ink pb-1`}>{title}</h2>
      <dl>{children}</dl>
    </section>
  );
}

const list = (items: string[]) => items.join(", ") || "—";
const count = (value: number | null) => (value === null ? "—" : String(value));

export function ProjectFacts({ row, now }: { row: RegistryRow; now: number }) {
  const messages = useMessages();
  const m = messages.facts;
  const remote = row.remoteUrl ? parseRemote(row.remoteUrl) : null;
  const ports = [...new Set(row.containers.flatMap((container) => publishedPorts(container.ports)))];
  const total = row.containers.length;
  const docCount = row.docs.length;
  const hasReadme = row.docs.some((doc) => /^readme/i.test(doc));

  return (
    <div className="grid gap-5">
      <Section title={m.project}>
        <Fact label={m.stack}>{row.stacks.join(" + ") || "—"}</Fact>
        {row.versions.map(({ label, value }) => (
          <Fact key={label} label={label}>
            {value}
          </Fact>
        ))}
        <Fact label={m.packages}>{list(row.packageManagers)}</Fact>
        <Fact label={m.ci}>{list(row.ci)}</Fact>
        <Fact label={m.tests}>{list(row.testTools)}</Fact>
        <Fact label={m.documentation}>{docCount === 0 ? m.noDocs : m.docCount(docCount, hasReadme)}</Fact>
      </Section>

      {row.hasGit ? (
        <Section title={m.git}>
          <Fact label={m.lastCommit}>{row.lastCommitAt === null ? m.none : formatAge(row.lastCommitAt, now, messages.age)}</Fact>
          {row.lastCommitSubject ? (
            <div className="border-b border-rule py-1.5 break-words">{row.lastCommitSubject}</div>
          ) : null}
          <Fact label={m.lastAuthor}>{row.lastCommitAuthor ?? "—"}</Fact>
          <Fact label={m.branch}>{row.branch ?? m.detachedHead}</Fact>
          <Fact label={m.remote}>
            {remote === null ? (
              m.none
            ) : remote.url ? (
              <a href={remote.url} target="_blank" rel="noreferrer" title={row.remoteUrl ?? undefined} className="underline hover:text-ink">
                {remote.label}
              </a>
            ) : (
              remote.label
            )}
          </Fact>
          <Fact label={m.gap}>{row.upstream ? `+${row.ahead ?? 0} −${row.behind ?? 0}` : m.noUpstream}</Fact>
          <Fact label={m.changedFiles} alert={(row.dirtyCount ?? 0) > 0}>
            {String(row.dirtyCount ?? 0)}
          </Fact>
          <Fact label={m.commits}>{String(row.commitCount ?? 0)}</Fact>
          <Fact label={m.localBranches}>{count(row.branchCount)}</Fact>
          <Fact label={m.stashes} alert={(row.stashCount ?? 0) > 0}>
            {count(row.stashCount)}
          </Fact>
          <Fact label={m.firstCommit}>{row.firstCommitAt === null ? "—" : m.ago(formatAge(row.firstCommitAt, now, messages.age))}</Fact>
        </Section>
      ) : (
        <Section title={m.git}>
          <Fact label={m.repository}>{m.none}</Fact>
        </Section>
      )}

      <Section title={m.docker}>
        <Fact label={m.state}>{dockerLabel(row, messages.docker)}</Fact>
        <Fact label={m.runningServices}>{total === 0 ? "—" : m.runningOf(runningCount(row), total)}</Fact>
        <Fact label={m.publishedPorts}>{list(ports)}</Fact>
      </Section>

      <Section title={m.disk}>
        <Fact label={m.withoutDependencies}>{formatSize(row.sizeBytes, messages.size)}</Fact>
        <Fact label={m.dependencies}>{formatSize(row.depsBytes, messages.size)}</Fact>
        <Fact label={m.gitFolder}>{formatSize(row.gitBytes, messages.size)}</Fact>
      </Section>

      <Section title={m.configuration}>
        <Fact label={m.envFiles}>{list(row.envFiles)}</Fact>
      </Section>
    </div>
  );
}
