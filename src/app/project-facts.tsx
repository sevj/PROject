import type { ReactNode } from "react";
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
  const remote = row.remoteUrl ? parseRemote(row.remoteUrl) : null;
  const ports = [...new Set(row.containers.flatMap((container) => publishedPorts(container.ports)))];
  const total = row.containers.length;
  const docCount = row.docs.length;
  const hasReadme = row.docs.some((doc) => /^readme/i.test(doc));

  return (
    <div className="grid gap-5">
      <Section title="Projet">
        <Fact label="Stack">{row.stacks.join(" + ") || "—"}</Fact>
        {row.versions.map(({ label, value }) => (
          <Fact key={label} label={label}>
            {value}
          </Fact>
        ))}
        <Fact label="Paquets">{list(row.packageManagers)}</Fact>
        <Fact label="CI">{list(row.ci)}</Fact>
        <Fact label="Tests">{list(row.testTools)}</Fact>
        <Fact label="Documentation">
          {docCount === 0 ? "aucune" : `${docCount} fichier${docCount > 1 ? "s" : ""}${hasReadme ? ", README" : ""}`}
        </Fact>
      </Section>

      {row.hasGit ? (
        <Section title="Git">
          <Fact label="Dernier commit">{row.lastCommitAt === null ? "aucun" : formatAge(row.lastCommitAt, now)}</Fact>
          {row.lastCommitSubject ? (
            <div className="border-b border-rule py-1.5 break-words">{row.lastCommitSubject}</div>
          ) : null}
          <Fact label="Dernier auteur">{row.lastCommitAuthor ?? "—"}</Fact>
          <Fact label="Branche">{row.branch ?? "HEAD détachée"}</Fact>
          <Fact label="Dépôt distant">
            {remote === null ? (
              "aucun"
            ) : remote.url ? (
              <a href={remote.url} target="_blank" rel="noreferrer" title={row.remoteUrl ?? undefined} className="underline hover:text-ink">
                {remote.label}
              </a>
            ) : (
              remote.label
            )}
          </Fact>
          <Fact label="Écart">{row.upstream ? `+${row.ahead ?? 0} −${row.behind ?? 0}` : "pas de suivi distant"}</Fact>
          <Fact label="Fichiers modifiés" alert={(row.dirtyCount ?? 0) > 0}>
            {String(row.dirtyCount ?? 0)}
          </Fact>
          <Fact label="Commits">{String(row.commitCount ?? 0)}</Fact>
          <Fact label="Branches locales">{count(row.branchCount)}</Fact>
          <Fact label="Stashes" alert={(row.stashCount ?? 0) > 0}>
            {count(row.stashCount)}
          </Fact>
          <Fact label="Premier commit">{row.firstCommitAt === null ? "—" : `il y a ${formatAge(row.firstCommitAt, now)}`}</Fact>
        </Section>
      ) : (
        <Section title="Git">
          <Fact label="Dépôt">aucun</Fact>
        </Section>
      )}

      <Section title="Docker">
        <Fact label="État">{dockerLabel(row)}</Fact>
        <Fact label="Services lancés">{total === 0 ? "—" : `${runningCount(row)} sur ${total}`}</Fact>
        <Fact label="Ports exposés">{list(ports)}</Fact>
      </Section>

      <Section title="Disque">
        <Fact label="Hors dépendances">{formatSize(row.sizeBytes)}</Fact>
        <Fact label="Dépendances">{formatSize(row.depsBytes)}</Fact>
        <Fact label="Dossier .git">{formatSize(row.gitBytes)}</Fact>
      </Section>

      <Section title="Configuration">
        <Fact label="Fichiers .env">{list(row.envFiles)}</Fact>
      </Section>
    </div>
  );
}
