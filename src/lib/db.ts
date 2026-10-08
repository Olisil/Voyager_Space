import { coerceProject, uid, type Project } from "./types";

const DB = "voyager-space";
const STORE = "projects";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error ?? req.error);
    };
  });
}

export async function listProjects(): Promise<Project[]> {
  const all = await tx<Project[]>("readonly", (s) => s.getAll() as IDBRequest<Project[]>);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | null> {
  const p = await tx<Project | undefined>("readonly", (s) => s.get(id) as IDBRequest<Project | undefined>);
  return p ? coerceProject(p) : null;
}

export async function saveProject(p: Project): Promise<void> {
  await tx("readwrite", (s) => s.put(p));
}

export async function deleteProject(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function duplicateProject(p: Project): Promise<Project> {
  const now = Date.now();
  const copy: Project = {
    ...structuredClone(p),
    id: uid(),
    name: `${p.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(copy);
  return copy;
}

// ---------- files ----------

export function slug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "trip"
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadProjectFile(p: Project) {
  const body = JSON.stringify({ format: "voyager-space", version: 1, project: p });
  downloadBlob(new Blob([body], { type: "application/json" }), `${slug(p.name)}.voyager-space.json`);
}

/** Reads a project file and stores it as a new project (it never overwrites one you have). */
export async function importProjectFile(file: File): Promise<Project> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a Voyager Space project.");
  }
  const p = coerceProject(parsed);
  const existing = await getProject(p.id);
  const now = Date.now();
  const imported: Project = { ...p, id: existing ? uid() : p.id, updatedAt: now };
  await saveProject(imported);
  return imported;
}
