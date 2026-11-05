export type ContainerUrl = { url: string; label: string };

type Port = { host: string | null; container: string };

/** A published port says nothing of what answers on it: only the usual web ports get a link. */
const WEB_PORTS = new Set(["80", "3000", "3001", "4200", "5173", "8000", "8001", "8025", "8080", "8081", "8888", "15672"]);
const TLS_PORTS = new Set(["443", "8443"]);
const TLS_ENTRYPOINTS = new Set(["https", "websecure"]);

const ROUTER_RULE = /^traefik\.http\.routers\.(.+)\.rule$/;
const HOST = /Host\(\s*([^)]*)\)/g;
const QUOTED = /[`"']([\w.-]+)[`"']/g;
const PATH_PREFIX = /PathPrefix\(\s*[`"'](\/[\w./-]*)[`"']\s*\)/;

function traefikUrls(labels: Record<string, string>): ContainerUrl[] {
  if (labels["traefik.enable"] === "false") return [];
  // A site usually has one router per scheme, for one address: https wins.
  const found = new Map<string, boolean>();
  for (const [key, rule] of Object.entries(labels)) {
    const router = ROUTER_RULE.exec(key)?.[1];
    if (!router) continue;
    const entrypoints = (labels[`traefik.http.routers.${router}.entrypoints`] ?? "").split(",");
    const secure =
      labels[`traefik.http.routers.${router}.tls`] === "true" || entrypoints.some((name) => TLS_ENTRYPOINTS.has(name.trim()));
    const path = PATH_PREFIX.exec(rule)?.[1] ?? "";
    for (const [, hosts] of rule.matchAll(HOST)) {
      for (const [, host] of hosts.matchAll(QUOTED)) {
        const address = `${host}${path === "/" ? "" : path}`;
        found.set(address, secure || found.get(address) === true);
      }
    }
  }
  return [...found].map(([address, secure]) => ({ url: `${secure ? "https" : "http"}://${address}`, label: address }));
}

function portUrls(ports: Port[]): ContainerUrl[] {
  const found = new Map<string, ContainerUrl>();
  for (const { host, container } of ports) {
    const [target, protocol] = container.split("/");
    const secure = TLS_PORTS.has(target);
    if (host === null || (protocol && protocol !== "tcp") || !(secure || WEB_PORTS.has(target))) continue;
    // `8080` or `127.0.0.1:8080`: a range or an IPv6 address gives no link.
    const match = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d+)$/.exec(host);
    if (!match) continue;
    const label = `${match[1] ?? "127.0.0.1"}:${match[2]}`;
    found.set(label, { url: `${secure ? "https" : "http"}://${label}`, label });
  }
  return [...found.values()];
}

/** Where a container answers. Its Traefik addresses are the ones meant to be used, when it has any. */
export function containerUrls(labels: Record<string, string>, ports: Port[]): ContainerUrl[] {
  const routed = traefikUrls(labels);
  return routed.length > 0 ? routed : portUrls(ports);
}
