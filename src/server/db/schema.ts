import { sql } from "drizzle-orm";
import { ENGINES } from "../../lib/db-engines";
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
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

/** A single row: settings are read together and written together. */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  value: text("value", { mode: "json" })
    .$type<{ locale?: string; ideCommands: Record<string, string>; terminalCommand: string }>()
    .notNull(),
});
