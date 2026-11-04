"use client";

import type { ReactNode } from "react";
import { useMessages } from "@/i18n/provider";
import { dockerLabel, formatAge, formatSize, type RegistryRow, runningCount } from "@/lib/registry";
import { parseRemote, publishedPorts } from "@/lib/remote";
import { OpenIcon } from "./icons";
import { CARD, DATA, SECTION_TITLE } from "./ui";

function Fact({ label, children, alert }: { label: string; children: ReactNode; alert?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-rule py-1.5 last:border-b-0">
      <dt className="shrink-0 text-mut">{label}</dt>
      <dd className={`${DATA} min-w-0 truncate text-right ${alert ? "font-medium text-alert" : ""}`}>{children}</dd>
    </div>
  );
}

function Section({ title, children, card = false }: { title: string; children: ReactNode; card?: boolean }) {
  return (
    <section className={card ? CARD : undefined}>
      <h2 className={SECTION_TITLE}>{title}</h2>
      <dl>{children}</dl>
    </section>
  );
}

const list = (items: string[]) => items.join(", ") || "—";
const count = (value: number | null) => (value === null ? "—" : String(value));

export function ProjectFacts({
  row,
  now,
  wide = false,
  children,
}: {
  row: RegistryRow;
  now: number;
  /** On a full page: side by side, and without what that page shows in more detail. */
  wide?: boolean;
  children?: ReactNode;
}) {
  const messages = useMessages();
  const m = messages.facts;
  const remote = row.remoteUrl ? parseRemote(row.remoteUrl) : null;
  const ports = [...new Set(row.containers.flatMap((container) => publishedPorts(container.ports)))];
  const total = row.containers.length;
  const docCount = row.docs.length;
  const hasReadme = row.docs.some((doc) => /^readme/i.test(doc));

  return (
    <div className={wide ? "grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3" : "grid gap-5"}>
      <Section title={m.project} card={wide}>
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
        <Section title={m.git} card={wide}>
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
              <a href={remote.url} target="_blank" rel="noreferrer" title={row.remoteUrl ?? undefined} className="inline-flex max-w-full items-center gap-1 hover:text-accent">
                <span className="truncate">{remote.label}</span>
                <OpenIcon />
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
        <Section title={m.git} card={wide}>
          <Fact label={m.repository}>{m.none}</Fact>
        </Section>
      )}

      {wide ? null : (
        <Section title={m.docker}>
          <Fact label={m.state}>{dockerLabel(row, messages.docker)}</Fact>
          <Fact label={m.runningServices}>{total === 0 ? "—" : m.runningOf(runningCount(row), total)}</Fact>
          <Fact label={m.publishedPorts}>{list(ports)}</Fact>
        </Section>
      )}

      {/* The two short blocks share a column next to the long ones. */}
      <div className={wide ? "grid gap-4" : "contents"}>
        <Section title={m.disk} card={wide}>
          <Fact label={m.withoutDependencies}>{formatSize(row.sizeBytes, messages.size)}</Fact>
          <Fact label={m.dependencies}>{formatSize(row.depsBytes, messages.size)}</Fact>
          <Fact label={m.gitFolder}>{formatSize(row.gitBytes, messages.size)}</Fact>
        </Section>
        {children}
      </div>

      {wide ? null : (
        <Section title={m.configuration}>
          <Fact label={m.envFiles}>{list(row.envFiles)}</Fact>
        </Section>
      )}
    </div>
  );
}
