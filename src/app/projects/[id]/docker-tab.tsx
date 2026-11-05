import type { ReactNode } from "react";
import type { Messages } from "@/i18n";
import { classify, countStates, STATE_ORDER, type StateKind, TONE } from "@/lib/docker-state";
import { formatAge, type RegistryRow } from "@/lib/registry";
import type { ComposeJob } from "@/server/compose-jobs";
import type { ContainerDetail, ProjectContainers } from "@/server/docker-containers";
import type { DockerStack } from "@/server/docker-stack";
import { CARD, DATA, LINK, SECTION_TITLE } from "../../ui";
import { DumpJobs } from "@/app/dump-jobs";
import type { DumpRow } from "@/lib/dumps";
import type { JobView } from "@/server/dumps/jobs";
import { ContainerControls, ProjectControls } from "./docker-controls";
import { DockerResources } from "./docker-resources";
import { StateBadge, StateGlyph, TONE_BG, TONE_EDGE, TONE_TEXT } from "./state-badge";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="pt-1.5 text-mut">{label}</dt>
      <dd className={`${DATA} min-w-0 border-b border-rule py-1.5 break-all`}>{children}</dd>
    </>
  );
}

const utc = (time: number) => `${new Date(time).toISOString().slice(0, 16).replace("T", " ")} UTC`;

const kindOf = (container: ContainerDetail): StateKind =>
  classify({
    state: container.state,
    health: container.health,
    exitCode: container.exitCode,
    outOfMemory: container.outOfMemory,
  });

/** One segment per container, side by side, then what each state counts. */
function StateBar({ kinds, names, messages }: { kinds: StateKind[]; names: string[]; messages: Messages }) {
  const states = messages.sheet.dockerTab.states;
  const order = [...kinds.keys()].sort((a, b) => STATE_ORDER.indexOf(kinds[a]) - STATE_ORDER.indexOf(kinds[b]));
  return (
    <div className="mt-4">
      <div className="flex h-2 gap-0.5" role="img" aria-label={countStates(kinds).map(({ kind, count }) => `${count} ${states[kind]}`).join(", ")}>
        {order.map((index) => (
          <span key={names[index]} title={`${names[index]} · ${states[kinds[index]]}`} className={`min-w-1 flex-1 ${TONE_BG[TONE[kinds[index]]]}`} />
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1">
        {countStates(kinds).map(({ kind, count }) => (
          <li key={kind} className={`${DATA} inline-flex items-center gap-1.5`}>
            <StateGlyph kind={kind} />
            <span className={TONE_TEXT[TONE[kind]]}>{count}</span>
            <span className="text-mut">{states[kind].toLowerCase()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One line per container, for a quick look before the details below. */
function QuickList({ containers, now, messages }: { containers: ContainerDetail[]; now: number; messages: Messages }) {
  const m = messages.sheet.dockerTab;
  const sinceOf = (container: ContainerDetail) => {
    // Docker still counts a paused container as running, which it is not doing.
    if (container.state === "paused") return m.states.paused;
    if (container.running) {
      return container.startedAt === null ? m.neverStarted : m.up(formatAge(container.startedAt, now, messages.age));
    }
    return container.finishedAt === null
      ? m.neverStarted
      : m.stoppedFor(formatAge(container.finishedAt, now, messages.age), container.exitCode);
  };
  return (
    <ul className="mt-4 border-t border-rule">
      {containers.map((container) => {
        const kind = kindOf(container);
        const tone = TONE[kind];
        return (
          <li
            key={container.id}
            className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-rule px-1 py-2 last:border-b-0 ${tone === "warn" ? "bg-alert/10" : ""}`}
          >
            <StateGlyph kind={kind} />
            <a href={`#container-${container.name}`} className={`${DATA} ${LINK} min-w-0 break-all`}>
              <span className="sr-only">{m.states[kind]}: </span>
              {container.name}
            </a>
            <span className={`${DATA} text-right ${TONE_TEXT[tone === "ok" ? "off" : tone]}`}>
              {sinceOf(container)}
              {container.health ? ` · ${container.health}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ContainerCard({
  container,
  projectPath,
  projectId,
  projectName,
  dumps,
  now,
  messages,
}: {
  container: ContainerDetail;
  projectPath: string;
  projectId: number;
  projectName: string;
  dumps: DumpRow[];
  now: number;
  messages: Messages;
}) {
  const m = messages.sheet.dockerTab;
  const kind = kindOf(container);
  const when = (time: number | null) =>
    time === null ? "—" : `${messages.facts.ago(formatAge(time, now, messages.age))} · ${utc(time)}`;
  // Compose files are paths on the machine, which are shorter from the project.
  const relative = (path: string) =>
    path === projectPath ? "." : path.startsWith(`${projectPath}/`) ? path.slice(projectPath.length + 1) : path;

  return (
    <article
      id={`container-${container.name}`}
      className={`${CARD} scroll-mt-4 border-l-[3px] ${TONE_EDGE[TONE[kind]]}`}
      aria-label={container.name}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <StateBadge kind={kind} label={m.states[kind]} />
          <h3 className="text-[17px] leading-snug font-bold break-all">{container.name}</h3>
          <p className={`${DATA} text-mut`}>
            {[container.service, container.composeProject].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ContainerControls
          projectId={projectId}
          containerId={container.id}
          containerName={container.name}
          running={container.running}
          canOpenConsole={container.running && container.state !== "paused"}
          database={
            container.engine
              ? {
                  target: {
                    id: container.id,
                    name: container.name,
                    service: container.service,
                    image: container.image,
                    engine: container.engine,
                    projectId,
                    projectName,
                  },
                  dumps,
                }
              : undefined
          }
        />
      </div>
      <p className={`${DATA} mt-3 ${TONE[kind] === "warn" ? "font-medium text-alert" : container.running ? "" : "text-mut"}`}>
        {container.status || container.state}
        {container.health ? ` · ${m.health.toLowerCase()}: ${container.health}` : ""}
        {container.outOfMemory ? ` · ${m.outOfMemory}` : ""}
      </p>

      <dl className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6">
        <Row label={m.image}>{container.image || "—"}</Row>
        <Row label={m.imageId}>{container.imageId ? container.imageId.slice(0, 12) : "—"}</Row>
        <Row label={m.command}>{container.command || "—"}</Row>
        <Row label={m.created}>{when(container.createdAt)}</Row>
        <Row label={m.started}>{when(container.startedAt)}</Row>
        {container.running ? null : <Row label={m.finished}>{when(container.finishedAt)}</Row>}
        {container.running || container.exitCode === null ? null : <Row label={m.exitCode}>{container.exitCode}</Row>}
        <Row label={m.restartPolicy}>
          {container.restartPolicy}
          {container.restartCount > 0 ? ` · ${m.restarts.toLowerCase()}: ${container.restartCount}` : ""}
        </Row>
        <Row label={m.ports}>
          {container.ports.length === 0
            ? m.none
            : container.ports.map(({ host, container: target }) => (
                <div key={`${host}-${target}`}>
                  {host === null ? `${target} (${m.notPublished})` : `${host} → ${target}`}
                </div>
              ))}
        </Row>
        {container.urls.length === 0 ? null : (
          <Row label={m.addresses}>
            {container.urls.map(({ url, label }) =>
              container.running ? (
                <div key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className={LINK}>
                    {label}
                  </a>
                </div>
              ) : (
                <div key={url}>{label}</div>
              ),
            )}
          </Row>
        )}
        <Row label={m.networks}>
          {container.networks.length === 0
            ? m.none
            : container.networks.map(({ name, address }) => (
                <div key={name}>
                  {name}
                  {address ? ` · ${address}` : ""}
                </div>
              ))}
        </Row>
        <Row label={m.mounts}>
          {container.mounts.length === 0
            ? m.none
            : container.mounts.map(({ type, source, destination, readOnly }) => (
                <div key={`${source}-${destination}`}>
                  <span className="text-mut">{type}</span> {source} → {destination}
                  {readOnly ? ` (${m.readOnly})` : ""}
                </div>
              ))}
        </Row>
        {container.composeFiles.length === 0 ? null : (
          <Row label={m.composeFiles}>
            {container.composeFiles.map((file) => (
              <div key={file}>{relative(file)}</div>
            ))}
          </Row>
        )}
        {container.workingDir ? <Row label={m.workingDir}>{relative(container.workingDir)}</Row> : null}
        <Row label={m.id}>{container.id}</Row>
      </dl>
    </article>
  );
}

export function DockerTab({
  row,
  projectPath,
  now,
  live,
  stack,
  dumps,
  jobs,
  composeJob,
  messages,
}: {
  row: RegistryRow;
  projectPath: string;
  now: number;
  live: ProjectContainers | null;
  stack: DockerStack | null;
  dumps: DumpRow[];
  jobs: JobView[];
  composeJob: ComposeJob | null;
  messages: Messages;
}) {
  const m = messages.sheet.dockerTab;

  if (live === null) return <p className="text-mut">{m.abandoned}</p>;

  const { containers, error } = live;
  const running = containers.filter((container) => container.running).length;
  const created = new Set(containers.map(({ service }) => service));
  const missing = (stack?.components ?? []).filter(({ service }) => !created.has(service));
  const kinds = containers.map(kindOf);

  return (
    <div className="grid gap-4">
      <DumpJobs initial={jobs} initialNow={now} />
      <div className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="text-[17px] font-bold">{error === null ? m.summary(running, containers.length) : ""}</p>
          <ProjectControls
            projectId={row.id}
            running={running}
            total={containers.length}
            canCreate={error === null && ((stack?.components.length ?? 0) > 0 || row.hasCompose)}
            hasCompose={error === null && row.hasCompose}
            composeJob={composeJob}
          />
        </div>
        {containers.length > 0 ? (
          <>
            <StateBar kinds={kinds} names={containers.map(({ name }) => name)} messages={messages} />
            <QuickList containers={containers} now={now} messages={messages} />
          </>
        ) : null}
      </div>

      {error === null && running > 0 ? (
        <DockerResources containerNames={containers.filter((container) => container.running).map(({ name }) => name)} />
      ) : null}

      {error !== null ? (
        <p role="alert" className={`${DATA} border border-alert px-3 py-2 break-words text-alert`}>
          {messages.errors.dockerUnavailable(error)}
        </p>
      ) : containers.length === 0 ? (
        <p className="text-mut">{m.noContainers}</p>
      ) : (
        containers.map((container) => (
          <ContainerCard
            key={container.id}
            container={container}
            projectPath={projectPath}
            projectId={row.id}
            projectName={row.name}
            dumps={dumps}
            now={now}
            messages={messages}
          />
        ))
      )}

      {error === null && missing.length > 0 ? (
        <section className={CARD}>
          <h3 className={`${SECTION_TITLE} mb-2`}>{m.declared}</h3>
          {missing.map(({ service, images }) => (
            <div key={service} className="flex flex-wrap items-center justify-between gap-x-4 border-b border-rule py-2 last:border-b-0">
              <span className="inline-flex items-center gap-2 font-semibold">
                <StateGlyph kind="created" />
                {service}
              </span>
              <span className={`${DATA} text-mut`}>
                {images.map(({ name, version }) => `${name}:${version}`).join(", ") || "—"} · {m.notCreated}
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
