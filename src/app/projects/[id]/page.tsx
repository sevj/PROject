import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { isMarkdown } from "@/lib/docs";
import { formatAge } from "@/lib/registry";
import type { Messages } from "@/i18n";
import { readClaudeConfig } from "@/server/claude-config";
import { readClaudeUsage, SESSIONS_SHOWN } from "@/server/claude-usage/report";
import { readSessionTitles } from "@/server/claude-usage/session-titles";
import { getFetchRemote } from "@/server/classification";
import { currentComposeJob } from "@/server/compose-jobs";
import { getDb } from "@/server/db/client";
import { readEnvView } from "@/server/env-vars";
import { listProjectContainers } from "@/server/docker-containers";
import { listJobs } from "@/server/dumps/jobs";
import { listDumps, toDumpRow } from "@/server/dumps/store";
import { readDockerStack } from "@/server/docker-stack";
import { serverMessages } from "@/server/i18n";
import { listProjectFolder, readProjectDoc } from "@/server/project-files";
import { getProject } from "@/server/registry";
import { readGitDetails, readRecentCommits } from "@/server/scan/git";
import { ClaudeConsoleButton } from "../../claude-console-button";
import { LoadingFallback } from "../../loading-fallback";
import { ProjectDescription } from "../../project-description";
import { ProjectDirectory } from "../../project-directory";
import { ProjectFacts } from "../../project-facts";
import { ProjectName } from "../../project-name";
import { ProjectCleanup } from "../../project-cleanup";
import { ProjectOrganizer } from "../../project-organizer";
import { BackIcon } from "../../icons";
import { BUTTON_SMALL, CARD, DATA, SECTION_TITLE } from "../../ui";
import { ClaudeConfigCard } from "./claude-config-card";
import { ClaudeTab } from "./claude-tab";
import { ClaudeUsageBlock } from "./claude-usage";
import { DockerComponents } from "./docker-components";
import { DockerTab } from "./docker-tab";
import { EnvTab } from "./env-tab";
import { GitTab } from "./git-tab";
import { MarkdownDoc } from "./markdown-doc";
import { readDependencies } from "@/server/dependencies";
import { ProjectSites } from "./project-sites";
import { ProjectTree } from "./project-tree";
import { SecurityTab } from "./security-tab";

const TABS = ["general", "docker", "git", "env", "claude", "security", "structure", "documentation"] as const;
type Tab = (typeof TABS)[number];
const TAB =
  "-mb-px inline-flex min-h-11 items-center border-b-2 border-transparent px-3.5 font-medium text-mut hover:text-ink aria-[current=page]:border-accent aria-[current=page]:text-ink";

function ActivityChart({ weeks, m }: { weeks: number[]; m: Messages["sheet"] }) {
  const peak = Math.max(...weeks, 1);
  const total = weeks.reduce((sum, commits) => sum + commits, 0);
  return (
    <>
      <div className={`${SECTION_TITLE} mb-3.5 flex flex-wrap justify-between gap-x-4 gap-y-1`}>
        <h2>{m.weeklyCommits}</h2>
        <span className={`${DATA} text-mut`}>
          {m.peak(total, Math.max(...weeks))}
        </span>
      </div>
      <div
        className="grid h-[110px] grid-cols-[repeat(26,minmax(0,1fr))] items-end gap-x-0.5 border-b border-rule-strong"
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

  const { row, absolutePath, docs, now, knownTags } = project;
  const messages = serverMessages(getDb());
  const m = messages.sheet;
  // Only what the open tab shows is read.
  // An abandoned project is not read anymore, except for what is explicitly opened.
  const commits =
    tab === "general" && row.hasGit && !row.missing && !row.abandoned ? await readRecentCommits(absolutePath) : [];
  const claudeUsage = tab === "general" || tab === "claude" ? readClaudeUsage(getDb(), projectId, now) : null;
  const sessionTitles =
    tab === "claude" && claudeUsage
      ? await readSessionTitles(getDb(), claudeUsage.sessions.slice(0, SESSIONS_SHOWN).map(({ sessionId }) => sessionId))
      : {};
  const claudeConfig = tab === "claude" && !row.missing ? await readClaudeConfig(absolutePath) : null;
  const gitDetails =
    tab === "git" && row.hasGit && !row.missing && !row.abandoned ? await readGitDetails(absolutePath) : null;
  const readsDocker = (tab === "general" || tab === "docker") && !row.missing && !row.abandoned;
  const dockerStack = readsDocker ? await readDockerStack(absolutePath) : null;
  const dockerLive = tab === "docker" && !row.missing && !row.abandoned ? await listProjectContainers(getDb(), projectId) : null;
  const envView = tab === "env" && !row.missing ? await readEnvView(getDb(), projectId, absolutePath, row.hasGit) : null;
  const dependencies = tab === "security" ? readDependencies(getDb(), projectId) : null;
  const tree = tab === "structure" && !row.missing ? await listProjectFolder(absolutePath, ".") : null;
  const defaultDoc = docs.find((file) => /^readme/i.test(file)) ?? docs[0];
  // Only a path found on disk beforehand can be opened: `doc` comes from the URL.
  const selectedDoc = typeof doc === "string" && docs.includes(doc) ? doc : defaultDoc;
  const docContent =
    tab === "documentation" && selectedDoc && !row.missing ? await readProjectDoc(absolutePath, selectedDoc) : null;

  return (
    <main className="mx-auto w-full max-w-[1240px] flex-1 px-5 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 pt-6 pb-6">
        <div className="min-w-0 flex-[1_1_420px]">
          <Link href="/" className={`${BUTTON_SMALL} mb-2`}>
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
          {!row.missing && !row.abandoned ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ClaudeConsoleButton projectId={row.id} projectName={row.name} />
              <Suspense fallback={null}>
                <ProjectSites projectId={row.id} />
              </Suspense>
            </div>
          ) : null}
        </div>
        <ProjectOrganizer key={row.id} row={row} knownTags={knownTags} />
      </div>

      {row.abandoned ? (
        <p role="status" className={`${DATA} mb-4 border border-rule px-3 py-2 text-mut`}>
          {m.abandoned}
        </p>
      ) : null}
      {row.missing ? (
        <p role="alert" className={`${DATA} mb-4 border border-alert px-3 py-2 text-alert`}>
          {m.missing}
        </p>
      ) : null}
      {row.scanError ? (
        <p role="alert" className={`${DATA} mb-4 border border-alert px-3 py-2 break-words text-alert`}>
          {row.scanError}
        </p>
      ) : null}

      <div>
          <nav aria-label={m.tabs} className="mb-4 flex flex-wrap border-b border-rule-strong">
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
              <div className="grid gap-4 lg:grid-cols-2">
                <section className={CARD}>
                  {row.weeklyCommits ? (
                    <ActivityChart weeks={row.weeklyCommits} m={m} />
                  ) : (
                    <>
                      <h2 className={`${SECTION_TITLE} mb-3`}>{m.weeklyCommits}</h2>
                      <p className="text-mut">{m.noActivity}</p>
                    </>
                  )}
                </section>
                <section className={CARD}>
                  <h2 className={`${SECTION_TITLE} mb-1`}>{m.recentCommits}</h2>
                  {commits.length === 0 ? <p className="text-mut">{m.noActivity}</p> : null}
                  {commits.slice(0, 5).map((commit, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-rule py-[7px] last:border-b-0"
                    >
                      <span className="truncate">{commit.subject}</span>
                      <span className={`${DATA} text-mut`}>{formatAge(commit.at.getTime(), now, messages.age)}</span>
                    </div>
                  ))}
                </section>
              </div>

              <section className={`${CARD} my-4`}>
                <h2 className={`${SECTION_TITLE} mb-3`}>{m.dockerComponents.title}</h2>
                <DockerComponents stack={dockerStack} containers={row.containers} m={m.dockerComponents} states={m.dockerTab.states} />
              </section>

              <ClaudeUsageBlock
                usage={claudeUsage}
                projectId={row.id}
                now={now}
                m={m.claudeUsage}
                age={messages.age}
                locale={messages.gitTab.dateLocale}
              />

              <ProjectFacts row={row} now={now} wide />
            </>
          ) : null}

          {tab === "claude" && claudeConfig ? (
            <ClaudeConfigCard
              config={claudeConfig}
              projectId={row.id}
              projectName={row.name}
              canOpen={!row.missing && !row.abandoned}
              m={m.claudeConfig}
            />
          ) : null}

          {tab === "claude" ? (
            <ClaudeTab
              usage={claudeUsage}
              titles={sessionTitles}
              projectId={row.id}
              projectName={row.name}
              projectPath={absolutePath}
              canOpen={!row.missing && !row.abandoned}
              now={now}
              m={m.claudeUsage}
              age={messages.age}
              locale={messages.gitTab.dateLocale}
            />
          ) : null}

          {tab === "git" ? <GitTab row={row} now={now} details={gitDetails} fetchRemote={getFetchRemote(getDb(), projectId)} messages={messages} /> : null}

          {tab === "docker" ? (
            <DockerTab
              row={row}
              projectPath={absolutePath}
              now={now}
              live={dockerLive}
              stack={dockerStack}
              dumps={tab === "docker" ? listDumps(getDb()).map(toDumpRow) : []}
              jobs={tab === "docker" ? listJobs() : []}
              composeJob={currentComposeJob(projectId)}
              messages={messages}
            />
          ) : null}

          {tab === "env" ? (
            envView ? (
              <EnvTab projectId={row.id} view={envView} readOnly={row.abandoned} />
            ) : (
              <section className={CARD}>
                <p className="text-mut">{m.unreadableFolder}</p>
              </section>
            )
          ) : null}

          {tab === "security" ? (
            <SecurityTab projectId={row.id} stored={dependencies} now={now} readOnly={row.missing || row.abandoned} />
          ) : null}

          {tab === "structure" ? (
            <div className="grid gap-4">
              <section className={CARD}>
                {tree ? <ProjectTree projectId={row.id} listing={tree} /> : <p className="text-mut">{m.unreadableFolder}</p>}
              </section>
              {tree && row.hasGit && !row.abandoned ? <ProjectCleanup projectId={row.id} /> : null}
            </div>
          ) : null}

          {tab === "documentation" ? (
            <section className={CARD}>
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
                    <pre className={`${DATA} overflow-auto border border-rule bg-field p-4 break-words whitespace-pre-wrap`}>
                      {docContent}
                    </pre>
                  )}
                </>
              )}
            </section>
          ) : null}
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
