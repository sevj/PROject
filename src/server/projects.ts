import { eq, inArray } from "drizzle-orm";
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { cleanName, setDescription, setDisplayName } from "./classification";
import type { Db } from "./db/client";
import { projectFacts, projects } from "./db/schema";

export type ProjectInput = { name: string; description: string; directory: string };
export type SubProjectInput = { name: string; description: string; subdirectory: string };
export type Registered = { ids: number[] } | { error: string };

const expandHome = (value: string) =>
  value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readDirectory(value: string): { path: string } | { error: string } {
  const expanded = expandHome(String(value ?? "").trim());
  if (!expanded) return { error: "Le répertoire est requis." };
  if (!isAbsolute(expanded)) return { error: `« ${expanded} » doit être un chemin complet, comme ~/Projects/mon-projet.` };
  const path = resolve(expanded);
  return isDirectory(path) ? { path } : { error: `Le répertoire ${path} n'existe pas.` };
}

/** Relative to the multi-project, and a full path inside it is accepted too. */
function readSubdirectory(root: string, value: string): { path: string } | { error: string } {
  const expanded = expandHome(String(value ?? "").trim());
  if (!expanded) return { error: "Le sous-répertoire est requis." };
  const path = resolve(root, expanded);
  if (!path.startsWith(`${root}/`)) return { error: `« ${expanded} » doit se trouver dans ${root}.` };
  return isDirectory(path) ? { path } : { error: `Le répertoire ${path} n'existe pas.` };
}

function takenBy(db: Db, path: string): string | null {
  return db.select({ id: projects.id }).from(projects).where(eq(projects.path, path)).get()
    ? `Le répertoire ${path} est déjà dans la liste.`
    : null;
}

function insert(
  db: Db,
  values: { path: string; kind: "project" | "group"; parentId: number | null },
  { name, description }: { name: string; description: string },
): number {
  const { id } = db
    .insert(projects)
    .values({ ...values, name: basename(values.path) })
    .returning({ id: projects.id })
    .get();
  db.insert(projectFacts).values({ projectId: id }).run();
  setDisplayName(db, id, name);
  setDescription(db, id, String(description ?? ""));
  return id;
}

export function registerProject(db: Db, input: ProjectInput): Registered {
  const name = cleanName(input.name);
  if (!name) return { error: "Le nom est requis (80 caractères au plus)." };
  const directory = readDirectory(input.directory);
  if ("error" in directory) return directory;
  const taken = takenBy(db, directory.path);
  if (taken) return { error: taken };
  return {
    ids: [
      db.transaction((tx) =>
        insert(tx as unknown as Db, { path: directory.path, kind: "project", parentId: null }, { name, description: input.description }),
      ),
    ],
  };
}

function readSubProjects(
  db: Db,
  root: string,
  subProjects: SubProjectInput[],
): { items: { path: string; name: string; description: string }[] } | { error: string } {
  const items: { path: string; name: string; description: string }[] = [];
  for (const [index, item] of subProjects.entries()) {
    const label = `Dépôt ${index + 1} : `;
    const name = cleanName(item.name);
    if (!name) return { error: `${label}le nom est requis (80 caractères au plus).` };
    const directory = readSubdirectory(root, item.subdirectory);
    if ("error" in directory) return { error: label + directory.error };
    const taken = takenBy(db, directory.path);
    if (taken) return { error: label + taken };
    if (items.some(({ path }) => path === directory.path)) {
      return { error: `${label}ce sous-répertoire est saisi deux fois.` };
    }
    items.push({ path: directory.path, name, description: item.description });
  }
  return { items };
}

/** The first id is the multi-project itself, the others its sub-projects. */
export function registerMultiProject(db: Db, input: ProjectInput, subProjects: SubProjectInput[]): Registered {
  const name = cleanName(input.name);
  if (!name) return { error: "Le nom est requis (80 caractères au plus)." };
  const directory = readDirectory(input.directory);
  if ("error" in directory) return directory;
  const taken = takenBy(db, directory.path);
  if (taken) return { error: taken };
  if (subProjects.length === 0) return { error: "Ajoute au moins un dépôt." };
  const read = readSubProjects(db, directory.path, subProjects);
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
  if (!group || group.kind !== "group") return { error: "Ce multi-projet n'existe plus." };
  const read = readSubProjects(db, group.path, [input]);
  if ("error" in read) return { error: read.error.replace(/^Dépôt 1 : /, "") };
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
  if (!project) return { error: "Ce projet n'existe plus." };
  const parent = project.parentId
    ? db.select().from(projects).where(eq(projects.id, project.parentId)).get()
    : undefined;
  const directory = parent ? readSubdirectory(parent.path, value) : readDirectory(value);
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
