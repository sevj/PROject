import Form from "next/form";
import Link from "next/link";
import { Suspense } from "react";
import type { Messages } from "@/i18n";
import { formatAge } from "@/lib/registry";
import { APM_ASSIGNEES, APM_STATES, type ApmTicket, type ApmTicketsQuery, type ApmTicketsView } from "@/server/apm";
import { BADGE, BUTTON, BUTTON_SMALL, CARD, DATA, FIELD, LABEL, LINK, SECTION_TITLE } from "../../ui";
import { ApmProjectPicker } from "./apm-project-picker";

const NAV_ITEM =
  "-mx-1 inline-flex min-h-8 items-center px-1 text-mut hover:text-ink aria-[current=page]:bg-sel aria-[current=page]:text-ink";

/** The address of the tab for this query: what is the default is left out. */
function ticketsHref(projectId: number, query: ApmTicketsQuery): string {
  const params = new URLSearchParams({ tab: "tickets" });
  if (query.state !== "open") params.set("state", query.state);
  if (query.assignee !== "all") params.set("assignee", query.assignee);
  if (query.search) params.set("q", query.search);
  if (query.page > 1) params.set("page", String(query.page));
  return `/projects/${projectId}?${params}`;
}

/**
 * The tickets of the APM project linked to this one, read from APM's API with the token of the settings.
 * `view` is null while no APM project is linked.
 */
export function TicketsTab({
  projectId,
  linkedId,
  view,
  query,
  now,
  readOnly,
  messages,
}: {
  projectId: number;
  linkedId: number | null;
  view: Promise<ApmTicketsView> | null;
  query: ApmTicketsQuery;
  now: number;
  readOnly: boolean;
  messages: Messages;
}) {
  const m = messages.tickets;
  if (linkedId === null || !view) {
    return (
      <section className={`${CARD} grid gap-3`}>
        <h2 className={SECTION_TITLE}>{m.title}</h2>
        <p className="text-mut">{m.notLinked}</p>
        {readOnly ? null : <ApmProjectPicker projectId={projectId} linked={false} />}
      </section>
    );
  }
  return (
    <Suspense
      key={ticketsHref(projectId, query)}
      fallback={
        <section className={CARD}>
          <p className="text-mut">{m.loading}</p>
        </section>
      }
    >
      <TicketList projectId={projectId} linkedId={linkedId} view={view} query={query} now={now} readOnly={readOnly} messages={messages} />
    </Suspense>
  );
}

async function TicketList({
  projectId,
  linkedId,
  view,
  query,
  now,
  readOnly,
  messages,
}: {
  projectId: number;
  linkedId: number;
  view: Promise<ApmTicketsView>;
  query: ApmTicketsQuery;
  now: number;
  readOnly: boolean;
  messages: Messages;
}) {
  const m = messages.tickets;
  const read = await view;
  const header = (title: string, client: string | null) => (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={`${SECTION_TITLE} mb-1`}>{m.title}</h2>
        <div className="break-words">
          <span className={`${DATA} text-mut`}>#{linkedId}</span> {title}
          {client ? <span className={`${DATA} text-mut`}> · {client}</span> : null}
        </div>
      </div>
      {readOnly ? null : <ApmProjectPicker projectId={projectId} linked />}
    </div>
  );

  if ("problem" in read) {
    return (
      <section className={`${CARD} grid gap-3`}>
        {header("", null)}
        <p className="text-alert">
          {m.problems[read.problem]}{" "}
          {read.problem === "notFound" ? null : (
            <Link href="/settings#apm" className={LINK}>
              {m.settings}
            </Link>
          )}
        </p>
      </section>
    );
  }

  const { project, tickets, total, page, pages } = read;
  return (
    <section className={`${CARD} grid gap-3`}>
      {header(project.name, project.client)}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1.5">
          <FilterNav label={m.stateFilter}>
            {APM_STATES.map((state) => (
              <Link
                key={state}
                href={ticketsHref(projectId, { ...query, state, page: 1 })}
                scroll={false}
                aria-current={state === query.state ? "page" : undefined}
                className={NAV_ITEM}
              >
                {m.states[state]}
              </Link>
            ))}
          </FilterNav>
          <FilterNav label={m.assigneeFilter}>
            {APM_ASSIGNEES.map((assignee) => (
              <Link
                key={assignee}
                href={ticketsHref(projectId, { ...query, assignee, page: 1 })}
                scroll={false}
                aria-current={assignee === query.assignee ? "page" : undefined}
                className={NAV_ITEM}
              >
                {m.assignees[assignee]}
              </Link>
            ))}
          </FilterNav>
        </div>
        <Form action={`/projects/${projectId}`} scroll={false} className="flex min-w-[260px] flex-1 justify-end gap-2 sm:max-w-md">
          <input type="hidden" name="tab" value="tickets" />
          {query.state !== "open" ? <input type="hidden" name="state" value={query.state} /> : null}
          {query.assignee !== "all" ? <input type="hidden" name="assignee" value={query.assignee} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder={m.search}
            aria-label={m.search}
            className={`${FIELD} min-h-8 placeholder:text-mut`}
          />
          <button type="submit" className={BUTTON_SMALL}>
            {m.searchButton}
          </button>
        </Form>
      </div>

      <div className={`${DATA} text-mut`}>{m.count(total)}</div>
      {tickets.length === 0 ? (
        <p className="text-mut">{m.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className={`${LABEL} border-b border-rule-strong text-left`}>
                <th className="py-1.5 pr-3 pl-2 font-normal">{m.columns.id}</th>
                <th className="py-1.5 pr-3 font-normal">{m.columns.title}</th>
                <th className="py-1.5 pr-3 font-normal">{m.columns.status}</th>
                <th className="py-1.5 pr-3 font-normal">{m.columns.priority}</th>
                <th className="py-1.5 pr-3 font-normal">{m.columns.assignee}</th>
                <th className="py-1.5 pr-2 text-right font-normal">{m.columns.updated}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} mine={read.meId !== null && ticket.assignee?.id === read.meId} now={now} messages={messages} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className={`${DATA} flex flex-wrap items-center justify-between gap-2`}>
          {page > 1 ? (
            <Link href={ticketsHref(projectId, { ...query, page: page - 1 })} scroll={false} className={BUTTON}>
              {m.previous}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-mut">{m.page(page, pages)}</span>
          {page < pages ? (
            <Link href={ticketsHref(projectId, { ...query, page: page + 1 })} scroll={false} className={BUTTON}>
              {m.next}
            </Link>
          ) : (
            <span />
          )}
        </div>
      ) : null}
    </section>
  );
}

function FilterNav({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <nav aria-label={label} className={`${DATA} flex flex-wrap items-center gap-x-5 gap-y-1`}>
      <span className={`${LABEL} w-24`}>{label}</span>
      {children}
    </nav>
  );
}

/** Orange from "High" up: what needs to be looked at first. */
const priorityClass = (priority: number | null) => (priority !== null && priority >= 3 ? "font-medium text-alert" : priority === 1 ? "text-mut" : "");

/** A ticket assigned to the token's owner stands out: tinted, with a mark on its left. */
function TicketRow({ ticket, mine, now, messages }: { ticket: ApmTicket; mine: boolean; now: number; messages: Messages }) {
  const m = messages.tickets;
  const date = (at: number) => new Date(at).toLocaleString(messages.gitTab.dateLocale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <tr className={`border-b border-rule align-baseline last:border-b-0 ${mine ? "bg-accent-soft" : ""}`}>
      <td className={`${DATA} border-l-2 py-[7px] pr-3 pl-2 whitespace-nowrap text-mut ${mine ? "border-l-accent" : "border-l-transparent"}`}>
        {ticket.id}
      </td>
      <td className="py-[7px] pr-3">
        <a
          href={ticket.url}
          target="_blank"
          rel="noreferrer"
          title={ticket.createdAt ? m.created(date(ticket.createdAt)) : undefined}
          className={`${LINK} break-words ${ticket.closed ? "text-mut" : ""} ${mine ? "font-medium" : ""}`}
        >
          {ticket.title}
        </a>
        {ticket.type === "task" ? <span className={`${BADGE} ml-2`}>{m.task}</span> : null}
      </td>
      <td className="py-[7px] pr-3 whitespace-nowrap">
        {ticket.status ? (
          <span className={ticket.closed ? BADGE : "inline-block bg-accent-soft px-1.5 font-mono text-[11px] leading-[18px] text-accent"}>{ticket.status}</span>
        ) : null}
      </td>
      <td className={`${DATA} py-[7px] pr-3 whitespace-nowrap ${priorityClass(ticket.priority)}`}>{ticket.priorityLabel}</td>
      <td className={`${DATA} py-[7px] pr-3 whitespace-nowrap`}>
        {mine ? (
          <span className="font-medium text-accent" title={ticket.assignee?.name}>
            {m.me}
          </span>
        ) : ticket.assignee ? (
          ticket.assignee.name
        ) : (
          <span className="text-mut italic">{m.unassigned}</span>
        )}
      </td>
      <td className={`${DATA} py-[7px] pr-2 text-right whitespace-nowrap text-mut`} title={ticket.updatedAt ? date(ticket.updatedAt) : undefined}>
        {ticket.updatedAt ? m.updated(formatAge(ticket.updatedAt, now, messages.age)) : null}
      </td>
    </tr>
  );
}
