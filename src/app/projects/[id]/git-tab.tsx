import type { Messages } from "@/i18n";
import { weekLabels } from "@/lib/git-activity";
import { formatAge, type RegistryRow, runningCount } from "@/lib/registry";
import { parseRemote } from "@/lib/remote";
import { type GitDetails, HISTORY_WEEKS } from "@/server/scan/git";
import { GitFacts } from "../../project-facts";
import { CARD, DATA, SECTION_TITLE } from "../../ui";
import { CheckOutAllRemotes, CheckOutRemote, CleanUpBranches, FetchButton, NewBranch, PullButton, SwitchBranch } from "./branch-actions";
import { CommitChart } from "./commit-chart";
import { CommitList } from "./commit-list";

const COLUMNS = "grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]";

const TAG = "border border-rule-strong px-1.5 text-mut";
/** The right column holds two lists: neither should push the other far down. */
const LIST = "max-h-[420px] overflow-y-auto";

/** Read just now: the last refresh may be older than a switch made in a terminal. */
const currentBranchLabel = (details: GitDetails, row: RegistryRow, messages: Messages) =>
  details.branches.find((branch) => branch.current)?.name ?? row.branch ?? messages.facts.detachedHead;

function Changes({ details, messages }: { details: GitDetails; messages: Messages }) {
  const m = messages.gitTab;
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.changes(details.dirtyCount)}</h2>
      <div className={LIST}>
        {details.changes.map((file) => (
          <div key={`${file.path}${file.from}`} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5 last:border-b-0">
            <span className={`${DATA} min-w-0 break-all`}>
              {file.from ? `${file.from} → ` : ""}
              {file.path}
            </span>
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

function Stashes({ details, now, messages }: { details: GitDetails; now: number; messages: Messages }) {
  return (
    <section className={CARD}>
      <h2 className={`${SECTION_TITLE} mb-1`}>{messages.gitTab.stashes(details.stashes.length)}</h2>
      <div className={LIST}>
        {details.stashes.map((stash) => (
          <div key={stash.ref} className="border-b border-rule py-[7px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words">{stash.message}</span>
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
              {details.dirtyCount === 0 ? (
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
  const canSwitch = details.dirtyCount === 0;
  const current = details.branches.find((branch) => branch.current);
  return (
    <>
      <h2 className={`${SECTION_TITLE} mb-1`}>{m.branches(details.branchCount)}</h2>
      <div className="flex flex-wrap items-center gap-2 py-2">
        {row.remoteUrl ? <FetchButton projectId={row.id} /> : null}
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
      {canSwitch ? null : <p className={`${DATA} pb-2 text-alert`}>{m.dirtyBlocksSwitch(details.dirtyCount)}</p>}
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
                {branch.current ? <span className={TAG}>{m.currentBranch}</span> : null}
                {branch.merged && !branch.current ? <span className={TAG}>{m.mergedBranch}</span> : null}
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

/** `details` is null when the repository was not read: what the last refresh stored is still there. */
export function GitTab({
  row,
  now,
  details,
  messages,
}: {
  row: RegistryRow;
  now: number;
  details: GitDetails | null;
  messages: Messages;
}) {
  const hasHistory = details !== null && details.authors.length > 0;
  return (
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
          {details !== null && details.dirtyCount > 0 ? <Changes details={details} messages={messages} /> : null}
          {details !== null && details.stashes.length > 0 ? <Stashes details={details} now={now} messages={messages} /> : null}
        </div>
      </div>
      {details !== null ? (
        <div className={COLUMNS}>
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
          <div className="grid min-w-0 gap-4">
            <section className={CARD}>
              <Branches details={details} row={row} now={now} messages={messages} />
            </section>
            {details.remoteBranchCount > 0 ? (
              <RemoteBranches details={details} row={row} now={now} messages={messages} />
            ) : null}
            <section className={CARD}>
              <Tags details={details} now={now} messages={messages} />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
