import { describe, expect, it } from "vitest";
import {
  isContainerName,
  isHost,
  isJumpHost,
  isKubeTarget,
  isNamespace,
  isPort,
  isRemotePath,
  isUsername,
  isWebUrl,
  choosePod,
  isPodName,
  kubeClusterArguments,
  kubeExecArguments,
  kubePodsArguments,
  kubeWorkloadArguments,
  looksLikeProduction,
  parsePods,
  parseSshAliases,
  readKubeExit,
  privateKeysAmong,
  readSshExit,
  sshArguments,
  sshConsoleArguments,
  sshProbe,
  type SshTarget,
  workloadSelector,
} from "./remote-servers";

const target: SshTarget = { host: "srv1", port: 2222, username: "deploy", auth: "agent", keyPath: null, jumpHost: null };

describe("what can be declared", () => {
  it("refuses what could be read as an option or by a shell", () => {
    for (const bad of ["-oProxyCommand=x", "a b", "a;b", "$(x)", ""]) {
      expect(isHost(bad)).toBe(false);
      expect(isUsername(bad)).toBe(false);
      expect(isJumpHost(bad)).toBe(false);
    }
    expect(isHost("srv-1.example.fr")).toBe(true);
    expect(isHost("2001:db8::1")).toBe(true);
    expect(isJumpHost("me@bastion:2222")).toBe(true);
  });

  it("checks ports and Kubernetes names", () => {
    expect([0, 22, 65536, 1.5].map(isPort)).toEqual([false, true, false, false]);
    expect(isNamespace("my-ns")).toBe(true);
    expect(isNamespace("-x")).toBe(false);
    expect(isContainerName("php")).toBe(true);
    expect(isContainerName("a b")).toBe(false);
  });

  it("takes a workload or labels, not a pod's name that will change", () => {
    for (const good of ["deployment/api", "statefulset/db", "daemonset/x", "app=api", "app.kubernetes.io/name=api,tier=web"]) {
      expect(isKubeTarget(good)).toBe(true);
    }
    for (const bad of ["pod/api-7f9c", "api", "--all-namespaces", "deployment/", "a=b;c"]) expect(isKubeTarget(bad)).toBe(false);
  });

  it("wants an absolute folder", () => {
    expect(isRemotePath("/var/www/app")).toBe(true);
    expect(isRemotePath("~/app")).toBe(false);
    expect(isRemotePath("app")).toBe(false);
  });

  it("only opens web addresses", () => {
    expect(isWebUrl("https://exemple.fr/admin")).toBe(true);
    expect(isWebUrl("http://localhost:3000")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "exemple.fr", ""]) expect(isWebUrl(bad)).toBe(false);
  });

  it("recognizes production, not what precedes it", () => {
    for (const name of ["Production", "prod", "PROD EU", "prod-eu", "site_prod"]) expect(looksLikeProduction(name)).toBe(true);
    for (const name of ["Préproduction", "preprod", "pre-prod", "Recette", "produit"]) expect(looksLikeProduction(name)).toBe(false);
  });
});

describe("sshArguments", () => {
  it("ends with the destination behind --, and never asks anything", () => {
    const args = sshArguments(target, "true", "/home/me");
    expect(args).toContain("BatchMode=yes");
    expect(args.slice(-3)).toEqual(["--", "srv1", "true"]);
    expect(args).toEqual(expect.arrayContaining(["-p", "2222", "-l", "deploy"]));
  });

  it("uses only the given key, with its home expanded", () => {
    const args = sshArguments({ ...target, auth: "key", keyPath: "~/.ssh/id_rsa" }, "true", "/home/me");
    expect(args).toEqual(expect.arrayContaining(["-i", "/home/me/.ssh/id_rsa", "-o", "IdentitiesOnly=yes"]));
  });

  it("lets the user's config decide everything for an alias", () => {
    const args = sshArguments({ ...target, auth: "alias", jumpHost: "b" }, "true", "/home/me");
    for (const option of ["-p", "-l", "-J"]) expect(args).not.toContain(option);
  });

  it("answers one password prompt, and never holds the password", () => {
    const args = sshArguments({ ...target, auth: "password" }, "true", "/home/me");
    expect(args).not.toContain("BatchMode=yes");
    expect(args).toContain("NumberOfPasswordPrompts=1");
  });

  it("never accepts a host key on the user's behalf", () => {
    expect(sshArguments(target, "true", "/home/me").join(" ")).not.toContain("StrictHostKeyChecking");
  });
});

describe("sshConsoleArguments", () => {
  it("opens a terminal that can ask its questions", () => {
    const args = sshConsoleArguments(target, null, false, "/home/me");
    expect(args[0]).toBe("-tt");
    expect(args).not.toContain("BatchMode=yes");
    expect(args).not.toContain("NumberOfPasswordPrompts=1");
    expect(args.join(" ")).not.toContain("StrictHostKeyChecking");
    expect(args.slice(-2)).toEqual(["--", "srv1"]);
  });

  it("goes to the folder, quoted, and keeps the session if it is gone", () => {
    expect(sshConsoleArguments(target, "/var/it's", false, "/h").at(-1)).toBe(`cd '/var/it'\\''s'; exec "\${SHELL:-/bin/sh}" -l`);
  });

  it("gives a kept password one try", () => {
    expect(sshConsoleArguments({ ...target, auth: "password" }, null, true, "/h")).toContain("NumberOfPasswordPrompts=1");
  });
});

describe("sshProbe", () => {
  it("only looks, and quotes the folder", () => {
    expect(sshProbe(null)).toBe("true");
    expect(sshProbe("/var/www/it's; rm -rf /")).toBe(`test -d '/var/www/it'\\''s; rm -rf /'`);
  });
});

describe("readSshExit", () => {
  it("says what went wrong", () => {
    expect(readSshExit(0, "", false, false)).toBeNull();
    expect(readSshExit(null, "", false, false)).toBe("timeout");
    expect(readSshExit(5, "", true, false)).toBe("wrongPassword");
    expect(readSshExit(6, "", true, false)).toBe("unknownHostKey");
    expect(readSshExit(1, "", false, true)).toBe("folderMissing");
    expect(readSshExit(255, "Host key verification failed.", false, false)).toBe("unknownHostKey");
    expect(readSshExit(255, "me@srv: Permission denied (publickey).", false, false)).toBe("refused");
    expect(readSshExit(255, "ssh: connect to host x port 22: Connection refused", false, false)).toBe("unreachable");
    expect(readSshExit(255, "something else", false, false)).toBe("unknown");
  });
});

describe("kubectl", () => {
  it("always names its context and never changes the current one", () => {
    const all = [...kubeClusterArguments("prod"), ...kubeWorkloadArguments("prod", "ns", "deployment/api"), ...kubePodsArguments("prod", null, "app=api")];
    expect(all.filter((arg) => arg === "--context=prod")).toHaveLength(3);
    expect(all).not.toContain("config");
    expect(all).not.toContain("use-context");
  });
});

// As the cluster of connector-astee answers: the selector of the main workload also matches its database.
const raw = (name: string, owner: { kind: string; name: string } | null, hash?: string, extra: object = {}, ready = true) => ({
  metadata: { name, labels: hash ? { "pod-template-hash": hash } : {}, ownerReferences: owner ? [{ ...owner, controller: true }] : [], ...extra },
  spec: { containers: [{ name: "php" }, { name: "nginx" }] },
  status: { containerStatuses: [{ ready }] },
});
const main = raw("astee-685b-pmh65", { kind: "ReplicaSet", name: "astee-685b" }, "685b");
const bdd = raw("astee-bdd-6798-dctsv", { kind: "ReplicaSet", name: "astee-bdd-6798" }, "6798");
const rabbit = raw("astee-rabbitmq-5d88-jz75g", { kind: "ReplicaSet", name: "astee-rabbitmq-5d88" }, "5d88");
const pods = (...items: object[]) => parsePods(JSON.stringify({ items }));

describe("parsePods", () => {
  it("finds the workload that owns a pod", () => {
    const [a, b, c, d] = pods(main, raw("db-0", { kind: "StatefulSet", name: "db" }), raw("x", { kind: "ReplicaSet", name: "bare" }, "other"), raw("alone", null));
    expect(a).toMatchObject({ name: "astee-685b-pmh65", owner: "deployment/astee", ready: true, terminating: false, containers: ["php", "nginx"] });
    expect(b.owner).toBe("statefulset/db");
    expect(c.owner).toBe("replicaset/bare");
    expect(d.owner).toBeNull();
  });

  it("does not take a pod still starting for a ready one", () => {
    expect(pods({ metadata: { name: "new" } })[0].ready).toBe(false);
  });
});

describe("workloadSelector", () => {
  it("reads the labels, and has nothing to say without any", () => {
    expect(workloadSelector(JSON.stringify({ spec: { selector: { matchLabels: { app: "x", service: "y" } } } }))).toBe("app=x,service=y");
    expect(workloadSelector(JSON.stringify({ spec: { selector: { matchExpressions: [] } } }))).toBeNull();
  });
});

describe("choosePod", () => {
  it("enters the pod the deployment owns, even when its selector matches others", () => {
    for (const order of [[rabbit, bdd, main], [main, bdd, rabbit]]) {
      expect(choosePod(pods(...order), "deployment/astee")).toMatchObject({ pod: { name: "astee-685b-pmh65" } });
    }
  });

  it("does not mistake a neighbour whose name starts the same", () => {
    expect(choosePod(pods(bdd, rabbit), "deployment/astee")).toEqual({ failure: "noRunningPod" });
    expect(choosePod(pods(bdd), "deployment/astee-bdd")).toMatchObject({ pod: { name: "astee-bdd-6798-dctsv" } });
  });

  it("refuses labels that span several workloads, and names them", () => {
    expect(choosePod(pods(main, bdd), "app=astee")).toEqual({ failure: "ambiguousTarget", detail: "deployment/astee, deployment/astee-bdd" });
    expect(choosePod(pods(main), "app=astee,service=principal")).toMatchObject({ pod: { name: "astee-685b-pmh65" } });
  });

  it("takes two versions of one deployment for one workload, during a rollout", () => {
    const next = raw("astee-99aa-new", { kind: "ReplicaSet", name: "astee-99aa" }, "99aa");
    expect(choosePod(pods(main, next), "app=astee")).toHaveProperty("pod");
  });

  it("prefers a ready pod, and never one on its way out", () => {
    const old = raw("a-old", { kind: "ReplicaSet", name: "a-1" }, "1", { deletionTimestamp: "2026-01-01T00:00:00Z" });
    const starting = raw("b-starting", { kind: "ReplicaSet", name: "a-2" }, "2", {}, false);
    const up = raw("c-up", { kind: "ReplicaSet", name: "a-2" }, "2");
    expect(choosePod(pods(old, starting, up), "deployment/a")).toMatchObject({ pod: { name: "c-up" } });
    expect(choosePod(pods(old), "deployment/a")).toEqual({ failure: "noRunningPod" });
  });

  it("finds statefulsets and daemonsets by their own name", () => {
    expect(choosePod(pods(raw("db-0", { kind: "StatefulSet", name: "db" })), "statefulset/db")).toHaveProperty("pod");
    expect(choosePod(pods(raw("n-1", { kind: "DaemonSet", name: "n" })), "daemonset/n")).toHaveProperty("pod");
  });
});

describe("kubectl exec", () => {
  it("names its context, its namespace and its container, and enters a chosen pod", () => {
    const args = kubeExecArguments("prod", "ns", "api-7f9c", "php");
    expect(args.slice(0, 6)).toEqual(["--context=prod", "--namespace=ns", "exec", "-it", "pod/api-7f9c", "--container=php"]);
    expect(args.slice(6, 9)).toEqual(["--", "sh", "-c"]);
    expect(args.join(" ")).not.toContain("deployment/");
  });

  it("looks only for pods that run", () => {
    expect(kubePodsArguments("c", null, "app=api")).toContain("--field-selector=status.phase=Running");
    expect(isPodName("api-7f9c-x2")).toBe(true);
    for (const bad of ["", "--help", "a b"]) expect(isPodName(bad)).toBe(false);
  });
});

describe("readKubeExit", () => {
  it("says what went wrong", () => {
    expect(readKubeExit(0, "")).toBeNull();
    expect(readKubeExit(null, "")).toBe("timeout");
    expect(readKubeExit(1, 'error: context "x" does not exist')).toBe("contextMissing");
    expect(readKubeExit(1, 'Error from server (NotFound): deployments.apps "x" not found')).toBe("targetMissing");
    expect(readKubeExit(1, "Error from server (Forbidden): pods is forbidden")).toBe("refused");
    expect(readKubeExit(1, "Unable to connect to the server: dial tcp")).toBe("unreachable");
  });
});

describe("suggestions", () => {
  it("keeps real SSH hosts", () => {
    expect(parseSshAliases("Host *\n  User x\nhost b a\n# Host no\nHost c?\nMatch all\n")).toEqual(["a", "b"]);
  });

  it("finds private keys by their public half", () => {
    expect(privateKeysAmong(["config", "id_rsa", "id_rsa.pub", "other.pub", "test.sh"])).toEqual(["id_rsa"]);
  });
});
