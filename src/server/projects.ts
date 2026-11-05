import { eq, inArray } from "drizzle-orm";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { addTag, cleanName, setDescription, setDisplayName } from "./classification";
import type { Db } from "./db/client";
import { projectFacts, projects } from "./db/schema";
import { serverMessages } from "./i18n";

export type ProjectInput = { name: string; description: string; directory: string; tags?: string[] };
export type SubProjectInput = { name: string; description: string; subdirectory: string; tags?: string[] };
export type Registered = { ids: number[] } | { error: string };

export const expandHome = (value: string) =>
  value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readDirectory(db: Db, value: string): { path: string } | { error: string } {
  const m = serverMessages(db).errors;
  const expanded = expandHome(String(value ?? "").trim());
  if (!expanded) return { error: m.directoryRequired };
  if (!isAbsolute(expanded)) return { error: m.directoryNotAbsolute(expanded) };
  const path = resolve(expanded);
  return isDirectory(path) ? { path } : { error: m.directoryMissing(path) };
}

/** Relative to the multi-project, and a full path inside it is accepted too. */
function readSubdirectory(db: Db, root: string, value: string): { path: string } | { error: string } {
  const m = serverMessages(db).errors;
  const expanded = expandHome(String(value ?? "").trim());
  if (!expanded) return { error: m.subdirectoryRequired };
  const path = resolve(root, expanded);
  if (!path.startsWith(`${root}/`)) return { error: m.subdirectoryOutside(expanded, root) };
  return isDirectory(path) ? { path } : { error: m.directoryMissing(path) };
}

function takenBy(db: Db, path: string): string | null {
  return db.select({ id: projects.id }).from(projects).where(eq(projects.path, path)).get()
    ? serverMessages(db).errors.directoryTaken(path)
    : null;
}

function insert(
  db: Db,
  values: { path: string; kind: "project" | "group"; parentId: number | null },
  { name, description, tags = [] }: { name: string; description: string; tags?: string[] },
): number {
  const { id } = db
    .insert(projects)
    .values({ ...values, name: basename(values.path) })
    .returning({ id: projects.id })
    .get();
  db.insert(projectFacts).values({ projectId: id }).run();
  setDisplayName(db, id, name);
  setDescription(db, id, String(description ?? ""));
  for (const tag of tags) addTag(db, [id], String(tag));
  return id;
}

/** Where a project could be added: an existing folder that no project has yet. */
export function checkDirectory(db: Db, value: string): { path: string } | { error: string } {
  const directory = readDirectory(db, value);
  if ("error" in directory) return directory;
  const taken = takenBy(db, directory.path);
  return taken ? { error: taken } : directory;
}

/** Where a sub-project could be added: a folder inside `root` that no project has yet. */
export function checkSubdirectory(db: Db, root: string, value: string): { path: string } | { error: string } {
  const directory = readSubdirectory(db, root, value);
  if ("error" in directory) return directory;
  const taken = takenBy(db, directory.path);
  return taken ? { error: taken } : directory;
}

export function registerProject(db: Db, input: ProjectInput): Registered {
  const name = cleanName(input.name);
  if (!name) return { error: serverMessages(db).errors.nameRequired };
  const directory = readDirectory(db, input.directory);
  if ("error" in directory) return directory;
  const taken = takenBy(db, directory.path);
  if (taken) return { error: taken };
  return {
    ids: [
      db.transaction((tx) =>
        insert(tx as unknown as Db, { path: directory.path, kind: "project", parentId: null }, { name, description: input.description, tags: input.tags }),
      ),
    ],
  };
}

function readSubProjects(
  db: Db,
  root: string,
  subProjects: SubProjectInput[],
  locate: boolean,
): { items: (SubProjectInput & { path: string })[] } | { error: string } {
  const m = serverMessages(db).errors;
  const items: (SubProjectInput & { path: string })[] = [];
  for (const [index, item] of subProjects.entries()) {
    // Adding to an existing multi-project has only one form, which needs no position.
    const located = (message: string) => ({ error: locate ? m.repository(index + 1, message) : message });
    const name = cleanName(item.name);
    if (!name) return located(m.nameRequired);
    const directory = readSubdirectory(db, root, item.subdirectory);
    if ("error" in directory) return located(directory.error);
    const taken = takenBy(db, directory.path);
    if (taken) return located(taken);
    if (items.some(({ path }) => path === directory.path)) return located(m.subdirectoryTwice);
    items.push({ ...item, path: directory.path, name });
  }
  return { items };
}

/** The first id is the multi-project itself, the others its sub-projects. */
export function registerMultiProject(db: Db, input: ProjectInput, subProjects: SubProjectInput[]): Registered {
  const name = cleanName(input.name);
  if (!name) return { error: serverMessages(db).errors.nameRequired };
  const directory = readDirectory(db, input.directory);
  if ("error" in directory) return directory;
  const taken = takenBy(db, directory.path);
  if (taken) return { error: taken };
  if (subProjects.length === 0) return { error: serverMessages(db).errors.noRepository };
  const read = readSubProjects(db, directory.path, subProjects, true);
  if ("error" in read) return read;

  return {
    ids: db.transaction((tx) => {
      const txDb = tx as unknown as Db;
      const parentId = insert(txDb, { path: directory.path, kind: "group", parentId: null }, { name, description: input.description });
      return [
        parentId,
        ...read.items.map((item) => insert(txDb, { path: item.path, kind: "project", parentId }, item)),
      ];
    }),
  };
}

export function registerSubProject(db: Db, groupId: number, input: SubProjectInput): Registered {
  const group = db.select().from(projects).where(eq(projects.id, groupId)).get();
  if (!group || group.kind !== "group") return { error: serverMessages(db).errors.multiProjectGone };
  const read = readSubProjects(db, group.path, [input], false);
  if ("error" in read) return read;
  const [item] = read.items;
  return {
    ids: [
      db.transaction((tx) => insert(tx as unknown as Db, { path: item.path, kind: "project", parentId: groupId }, item)),
    ],
  };
}

/**
 * Points a project at another folder, which is how a moved folder is followed.
 * A multi-project takes its sub-projects along. Returns the ids to refresh.
 */
export function changeDirectory(db: Db, projectId: number, value: string): Registered {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return { error: serverMessages(db).errors.projectGone };
  const parent = project.parentId
    ? db.select().from(projects).where(eq(projects.id, project.parentId)).get()
    : undefined;
  const directory = parent ? readSubdirectory(db, parent.path, value) : readDirectory(db, value);
  if ("error" in directory) return directory;
  const { path } = directory;

  const children = db.select().from(projects).where(eq(projects.parentId, projectId)).all();
  const moved = children.map((child) => ({
    id: child.id,
    path: path + child.path.slice(project.path.length),
  }));
  if (path !== project.path) {
    const taken = takenBy(db, path);
    if (taken) return { error: taken };
    for (const child of moved) {
      const childTaken = takenBy(db, child.path);
      if (childTaken) return { error: childTaken };
    }
  }

  db.transaction((tx) => {
    tx.update(projects).set({ path, name: basename(path) }).where(eq(projects.id, projectId)).run();
    for (const child of moved) {
      tx.update(projects).set({ path: child.path }).where(eq(projects.id, child.id)).run();
    }
  });
  return { ids: [projectId, ...moved.map(({ id }) => id)] };
}

/**
 * Takes projects off the list, with what the user entered about them. Nothing is
 * deleted on disk. A multi-project goes with its sub-projects, and an emptied one goes too.
 */
export function removeProjects(db: Db, projectIds: number[]) {
  if (projectIds.length === 0) return;
  db.transaction((tx) => {
    const removed = tx.select().from(projects).where(inArray(projects.id, projectIds)).all();
    const parentIds = new Set(removed.flatMap(({ parentId }) => parentId ?? []));
    tx.delete(projects).where(inArray(projects.parentId, projectIds)).run();
    tx.delete(projects).where(inArray(projects.id, projectIds)).run();
    for (const parentId of parentIds) {
      const remaining = tx.select({ id: projects.id }).from(projects).where(eq(projects.parentId, parentId)).get();
      if (!remaining) tx.delete(projects).where(eq(projects.id, parentId)).run();
    }
  });
}
