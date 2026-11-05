import { loadColumns, loadDatabases, loadForeignKeys, loadTables } from "@/app/databases/actions";
import type { RegistryRow } from "@/lib/registry";
import { readClaudeConfig } from "../claude-config";
import type { Db } from "../db/client";
import { readDependencies } from "../dependencies";
import { listProjectContainers } from "../docker-containers";
import { listDatabaseContainers } from "../dumps/containers";
import { listDumps } from "../dumps/store";
import { readPorts } from "../ports";
import { getProject, getRegistry } from "../registry";
import { listEnvironments } from "../remote-servers";
import type { McpTool } from "./protocol";

export type McpContext = {
  db: Db;
  /** The project of the console asking, which tools default to. */
  projectId: number | null;
};

const PROJECT_INPUT = {
  type: "object",
  properties: { project: { type: ["string", "number"], description: "Id or name. Defaults to the project this session runs in." } },
};

function resolve({ project }: Record<string, unknown>, { db, projectId }: McpContext): RegistryRow {
  const rows = getRegistry(db).rows.filter(({ abandoned }) => !abandoned);
  const wanted = project ?? projectId;
  if (wanted === null || wanted === undefined) throw new Error("Say which project: see list_projects.");
  const name = String(wanted).toLowerCase();
  const found = rows.find(({ id, name: shown, folderName }) => String(id) === name || shown.toLowerCase() === name || folderName.toLowerCase() === name);
  if (!found) throw new Error(`No project "${String(wanted)}": see list_projects.`);
  return found;
}

/** What is said of every project: enough to pick one. No secret goes through here. */
const summary = (row: RegistryRow) => ({
  id: row.id,
  name: row.name,
  path: row.path,
  multiProject: row.parentName,
  stacks: row.stacks,
  branch: row.branch,
  changedFiles: row.dirtyCount,
  unpushedCommits: row.unpushedCount,
  remotes: row.remoteCount,
  lastCommitAt: row.lastCommitAt === null ? null : new Date(row.lastCommitAt).toISOString(),
  status: row.status,
  favorite: row.favorite,
  tags: row.tags,
  note: row.note,
  runningContainers: row.containers.filter(({ state }) => state === "running").length,
  missing: row.missing,
});

/** Read-only, and without what the app holds but must not hand out: env values, database rows, and how to reach a server. */
export const MCP_TOOLS: McpTool<McpContext>[] = [
  {
    name: "list_projects",
    description: "Every project the user tracks, with its branch, unpushed commits, status, tags and note.",
    inputSchema: { type: "object", properties: {} },
    run: async (_input, { db }) => getRegistry(db).rows.filter(({ abandoned }) => !abandoned).map(summary),
  },
  {
    name: "get_project",
    description: "One project in detail: versions, its containers with state, image, ports and web addresses, dependency alerts, available database dumps.",
    inputSchema: PROJECT_INPUT,
    run: async (input, context) => {
      const row = resolve(input, context);
      const { containers, error } = await listProjectContainers(context.db, row.id);
      return {
        ...summary(row),
        description: row.description ?? row.manifestDescription,
        versions: row.versions,
        packageManagers: row.packageManagers,
        ci: row.ci,
        testTools: row.testTools,
        docs: row.docs,
        dependencyAlerts: row.dependencies,
        dockerError: error,
        containers: containers.map(({ name, service, state, health, image, ports, urls, restartCount, exitCode }) => ({
          name,
          service,
          state,
          health,
          image,
          ports,
          urls: urls.map(({ url }) => url),
          restartCount,
          exitCode,
        })),
        dumps: listDumps(context.db)
          .filter(({ projectId, status }) => projectId === row.id && status === "done")
          .map(({ id, database, engine, containerName, sizeBytes, note, createdAt }) => ({ id, database, engine, containerName, sizeBytes, note, createdAt })),
      };
    },
  },
  {
    name: "list_ports",
    description: "Ports across all projects and this machine: published by Docker, declared in Compose, listening on the host. Collisions come first.",
    inputSchema: { type: "object", properties: {} },
    run: async (_input, { db }) => readPorts(db),
  },
  {
    name: "get_dependency_analysis",
    description: "The last stored analysis of a project's dependencies: outdated packages and known vulnerabilities, with its date. Null when none was run.",
    inputSchema: PROJECT_INPUT,
    run: async (input, context) => {
      const stored = readDependencies(context.db, resolve(input, context).id);
      return stored && { ...stored, analyzedAt: new Date(stored.analyzedAt).toISOString() };
    },
  },
  {
    name: "get_environments",
    description: "Where a project is deployed: the name of each environment (integration, staging, production…), whether it is protected, and its web addresses. Never how to connect to it.",
    inputSchema: PROJECT_INPUT,
    // Picked field by field: a new field of an environment is not handed out by accident. Notes can hold anything.
    run: async (input, context) =>
      listEnvironments(context.db, resolve(input, context).id).map(({ name, protected: isProtected, urls }) => ({ name, protected: isProtected, urls })),
  },
  {
    name: "get_claude_setup",
    description: "How Claude Code is set up in a project: instruction files and whether Claude reads them, names of MCP servers, hooks, skills, agents, commands, rules.",
    inputSchema: PROJECT_INPUT,
    run: async (input, context) => {
      const project = getProject(context.db, resolve(input, context).id);
      if (!project) throw new Error("This project is gone.");
      const { instructions, ...rest } = await readClaudeConfig(project.absolutePath);
      return { ...rest, instructions: instructions.map(({ name, lines, imports }) => ({ name, lines, imports })) };
    },
  },
  {
    name: "list_databases",
    description: "The running database containers of a project, and the databases in each. Their ids are what get_database_schema takes.",
    inputSchema: PROJECT_INPUT,
    run: async (input, context) => {
      const row = resolve(input, context);
      const { containers, error } = await listDatabaseContainers(context.db);
      if (error) throw new Error(error);
      return Promise.all(
        containers
          .filter(({ projectId }) => projectId === row.id)
          .map(async ({ id, name, service, image, engine }) => ({ id, name, service, image, engine, ...(await loadDatabases(id)) })),
      );
    },
  },
  {
    name: "get_database_schema",
    description: "The structure of a database: its tables with estimated row counts, and its foreign keys. With `table`, the columns of that table. Never any row.",
    inputSchema: {
      type: "object",
      properties: {
        container: { type: "string", description: "An id from list_databases." },
        database: { type: "string" },
        schema: { type: "string", description: "With `table`, when it is not in the default schema." },
        table: { type: "string" },
      },
      required: ["container", "database"],
    },
    run: async ({ container, database, schema, table }) => {
      const [id, name] = [String(container), String(database)];
      if (typeof table === "string") return loadColumns(id, name, typeof schema === "string" ? schema : null, table);
      const [tables, keys] = await Promise.all([loadTables(id, name), loadForeignKeys(id, name)]);
      return { ...tables, ...keys };
    },
  },
];
