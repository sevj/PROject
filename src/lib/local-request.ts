export const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Other names the app answers to, such as the one a local reverse proxy gives it:
 * `PM_ALLOWED_HOSTS=project.dev.local`. Exact names only, no pattern. Empty by default.
 */
export function allowedHostnames(env: string | undefined = process.env.PM_ALLOWED_HOSTS): Set<string> {
  return new Set(
    (env ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase())
      .filter((name) => /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)),
  );
}

export type RequestHeaders = {
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
};

export function hostnameOf(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/**
 * The app can run commands on this machine, so a page open in the browser must
 * not be able to reach it. Checking `Host` stops DNS rebinding; checking `Origin`
 * and `Sec-Fetch-Site` stops requests sent by another site.
 */
export function isLocalRequest({ host, origin, secFetchSite }: RequestHeaders, extraHostnames = allowedHostnames()): boolean {
  if (!host) return false;
  const hostname = hostnameOf(host);
  if (!hostname || !(LOOPBACK_HOSTNAMES.has(hostname) || extraHostnames.has(hostname))) return false;

  if (secFetchSite === "cross-site") return false;

  if (origin !== null) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      // Sandboxed pages and data: URLs send the literal "null".
      return false;
    }
  }
  return true;
}
