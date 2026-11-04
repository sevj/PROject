import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatAge, runningCount } from "@/lib/registry";
import { getDb } from "@/server/db/client";
import { readProjectDoc } from "@/server/project-files";
import { getProject } from "@/server/registry";
import { readRecentCommits } from "@/server/scan/git";
import { isSizing } from "@/server/scan/jobs";
import { ClassificationEditor } from "../../classification-editor";
import { ProjectButtons } from "../../project-buttons";
import { ProjectDescription } from "../../project-description";
import { ProjectFacts } from "../../project-facts";
import { ProjectName } from "../../project-name";
import { TagPicker } from "../../tag-picker";
import { DATA, LABEL } from "../../ui";
import { EnvFiles } from "./env-files";
import { RefreshButton } from "./refresh-button";

const SECTION = "border-b border-rule px-5 pt-[18px] pb-[22px]";

function ActivityChart({ weeks }: { weeks: number[] }) {
  const peak = Math.max(...weeks, 1);
  const total = weeks.reduce((sum, commits) => sum + commits, 0);
  return (
    <>
      <div className="mb-3.5 flex flex-wrap justify-between gap-x-4 gap-y-1">
        <h2 className={LABEL}>Commits par semaine, 26 dernières semaines</h2>
        <span className={`${DATA} text-mut`}>
          {total} au total · pic à {Math.max(...weeks)}
        </span>
      </div>
      <div
        className="grid h-[150px] grid-cols-[repeat(26,minmax(0,1fr))] items-end gap-x-0.5 border-b border-ink"
        role="img"
        aria-label={`${total} commits sur 26 semaines, pic à ${Math.max(...weeks)}`}
      >
        {weeks.map((commits, index) => (
          <div
            key={index}
            className="group flex h-full items-end"
            title={`Il y a ${weeks.length - 1 - index} sem. : ${commits} commit${commits > 1 ? "s" : ""}`}
          >
            <span
              className="block w-full bg-ink group-hover:bg-alert"
              style={{ height: commits === 0 ? 0 : `${Math.max(3, Math.round((commits / peak) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className={`${DATA} flex justify-between pt-1.5 text-mut`}>
        <span>il y a 25 sem.</span>
        <span>cette semaine</span>
      </div>
    </>
  );
}

async function Sheet({ params, searchParams }: PageProps<"/projects/[id]">) {
  await connection();
  const { id } = await params;
  const { doc } = await searchParams;
  const projectId = Number(id);
  const project = Number.isInteger(projectId) ? getProject(getDb(), projectId) : null;
  if (!project) notFound();

  const { row, absolutePath, docs, envFiles, now, knownTags } = project;
  // An abandoned project is not read anymore, except for what is explicitly opened below.
  const commits = row.hasGit && !row.missing && !row.abandoned ? await readRecentCommits(absolutePath) : [];
  const defaultDoc = docs.find((file) => /^readme/i.test(file)) ?? docs[0];
  // Only a path found by the scan can be opened: `doc` comes from the URL.
  const selectedDoc = typeof doc === "string" && docs.includes(doc) ? doc : defaultDoc;
  const docContent = selectedDoc && !row.missing ? await readProjectDoc(absolutePath, selectedDoc) : null;

  const running = runningCount(row);

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-ink px-5 pt-7 pb-6">
        <div className="min-w-0">
          <Link href="/" className="inline-flex min-h-8 items-center text-mut underline hover:text-ink">
            Retour au registre
          </Link>
          <div className={`${DATA} text-mut`}>{row.path}</div>
          <div className="mt-0.5">
            <ProjectName
              projectId={row.id}
              name={row.name}
              folderName={row.folderName}
              className="text-[72px] leading-none font-bold tracking-[-.04em] max-sm:text-[44px]"
            />
          </div>
          <div className="mt-2 max-w-3xl">
            <ProjectDescription projectId={row.id} description={row.description} detected={row.manifestDescription} />
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ProjectButtons row={row} />
          {row.abandoned ? null : <RefreshButton projectId={row.id} sizing={isSizing()} />}
        </div>
      </div>

      {row.abandoned ? (
        <p role="status" className={`${DATA} border-b border-rule px-5 py-2 text-mut`}>
          Projet abandonné : il n&apos;est plus scanné, ces informations datent de son dernier scan.
        </p>
      ) : null}
      {row.missing ? (
        <p role="alert" className={`${DATA} border-b border-alert px-5 py-2 text-alert`}>
          Ce dossier n&apos;existe plus sur le disque. Tes notes et ton classement sont conservés.
        </p>
      ) : null}
      {row.scanError ? (
        <p role="alert" className={`${DATA} border-b border-alert px-5 py-2 break-words text-alert`}>
          {row.scanError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-stretch">
        <div className="min-w-0 flex-[999_1_620px] border-r border-rule">
          {row.weeklyCommits ? (
            <section className={SECTION}>
              <ActivityChart weeks={row.weeklyCommits} />
            </section>
          ) : null}

          {commits.length > 0 ? (
            <section className={SECTION}>
              <h2 className={`${LABEL} mb-3.5`}>Derniers commits</h2>
              {commits.map((commit, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule py-[9px] last:border-b-0"
                >
                  <span className="break-words">{commit.subject}</span>
                  <span className={`${DATA} text-mut`}>{formatAge(commit.at.getTime(), now)}</span>
                </div>
              ))}
            </section>
          ) : null}

          <section className={`${SECTION} border-b-0`}>
            <h2 className={`${LABEL} mb-3.5`}>Documentation</h2>
            {docs.length === 0 ? (
              <p className="text-mut">Aucun document détecté.</p>
            ) : (
              <>
                <nav aria-label="Documents" className={`${DATA} mb-4 flex flex-wrap gap-x-5 gap-y-1`}>
                  {docs.map((file) => (
                    <Link
                      key={file}
                      href={`/projects/${row.id}?doc=${encodeURIComponent(file)}`}
                      aria-current={file === selectedDoc ? "page" : undefined}
                      className="inline-flex min-h-8 items-center text-mut hover:text-ink aria-[current=page]:text-ink aria-[current=page]:underline"
                    >
                      {file}
                    </Link>
                  ))}
                </nav>
                {docContent === null ? (
                  <p className="text-mut">Ce document n&apos;a pas pu être lu ou il est trop volumineux.</p>
                ) : (
                  <pre className={`${DATA} max-h-[640px] overflow-auto border border-rule bg-panel p-4 break-words whitespace-pre-wrap`}>
                    {docContent}
                  </pre>
                )}
              </>
            )}
          </section>
        </div>

        <aside className="min-w-0 flex-[1_1_400px] bg-panel">
          <section className={SECTION}>
            <h2 className={`${LABEL} mb-3.5`}>Organisation</h2>
            <div className="grid gap-4">
              <TagPicker
                projectIds={[row.id]}
                knownTags={knownTags}
                counts={Object.fromEntries(row.tags.map((tag) => [tag, 1]))}
              />
              <ClassificationEditor key={row.id} row={row} />
            </div>
          </section>
          <section className={SECTION}>
            <ProjectFacts row={row} now={now} />
          </section>
          <section className={SECTION}>
            <h2 className={`${LABEL} mb-3.5`}>
              Conteneurs · {running} lancé{running > 1 ? "s" : ""}
            </h2>
            {row.containers.length === 0 ? (
              <p className="text-mut">
                {row.hasCompose ? "Aucun conteneur créé pour ce projet." : "Pas de Docker Compose détecté."}
              </p>
            ) : (
              row.containers.map((container) => (
                <div key={container.name} className="border-b border-rule py-[9px] last:border-b-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-semibold">{container.service || container.name}</span>
                    <span className={`${DATA} shrink-0 ${container.state === "running" ? "" : "text-mut"}`}>
                      {container.status}
                    </span>
                  </div>
                  {container.ports ? <div className={`${DATA} break-words text-mut`}>{container.ports}</div> : null}
                </div>
              ))
            )}
          </section>
          <section className={`${SECTION} border-b-0`}>
            <h2 className={`${LABEL} mb-3.5`}>Variables d&apos;environnement</h2>
            {envFiles.length === 0 ? (
              <p className="text-mut">Aucun fichier .env détecté.</p>
            ) : (
              <EnvFiles projectId={row.id} files={envFiles} />
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function ProjectPage(props: PageProps<"/projects/[id]">) {
  return (
    <Suspense fallback={<main className="flex-1 p-4 font-mono text-[12.5px] text-mut">Chargement…</main>}>
      <Sheet {...props} />
    </Suspense>
  );
}
