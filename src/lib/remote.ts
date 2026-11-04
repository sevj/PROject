export type RemoteInfo = { label: string; url: string | null };

/** `git@host:owner/repo.git` and `https://host/owner/repo.git` give `owner/repo` and a web link. */
export function parseRemote(remoteUrl: string): RemoteInfo {
  const scp = /^(?:[\w.-]+@)([\w.-]+):(.+?)(?:\.git)?\/?$/.exec(remoteUrl);
  if (scp) return { label: scp[2], url: `https://${scp[1]}/${scp[2]}` };

  try {
    const parsed = new URL(remoteUrl);
    const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "");
    if (!path) return { label: remoteUrl, url: null };
    const web = parsed.protocol === "http:" || parsed.protocol === "https:";
    const sshLike = parsed.protocol === "ssh:" || parsed.protocol === "git:";
    if (web || sshLike) {
      return { label: path, url: `${web ? parsed.protocol : "https:"}//${parsed.hostname}/${path}` };
    }
  } catch {
    // A local path, for instance: there is nothing to link to.
  }
  return { label: remoteUrl, url: null };
}

/** `0.0.0.0:5438->5432/tcp, [::]:5438->5432/tcp, 80/tcp` gives `["5438"]`. */
export function publishedPorts(ports: string): string[] {
  const found = new Set<string>();
  for (const match of ports.matchAll(/:(\d+(?:-\d+)?)->/g)) found.add(match[1]);
  return [...found];
}
