import { OpenIcon } from "@/app/icons";
import { BUTTON_SMALL } from "@/app/ui";
import { getDb } from "@/server/db/client";
import { listProjectContainers } from "@/server/docker-containers";
import { serverMessages } from "@/server/i18n";

/** Docker is asked once per page, under a Suspense of its own: the sheet does not wait for it. */
export async function ProjectSites({ projectId }: { projectId: number }) {
  const { containers } = await listProjectContainers(getDb(), projectId);
  const sites = containers.filter(({ running }) => running).flatMap(({ urls, service }) => urls.map((site) => ({ ...site, service })));
  // A hub such as Mercure answers on a `.well-known` path: nobody opens it to read it. The Docker tab still lists it.
  const pages = sites.filter(({ label }) => !label.includes("/.well-known"));
  // The site itself usually has the shortest name, next to its mails or its admin.
  const unique = [...new Map(pages.map((site) => [site.url, site])).values()].sort((a, b) => a.label.length - b.label.length);
  const m = serverMessages(getDb()).sheet.dockerTab;
  return unique.map(({ url, label, service }) => (
    <a key={url} href={url} target="_blank" rel="noreferrer" title={m.openSite(url, service)} className={BUTTON_SMALL}>
      {label}
      <OpenIcon />
    </a>
  ));
}
