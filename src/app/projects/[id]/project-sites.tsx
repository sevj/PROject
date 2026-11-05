import { OpenIcon } from "@/app/icons";
import { BUTTON } from "@/app/ui";
import { getDb } from "@/server/db/client";
import { listProjectContainers } from "@/server/docker-containers";
import { serverMessages } from "@/server/i18n";

/** Docker is asked once per page, under a Suspense of its own: the sheet does not wait for it. */
export async function ProjectSites({ projectId }: { projectId: number }) {
  const { containers } = await listProjectContainers(getDb(), projectId);
  const sites = containers.filter(({ running }) => running).flatMap(({ urls, service }) => urls.map((site) => ({ ...site, service })));
  const unique = [...new Map(sites.map((site) => [site.url, site])).values()];
  const m = serverMessages(getDb()).sheet.dockerTab;
  return unique.map(({ url, label, service }) => (
    <a key={url} href={url} target="_blank" rel="noreferrer" title={m.openSite(url, service)} className={BUTTON}>
      {label}
      <OpenIcon />
    </a>
  ));
}
