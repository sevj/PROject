import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isMarkdown } from "@/lib/docs";
import { formatAge, runningCount } from "@/lib/registry";
import type { Messages } from "@/i18n";
import { getDb } from "@/server/db/client";
import { serverMessages } from "@/server/i18n";
import { listProjectFolder, readProjectDoc } from "@/server/project-files";
import { getProject } from "@/server/registry";
import { readRecentCommits } from "@/server/scan/git";
import { LoadingFallback } from "../../loading-fallback";
import { ProjectDescription } from "../../project-description";
import { ProjectDirectory } from "../../project-directory";
import { ProjectFacts } from "../../project-facts";
import { ProjectName } from "../../project-name";
import { ProjectOrganizer } from "../../project-organizer";
import { BackIcon } from "../../icons";
import { BUTTON_QUIET, DATA, LABEL } from "../../ui";
import { EnvFiles } from "./env-files";
import { MarkdownDoc } from "./markdown-doc";
import { ProjectTree } from "./project-tree";

const SECTION = "border-b border-rule px-5 pt-[18px] pb-[22px]";
const TABS = ["general", "structure", "documentation"] as const;
type Tab = (typeof TABS)[number];
const TAB =
  "-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3.5 font-medium text-mut hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink";

function ActivityChart({ weeks, m }: { weeks: number[]; m: Messages["sheet"] }) {
  const peak = Math.max(...weeks, 1);
  const total = weeks.reduce((sum, commits) => sum + commits, 0);
  return (
    <>
      <div className="mb-3.5 flex flex-wrap justify-between gap-x-4 gap-y-1">
        <h2 className={LABEL}>{m.weeklyCommits}</h2>
        <span className={`${DATA} text-mut`}>
          {m.peak(total, Math.max(...weeks))}
        </span>
      </div>
      <div
        className="grid h-[150px] grid-cols-[repeat(26,minmax(0,1fr))] items-end gap-x-0.5 border-b border-rule-strong"
        role="img"
        aria-label={m.weeklyLabel(total, Math.max(...weeks))}
      >
        {weeks.map((commits, index) => (
          <div
            key={index}
            className="group flex h-full items-end"
            title={m.weekTitle(weeks.length - 1 - index, commits)}
          >
            <span
              className="block w-full bg-accent group-hover:bg-ink"
              style={{ height: commits === 0 ? 0 : `${Math.max(3, Math.round((commits / peak) * 100))}%` }}
            />
          </div>
        ))}
      </div>
      <div className={`${DATA} flex justify-between pt-1.5 text-mut`}>
        <span>{m.weeksAgo}</span>
        <span>{m.thisWeek}</span>
      </div>
    </>
  );
}

async function Sheet({ params, searchParams }: PageProps<"/projects/[id]">) {
  await connection();
  const { id } = await params;
  const { doc, tab: requestedTab } = await searchParams;
  const tab: Tab = TABS.find((item) => item === requestedTab) ?? "general";
  const projectId = Number(id);
  const project = Number.isInteger(projectId) ? getProject(getDb(), projectId) : null;
  if (!project) notFound();

  const { row, absolutePath, docs, envFiles, now, knownTags } = project;
  const messages = serverMessages(getDb());
  const m = messages.sheet;
  // Only what the open tab shows is read.
  // An abandoned project is not read anymore, except for what is explicitly opened.
  const commits =
    tab === "general" && row.hasGit && !row.missing && !row.abandoned ? await readRecentCommits(absolutePath) : [];
  const tree = tab === "structure" && !row.missing ? await listProjectFolder(absolutePath, ".") : null;
  const defaultDoc = docs.find((file) => /^readme/i.test(file)) ?? docs[0];
  // Only a path found on disk beforehand can be opened: `doc` comes from the URL.
  const selectedDoc = typeof doc === "string" && docs.includes(doc) ? doc : defaultDoc;
  const docContent =
    tab === "documentation" && selectedDoc && !row.missing ? await readProjectDoc(absolutePath, selectedDoc) : null;

  const running = runningCount(row);

  return (
    <main className="flex-1">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 border-b border-rule-strong px-5 pt-7 pb-6">
        <div className="min-w-0">
          <Link href="/" className={BUTTON_QUIET}>
            <BackIcon />
            {m.back}
          </Link>
          <ProjectDirectory
            projectId={row.id}
            path={row.path}
            subdirectory={row.subdirectory}
            parentPath={row.parentPath}
            missing={row.missing}
          />
          <div className="mt-0.5">
            <ProjectName
              projectId={row.id}
              name={row.name}
              folderName={row.folderName}
              className="text-[44px] leading-[1.05] font-bold tracking-[-.02em] max-sm:text-[34px]"
            />
          </div>
          <div className="mt-2 max-w-3xl">
            <ProjectDescription projectId={row.id} description={row.description} detected={row.manifestDescription} />
          </div>
        </div>
        <ProjectOrganizer key={row.id} row={row} knownTags={knownTags} />
      </div>

      {row.abandoned ? (
        <p role="status" className={`${DATA} border-b border-rule px-5 py-2 text-mut`}>
          {m.abandoned}
        </p>
      ) : null}
      {row.missing ? (
        <p role="alert" className={`${DATA} border-b border-alert px-5 py-2 text-alert`}>
          {m.missing}
        </p>
      ) : null}
      {row.scanError ? (
        <p role="alert" className={`${DATA} border-b border-alert px-5 py-2 break-words text-alert`}>
          {row.scanError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-stretch">
        <div className="min-w-0 flex-[999_1_620px] border-r border-rule">
          <nav aria-label={m.tabs} className="flex flex-wrap border-b border-rule-strong px-1.5">
            {TABS.map((item) => (
              <Link
                key={item}
                href={`/projects/${row.id}?tab=${item}`}
                scroll={false}
                aria-current={tab === item ? "page" : undefined}
                className={TAB}
              >
                {m[item]}
              </Link>
            ))}
          </nav>

          {tab === "general" ? (
            <>
              {row.weeklyCommits ? (
                <section className={SECTION}>
                  <ActivityChart weeks={row.weeklyCommits} m={m} />
                </section>
              ) : null}
              {commits.length > 0 ? (
                <section className={SECTION}>
                  <h2 className={`${LABEL} mb-3.5`}>{m.recentCommits}</h2>
                  {commits.map((commit, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule py-[9px] last:border-b-0"
                    >
                      <span className="break-words">{commit.subject}</span>
                      <span className={`${DATA} text-mut`}>{formatAge(commit.at.getTime(), now, messages.age)}</span>
                    </div>
                  ))}
                </section>
              ) : null}
              {!row.weeklyCommits && commits.length === 0 ? <p className="px-5 py-5 text-mut">{m.noActivity}</p> : null}
            </>
          ) : null}

          {tab === "structure" ? (
            <section className={`${SECTION} border-b-0`}>
              {tree ? <ProjectTree projectId={row.id} listing={tree} /> : <p className="text-mut">{m.unreadableFolder}</p>}
            </section>
          ) : null}

          {tab === "documentation" ? (
            <section className={`${SECTION} border-b-0`}>
              {docs.length === 0 ? (
                <p className="text-mut">{m.noDocs}</p>
              ) : (
                <>
                  <nav aria-label={m.documents} className={`${DATA} mb-4 flex flex-wrap gap-x-5 gap-y-1`}>
                    {docs.map((file) => (
                      <Link
                        key={file}
                        href={`/projects/${row.id}?tab=documentation&doc=${encodeURIComponent(file)}`}
                        scroll={false}
                        aria-current={file === selectedDoc ? "page" : undefined}
                        className="-mx-1 inline-flex min-h-8 items-center px-1 text-mut hover:text-ink aria-[current=page]:bg-sel aria-[current=page]:text-ink"
                      >
                        {file}
                      </Link>
                    ))}
                  </nav>
                  {docContent === null ? (
                    <p className="text-mut">{m.unreadableDoc}</p>
                  ) : selectedDoc && isMarkdown(selectedDoc) ? (
                    <MarkdownDoc content={docContent} file={selectedDoc} docs={docs} projectId={row.id} />
                  ) : (
                    <pre className={`${DATA} max-h-[640px] overflow-auto border border-rule bg-panel p-4 break-words whitespace-pre-wrap`}>
                      {docContent}
                    </pre>
                  )}
                </>
              )}
            </section>
          ) : null}
        </div>

        <aside className="min-w-0 flex-[1_1_400px] bg-panel">
          <section className={SECTION}>
            <ProjectFacts row={row} now={now} />
          </section>
          <section className={SECTION}>
            <h2 className={`${LABEL} mb-3.5`}>
              {m.containers(running)}
            </h2>
            {row.containers.length === 0 ? (
              <p className="text-mut">
                {row.hasCompose ? m.noContainers : m.noCompose}
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
            <h2 className={`${LABEL} mb-3.5`}>{m.environment}</h2>
            {envFiles.length === 0 ? (
              <p className="text-mut">{m.noEnv}</p>
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
    <Suspense fallback={<LoadingFallback />}>
      <Sheet {...props} />
    </Suspense>
  );
}
