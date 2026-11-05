import { sql } from "drizzle-orm";
import { ENGINES } from "../../lib/db-engines";
import type { JournalConfig } from "../../lib/journal";
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/** A group is a multi-project: a heading for its sub-projects, with no facts of its own. */
export const PROJECT_KINDS = ["project", "group"] as const;
export const PROJECT_STATUSES = ["active", "paused", "resume"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type VersionFact = { label: string; value: string };

export type ContainerFact = {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
  workingDir?: string;
};

/** Identity of a folder. Rows survive when the folder disappears. */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull().unique(),
  name: text("name").notNull(),
  kind: text("kind", { enum: PROJECT_KINDS }).notNull().default("project"),
  parentId: integer("parent_id").references((): AnySQLiteColumn => projects.id, {
    onDelete: "set null",
  }),
  /** Set aside by the user: never read again, and shown only in its own view. */
  abandoned: integer("abandoned", { mode: "boolean" }).notNull().default(false),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" }).notNull().default(now),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" }).notNull().default(now),
  missingAt: integer("missing_at", { mode: "timestamp" }),
});

/** Everything read on disk. A refresh overwrites the whole row. */
export const projectFacts = sqliteTable("project_facts", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  stacks: text("stacks", { mode: "json" }).$type<string[]>().notNull().default([]),
  hasGit: integer("has_git", { mode: "boolean" }).notNull().default(false),
  branch: text("branch"),
  upstream: text("upstream"),
  ahead: integer("ahead"),
  behind: integer("behind"),
  dirtyCount: integer("dirty_count"),
  remoteUrl: text("remote_url"),
  commitCount: integer("commit_count"),
  branchCount: integer("branch_count"),
  stashCount: integer("stash_count"),
  unpushedCount: integer("unpushed_count"),
  remoteCount: integer("remote_count"),
  firstCommitAt: integer("first_commit_at", { mode: "timestamp" }),
  lastCommitAuthor: text("last_commit_author"),
  lastCommitAt: integer("last_commit_at", { mode: "timestamp" }),
  lastCommitSubject: text("last_commit_subject"),
  weeklyCommits: text("weekly_commits", { mode: "json" }).$type<number[]>(),
  hasCompose: integer("has_compose", { mode: "boolean" }).notNull().default(false),
  containers: text("containers", { mode: "json" }).$type<ContainerFact[]>().notNull().default([]),
  docs: text("docs", { mode: "json" }).$type<string[]>().notNull().default([]),
  envFiles: text("env_files", { mode: "json" }).$type<string[]>().notNull().default([]),
  versions: text("versions", { mode: "json" }).$type<VersionFact[]>().notNull().default([]),
  packageManagers: text("package_managers", { mode: "json" }).$type<string[]>().notNull().default([]),
  ci: text("ci", { mode: "json" }).$type<string[]>().notNull().default([]),
  testTools: text("test_tools", { mode: "json" }).$type<string[]>().notNull().default([]),
  manifestDescription: text("manifest_description"),
  sizeBytes: integer("size_bytes"),
  depsBytes: integer("deps_bytes"),
  gitBytes: integer("git_bytes"),
  sizeScannedAt: integer("size_scanned_at", { mode: "timestamp" }),
  scanError: text("scan_error"),
  scannedAt: integer("scanned_at", { mode: "timestamp" }).notNull().default(now),
});

/** Everything the user decides. A refresh never writes here. */
export const projectMeta = sqliteTable("project_meta", {
  projectId: integer("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: text("status", { enum: PROJECT_STATUSES }),
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  /** Replaces the folder name on screen. The folder itself is never renamed. */
  displayName: text("display_name"),
  description: text("description"),
  /** The remote that Fetch reads. Null reads them all. */
  fetchRemote: text("fetch_remote"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const projectTags = sqliteTable(
  "project_tags",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.tagId] })],
);

export const scans = sqliteTable("scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(now),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  status: text("status", { enum: ["running", "done", "failed"] }).notNull().default("running"),
  projectCount: integer("project_count"),
  errorCount: integer("error_count"),
  error: text("error"),
  warning: text("warning"),
});

export const DUMP_STATUSES = ["running", "done", "failed", "cancelled"] as const;

/**
 * What was dumped from a database container, and where the file is. The names are copied
 * because the dump must stay readable after its project or container is gone.
 */
export const dumps = sqliteTable("dumps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
  projectName: text("project_name").notNull(),
  containerName: text("container_name").notNull(),
  engine: text("engine", { enum: ENGINES }).notNull(),
  /** Null when every database of the server was dumped. */
  database: text("database"),
  /** Relative to the stash folder. */
  fileName: text("file_name").notNull(),
  /** What the file weighs, compressed. */
  sizeBytes: integer("size_bytes"),
  /** What the dump weighed before it was compressed. */
  rawBytes: integer("raw_bytes"),
  status: text("status", { enum: DUMP_STATUSES }).notNull().default("running"),
  error: text("error"),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
});

export const ENV_HISTORY_ORIGINS = ["edit", "restore", "file"] as const;

/**
 * Every value a variable of a project's `.env.local` has had, secrets included, in clear:
 * going back to one is the point. It disappears with its project.
 */
export const envValueHistory = sqliteTable(
  "env_value_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** Null when the variable was removed from the file. */
    value: text("value"),
    /** `file`: found in the file just before being overwritten, so not saved from here. */
    origin: text("origin", { enum: ENV_HISTORY_ORIGINS }).notNull(),
    savedAt: integer("saved_at", { mode: "timestamp" }).notNull().default(now),
  },
  (table) => [index("env_value_history_project_key").on(table.projectId, table.key)],
);

/**
 * One call to the API made by Claude Code, read from its transcripts. Only figures: what
 * was said stays in the transcripts. A row outlives its transcript, which Claude Code
 * purges, and its project, whose folder is still known by `cwd`.
 */
export const claudeApiCalls = sqliteTable(
  "claude_api_calls",
  {
    messageId: text("message_id").primaryKey(),
    sessionId: text("session_id").notNull(),
    /** Null when `cwd` is in no registered project. */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    cwd: text("cwd").notNull(),
    calledAt: integer("called_at", { mode: "timestamp" }).notNull(),
    model: text("model").notNull(),
    /** Made by a subagent rather than by the conversation itself. */
    isSidechain: integer("is_sidechain", { mode: "boolean" }).notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    cacheWrite5mTokens: integer("cache_write_5m_tokens").notNull(),
    cacheWrite1hTokens: integer("cache_write_1h_tokens").notNull(),
    webSearchRequests: integer("web_search_requests").notNull(),
    speed: text("speed"),
  },
  (table) => [
    index("claude_api_calls_project_called").on(table.projectId, table.calledAt),
    index("claude_api_calls_session").on(table.sessionId),
    index("claude_api_calls_cwd").on(table.cwd),
  ],
);

/** How far each transcript has been read. Transcripts only grow, until they are purged. */
export const claudeTranscripts = sqliteTable("claude_transcripts", {
  path: text("path").primaryKey(),
  /** Always just after a line break: a line still being written is read next time. */
  offset: integer("offset").notNull(),
  /** Lines that should have held a call but could not be understood. */
  unreadableLines: integer("unreadable_lines").notNull().default(0),
});

/** A single row: settings are read together and written together. */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  value: text("value", { mode: "json" })
    .$type<{ locale?: string; ideCommands: Record<string, string>; terminalCommand: string; journal?: JournalConfig }>()
    .notNull(),
});

/** The last result of an analysis a project can be put through, dated: read when asked, shown until the next one. */
export const analyses = sqliteTable(
  "analyses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** What was analyzed, such as "dependencies". */
    kind: text("kind").notNull(),
    result: text("result", { mode: "json" }).notNull(),
    analyzedAt: integer("analyzed_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("analyses_project_kind").on(table.projectId, table.kind)],
);

/** What was run in the SQL editor of a project, newest last. Browsing a table is not kept. */
export const queryHistory = sqliteTable(
  "query_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    containerName: text("container_name").notNull(),
    database: text("database").notNull(),
    statement: text("statement").notNull(),
    ranAt: integer("ran_at", { mode: "timestamp" }).notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    rowCount: integer("row_count"),
    elapsedMs: integer("elapsed_ms").notNull(),
  },
  (table) => [index("query_history_project").on(table.projectId, table.ranAt)],
);

/** Moments at which files of a project were seen to change, for the work journal. Only kept when the sampler is on. */
export const activitySamples = sqliteTable(
  "activity_samples",
  {
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Milliseconds, to the minute. */
    at: integer("at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.at] })],
);

export const SERVER_KINDS = ["ssh", "kubernetes"] as const;
export const SSH_AUTHS = ["alias", "agent", "key", "password"] as const;

export type EnvironmentUrl = { label: string; url: string };

/**
 * A machine or a cluster, shared between projects: a password changes in one place. What is
 * read from the user's own SSH and Kubernetes files stays there; only its name is kept here.
 */
export const remoteServers = sqliteTable("remote_servers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  kind: text("kind", { enum: SERVER_KINDS }).notNull(),
  /** SSH: a host name, or with `alias` a Host of ~/.ssh/config. */
  host: text("host"),
  port: integer("port"),
  username: text("username"),
  auth: text("auth", { enum: SSH_AUTHS }),
  /** The path of a key, never the key. */
  keyPath: text("key_path"),
  jumpHost: text("jump_host"),
  /** Kubernetes: a context of ~/.kube/config. */
  context: text("context"),
  /** Encrypted by `src/server/secrets.ts`. Null means it is asked at each connection. */
  passwordSecret: text("password_secret"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
});

/** Integration, staging, production… of one project. */
export const projectEnvironments = sqliteTable(
  "project_environments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Asks before anything is opened on it. */
    protected: integer("protected", { mode: "boolean" }).notNull().default(false),
    urls: text("urls", { mode: "json" }).$type<EnvironmentUrl[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(now),
  },
  (table) => [uniqueIndex("project_environments_project_name").on(table.projectId, table.name)],
);

/** Where an environment runs on a server. A server still in use cannot be deleted. */
export const environmentAccesses = sqliteTable(
  "environment_accesses",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    environmentId: integer("environment_id")
      .notNull()
      .references(() => projectEnvironments.id, { onDelete: "cascade" }),
    serverId: integer("server_id")
      .notNull()
      .references(() => remoteServers.id, { onDelete: "restrict" }),
    label: text("label").notNull(),
    /** SSH: the folder of the project on the machine. */
    path: text("path"),
    namespace: text("namespace"),
    /** `deployment/api`, `statefulset/db`, `daemonset/x` or a label such as `app=api`: a pod's name changes at each deployment. */
    target: text("target"),
    container: text("container"),
  },
  (table) => [index("environment_accesses_environment").on(table.environmentId)],
);
