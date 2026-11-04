export const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

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
export function isLocalRequest({ host, origin, secFetchSite }: RequestHeaders): boolean {
  if (!host) return false;
  const hostname = hostnameOf(host);
  if (!hostname || !LOOPBACK_HOSTNAMES.has(hostname)) return false;

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
