import Link from "next/link";
import { Suspense } from "react";
import type { Messages } from "@/i18n";
import { weekLabels } from "@/lib/git-activity";
import { formatAge, type RegistryRow, runningCount } from "@/lib/registry";
import { parseRemote } from "@/lib/remote";
import type { MergeRequest, MergeRequestsView } from "@/server/gitlab";
import { type GitDetails, HISTORY_WEEKS, WORK_DAYS } from "@/server/scan/git";
import { GitFacts } from "../../project-facts";
import { BADGE, BADGE_ALERT, CARD, DATA, LINK, SECTION_TITLE } from "../../ui";
import { CheckOutAllRemotes, CheckOutRemote, CleanUpBranches, FetchControl, NewBranch, PullButton, SwitchBranch } from "./branch-actions";
import { CommitChart } from "./commit-chart";
import { CommitList } from "./commit-list";
import { StashDiffLink, WorkingDiffLink } from "./diff-links";

export const GIT_SECTIONS = ["general", "commits", "branches", "edits", "pr"] as const;
export type GitSection = (typeof GIT_SECTIONS)[number];

const COLUMNS = "grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]";

/** The right column holds two lists: neither should push the other far down. */
const LIST = "max-h-[420px] overflow-y-auto";

/** Read just now: the last refresh may be older than a switch made in a terminal. */
const currentBranchLabel = (details: GitDetails, row: RegistryRow, messages: Messages) =>
  details.branches.find((branch) => branch.current)?.name ?? row.branch ?? messages.facts.detachedHead;

function Changes({ details, projectId, messages }: { details: GitDetails; projectId: number; messages: Messages }) {
  const m = messages.gitTab;
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.changes(details.dirtyCount)}</h2>
      {details.dirtyCount === 0 ? <p className="text-mut">{m.noChanges}</p> : null}
      <div className={LIST}>
        {details.changes.map((file) => (
          <div key={`${file.path}${file.from}`} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5 last:border-b-0">
            <WorkingDiffLink projectId={projectId} path={file.path} from={file.from} />
            <span className={`${DATA} shrink-0 ${file.state === "conflict" ? "text-alert" : "text-mut"}`}>
              {m.changeStates[file.state]}
            </span>
          </div>
        ))}
      </div>
      {details.dirtyCount > details.changes.length ? (
        <p className={`${DATA} pt-2 text-mut`}>{m.moreChanges(details.dirtyCount - details.changes.length)}</p>
      ) : null}
    </section>
  );
}

function Unpushed({ details, now, messages }: { details: GitDetails; now: number; messages: Messages }) {
  const m = messages.gitTab;
  const { total, branches } = details.unpushed;
  const listed = branches.reduce((sum, { commits }) => sum + commits.length, 0);
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.unpushed(total)}</h2>
      <p className={`${DATA} pt-2 ${details.remotes.length === 0 ? "text-alert" : "text-mut"}`}>
        {details.remotes.length === 0 ? m.unpushedNoRemote : m.unpushedHint}
      </p>
      <div className={LIST}>
        {branches.map(({ branch, commits }) => (
          <div key={branch} className="border-b border-rule py-[7px] last:border-b-0">
            <div className={`${DATA} font-medium break-words`}>
              {branch} · {commits.length}
            </div>
            {commits.map((commit) => (
              <div key={commit.hash} className="flex items-baseline justify-between gap-3 pt-1">
                <span className="min-w-0 truncate" title={commit.subject}>
                  <span className={`${DATA} text-mut`}>{commit.hash}</span> {commit.subject}
                </span>
                <span className={`${DATA} shrink-0 text-mut`}>{commit.at === null ? "" : formatAge(commit.at, now, messages.age)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {total > listed ? <p className={`${DATA} pt-2 text-mut`}>{m.moreUnpushed(total - listed)}</p> : null}
    </section>
  );
}

function Stashes({ details, projectId, now, messages }: { details: GitDetails; projectId: number; now: number; messages: Messages }) {
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{messages.gitTab.stashes(details.stashes.length)}</h2>
      {details.stashes.length === 0 ? <p className="text-mut">{messages.gitTab.noStashes}</p> : null}
      <div className={LIST}>
        {details.stashes.map((stash) => (
          <div key={stash.ref} className="border-b border-rule py-[7px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <StashDiffLink projectId={projectId} stashRef={stash.ref} message={stash.message} />
              <span className={`${DATA} shrink-0 text-mut`}>{stash.at === null ? "" : formatAge(stash.at, now, messages.age)}</span>
            </div>
            <div className={`${DATA} text-mut`}>
              {stash.ref}
              {stash.branch ? ` · ${stash.branch}` : ""}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RemoteBranches({
  details,
  row,
  now,
  messages,
}: {
  details: GitDetails;
  row: RegistryRow;
  now: number;
  messages: Messages;
}) {
  const m = messages.gitTab;
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.remoteBranches(details.remoteBranchCount)}</h2>
      <p className={`${DATA} pt-2 text-mut`}>{m.remoteBranchesHint}</p>
      <div className="flex flex-wrap items-center gap-2 py-2">
        <CheckOutAllRemotes
          projectId={row.id}
          count={details.remoteBranchCount}
          branch={currentBranchLabel(details, row, messages)}
        />
      </div>
      <div className={LIST}>
        {details.remoteBranches.map((branch) => (
          <div key={branch.name} className="border-b border-rule py-[7px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`${DATA} min-w-0 font-medium break-words`}>{branch.name}</span>
              <span className={`${DATA} shrink-0 text-mut`}>{branch.at === null ? "" : formatAge(branch.at, now, messages.age)}</span>
            </div>
            {branch.subject ? <div className="truncate text-mut">{branch.subject}</div> : null}
            <div className={`${DATA} mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-mut`}>
              <span>{branch.author}</span>
              {details.trackedChangeCount === 0 ? (
                <CheckOutRemote projectId={row.id} remoteBranch={branch.name} running={runningCount(row)} />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {details.remoteBranchCount > details.remoteBranches.length ? (
        <p className={`${DATA} pt-2 text-mut`}>{m.moreBranches(details.remoteBranchCount - details.remoteBranches.length)}</p>
      ) : null}
    </section>
  );
}

function Branches({
  details,
  fetchRemote,
  row,
  now,
  messages,
}: {
  details: GitDetails;
  fetchRemote: string | null;
  row: RegistryRow;
  now: number;
  messages: Messages;
}) {
  const m = messages.gitTab;
  const canSwitch = details.trackedChangeCount === 0;
  const current = details.branches.find((branch) => branch.current);
  return (
    <>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.branches(details.branchCount)}</h2>
      <div className="flex flex-wrap items-center gap-2 py-2">
        {details.remotes.length > 0 ? (
          <FetchControl projectId={row.id} remotes={details.remotes} chosen={fetchRemote} />
        ) : null}
        {current && current.upstream && current.behind > 0 ? (
          <PullButton projectId={row.id} branch={current.name} behind={current.behind} />
        ) : null}
        <NewBranch projectId={row.id} from={currentBranchLabel(details, row, messages)} />
        <CleanUpBranches
          projectId={row.id}
          into={currentBranchLabel(details, row, messages)}
          branches={details.removable.map(({ name, upstream, upstreamGone }) => ({
            name,
            onRemote: upstream !== null && !upstreamGone,
          }))}
        />
      </div>
      {canSwitch ? null : <p className={`${DATA} pb-2 text-alert`}>{m.dirtyBlocksSwitch(details.trackedChangeCount)}</p>}
      {details.branchCount === 0 ? <p className="text-mut">{m.noBranches}</p> : null}
      <div className={LIST}>
        {details.branches.map((branch) => (
          <div key={branch.name} className="border-b border-rule py-[7px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`${DATA} min-w-0 break-words ${branch.current ? "font-semibold" : "font-medium"}`}>{branch.name}</span>
              <span className={`${DATA} shrink-0 text-mut`}>{branch.at === null ? "" : formatAge(branch.at, now, messages.age)}</span>
            </div>
            {branch.subject ? <div className="truncate text-mut">{branch.subject}</div> : null}
            {branch.current || branch.merged || branch.upstream || branch.baseAhead !== null || canSwitch ? (
              <div className={`${DATA} mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-mut`}>
                {branch.current ? <span className={BADGE}>{m.currentBranch}</span> : null}
                {branch.merged && !branch.current ? <span className={BADGE}>{m.mergedBranch}</span> : null}
                {branch.upstream ? (
                  <span className="min-w-0 break-words">
                    {branch.upstream}
                    {branch.upstreamGone ? ` · ${m.upstreamGone}` : ""}
                    {branch.ahead + branch.behind > 0 ? ` · +${branch.ahead} −${branch.behind}` : ""}
                  </span>
                ) : null}
                {details.compareBase && branch.baseAhead !== null && branch.baseBehind !== null ? (
                  <span>{m.compare(details.compareBase, branch.baseAhead, branch.baseBehind)}</span>
                ) : null}
                {canSwitch && !branch.current ? (
                  <SwitchBranch projectId={row.id} branch={branch.name} running={runningCount(row)} />
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {details.branchCount > details.branches.length ? (
        <p className={`${DATA} pt-2 text-mut`}>{m.moreBranches(details.branchCount - details.branches.length)}</p>
      ) : null}
    </>
  );
}

function Tags({ details, now, messages }: { details: GitDetails; now: number; messages: Messages }) {
  const m = messages.gitTab;
  return (
    <>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.tags(details.tagCount)}</h2>
      {details.tagCount === 0 ? <p className="text-mut">{m.noTags}</p> : null}
      <div className={LIST}>
        {details.tags.map((tag) => (
          <div key={tag.name} className="border-b border-rule py-[7px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`${DATA} min-w-0 font-medium break-words`}>{tag.name}</span>
              <span className={`${DATA} shrink-0 text-mut`}>
                {tag.hash}
                {tag.at === null ? "" : ` · ${formatAge(tag.at, now, messages.age)}`}
              </span>
            </div>
            {tag.subject ? <div className="truncate text-mut">{tag.subject}</div> : null}
          </div>
        ))}
      </div>
      {details.tagCount > details.tags.length ? (
        <p className={`${DATA} pt-2 text-mut`}>{m.moreTags(details.tagCount - details.tags.length)}</p>
      ) : null}
    </>
  );
}

function Workers({ details, now, messages }: { details: GitDetails; now: number; messages: Messages }) {
  const m = messages.gitTab;
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.workers}</h2>
      <p className={`${DATA} pb-2 text-mut`}>{m.workersHint(WORK_DAYS)}</p>
      {details.workers.length === 0 ? <p className="text-mut">{m.noWorkers(WORK_DAYS)}</p> : null}
      <div className="grid gap-x-8 md:grid-cols-2">
        {details.workers.map((person) => (
          <div key={person.name} className="min-w-0 border-b border-rule py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-semibold">{person.name}</span>
              <span className={`${DATA} shrink-0 text-mut`}>{formatAge(person.at, now, messages.age)}</span>
            </div>
            {person.branches.map((branch) => (
              <div key={branch.name} className="pt-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`${DATA} min-w-0 font-medium break-words`}>
                    {branch.name}
                    {branch.remote ? null : <span className={`${BADGE} ml-2`}>{m.localOnly}</span>}
                  </span>
                  <span className={`${DATA} shrink-0 text-mut`}>{formatAge(branch.at, now, messages.age)}</span>
                </div>
                {branch.subject ? <div className="truncate text-mut" title={branch.subject}>{branch.subject}</div> : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function MergeRequestRow({ request, sign, now, messages }: { request: MergeRequest; sign: string; now: number; messages: Messages }) {
  const m = messages.gitTab;
  const failed = request.pipeline?.status === "failed";
  return (
    <div className="border-b border-rule py-[7px] last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <a href={request.url} target="_blank" rel="noreferrer" className={`${LINK} min-w-0 break-words`}>
          <span className={DATA}>
            {sign}
            {request.iid}
          </span> {request.title}
        </a>
        <span className={`${DATA} shrink-0 text-mut`}>
          {m.prUpdated(formatAge(request.mergedAt ?? request.updatedAt, now, messages.age))}
        </span>
      </div>
      <div className={`${DATA} mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-mut`}>
        <span>{request.author}</span>
        {request.mine ? <span className={BADGE}>{m.prMine}</span> : null}
        <span className="min-w-0 break-words">
          {request.source} → {request.target}
        </span>
        {request.draft ? <span className={BADGE}>{m.prDraft}</span> : null}
        {request.conflicts ? <span className={BADGE_ALERT}>{m.prConflicts}</span> : null}
        {request.pipeline && request.mergedAt === null ? (
          <a href={request.pipeline.url} target="_blank" rel="noreferrer" className={failed ? BADGE_ALERT : BADGE}>
            {m.prPipeline(request.pipeline.status)}
          </a>
        ) : null}
        {request.comments > 0 && request.mergedAt === null ? <span>{m.prComments(request.comments)}</span> : null}
      </div>
    </div>
  );
}

async function MergeRequests({ view, now, messages }: { view: Promise<MergeRequestsView>; now: number; messages: Messages }) {
  const m = messages.gitTab;
  const read = await view;
  const forgeName = read.forge === "github" ? "GitHub" : "GitLab";
  const sign = read.forge === "github" ? "#" : "!";
  if ("problem" in read) {
    const { problem, host } = read;
    const text = problem === "noRemote" ? m.prProblems.noRemote : m.prProblems[problem](host ?? "", forgeName);
    return (
      <section className={CARD}>
        <h2 className={`${SECTION_TITLE} mb-1`}>{m.prTitle}</h2>
        <p className={`pb-2 ${problem === "noRemote" ? "text-mut" : "text-alert"}`}>{text}</p>
        {problem === "noRemote" ? null : (
          <Link href={`/settings#${read.forge}`} className={LINK}>
            {m.prSettings}
          </Link>
        )}
      </section>
    );
  }
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
      <section className={CARD}>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4">
          <h2 className={SECTION_TITLE}>{m.prOpenTitle(read.open.length, read.forge === "github")}</h2>
          <a href={read.listUrl} target="_blank" rel="noreferrer" className={`${DATA} ${LINK}`}>
            {m.prOpen(forgeName)}
          </a>
        </div>
        {read.open.length === 0 ? <p className="text-mut">{m.prNone}</p> : null}
        {read.open.map((request) => (
          <MergeRequestRow key={request.iid} request={request} sign={sign} now={now} messages={messages} />
        ))}
      </section>
      <section className={CARD}>
        <h2 className={`${SECTION_TITLE} mb-1`}>{m.prMergedTitle}</h2>
        {read.merged.map((request) => (
          <MergeRequestRow key={request.iid} request={request} sign={sign} now={now} messages={messages} />
        ))}
      </section>
    </div>
  );
}

function SectionNav({
  section,
  row,
  details,
  messages,
}: {
  section: GitSection;
  row: RegistryRow;
  details: GitDetails | null;
  messages: Messages;
}) {
  const m = messages.gitTab;
  const counts: Partial<Record<GitSection, number | null>> = {
    commits: row.commitCount,
    branches: details ? details.branchCount + details.remoteBranchCount : row.branchCount,
    edits: details ? details.dirtyCount + details.stashes.length : null,
  };
  return (
    <nav aria-label={m.sections} className={`${DATA} mb-4 flex flex-wrap gap-x-5 gap-y-1`}>
      {GIT_SECTIONS.map((item) => {
        const count = counts[item];
        return (
          <Link
            key={item}
            href={`/projects/${row.id}?tab=git${item === "general" ? "" : `&git=${item}`}`}
            scroll={false}
            aria-current={item === section ? "page" : undefined}
            className="-mx-1 inline-flex min-h-8 items-center gap-1.5 px-1 text-mut hover:text-ink aria-[current=page]:bg-sel aria-[current=page]:text-ink"
          >
            {m.sectionNames[item]}
            {count ? <span className="text-mut">{count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** `details` is null when the repository was not read: what the last refresh stored is still there. */
export function GitTab({
  row,
  now,
  details,
  fetchRemote,
  section,
  mergeRequests,
  messages,
}: {
  row: RegistryRow;
  now: number;
  details: GitDetails | null;
  fetchRemote: string | null;
  section: GitSection;
  /** Only asked for when the PR part is open: it calls GitLab. */
  mergeRequests: Promise<MergeRequestsView> | null;
  messages: Messages;
}) {
  const hasHistory = details !== null && details.authors.length > 0;
  const notRead = (
    <section className={CARD}>
      <p className="text-mut">{row.hasGit ? messages.gitTab.notRead : messages.sheet.noActivity}</p>
    </section>
  );
  return (
    <>
      <SectionNav section={section} row={row} details={details} messages={messages} />

      {section === "general" ? (
        <div className="grid gap-4">
          <div className={COLUMNS}>
            <section className={CARD}>
              {hasHistory ? (
                <CommitChart
                  authors={details.authors}
                  lines={details.lines}
                  labels={weekLabels(now, HISTORY_WEEKS, messages.gitTab.dateLocale)}
                />
              ) : (
                <>
                  <h2 className={`${SECTION_TITLE} mb-3`}>{messages.gitTab.commitsByAuthor}</h2>
                  <p className="text-mut">{details === null && row.hasGit ? messages.gitTab.notRead : messages.sheet.noActivity}</p>
                </>
              )}
            </section>
            <div className="grid min-w-0 gap-4">
              <GitFacts row={row} now={now} card />
              {details !== null && details.unpushed.total > 0 ? <Unpushed details={details} now={now} messages={messages} /> : null}
            </div>
          </div>
          {details !== null ? <Workers details={details} now={now} messages={messages} /> : null}
        </div>
      ) : null}

      {section === "commits" ? (
        details !== null ? (
          <section className={CARD}>
            <h2 className={`${SECTION_TITLE} mb-1`}>
              {messages.gitTab.recentCommitsOn(currentBranchLabel(details, row, messages))}
            </h2>
            {/* A new key after a switch or a new commit: the commits loaded before no longer apply. */}
            <CommitList
              key={details.commits[0]?.hash ?? "empty"}
              projectId={row.id}
              first={details.commits}
              hasMore={details.hasMoreCommits}
              total={row.commitCount}
              web={row.remoteUrl ? parseRemote(row.remoteUrl).url : null}
              now={now}
            />
          </section>
        ) : (
          notRead
        )
      ) : null}

      {section === "branches" ? (
        details !== null ? (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <section className={CARD}>
              <Branches details={details} fetchRemote={fetchRemote} row={row} now={now} messages={messages} />
            </section>
            <div className="grid min-w-0 gap-4">
              {details.remoteBranchCount > 0 ? (
                <RemoteBranches details={details} row={row} now={now} messages={messages} />
              ) : null}
              <section className={CARD}>
                <Tags details={details} now={now} messages={messages} />
              </section>
            </div>
          </div>
        ) : (
          notRead
        )
      ) : null}

      {section === "edits" ? (
        details !== null ? (
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <Changes details={details} projectId={row.id} messages={messages} />
            <Stashes details={details} projectId={row.id} now={now} messages={messages} />
          </div>
        ) : (
          notRead
        )
      ) : null}

      {section === "pr" && mergeRequests ? (
        <Suspense
          fallback={
            <section className={CARD}>
              <p className="text-mut">{messages.gitTab.prLoading}</p>
            </section>
          }
        >
          <MergeRequests view={mergeRequests} now={now} messages={messages} />
        </Suspense>
      ) : null}
    </>
  );
}
