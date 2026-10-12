import { useSyncExternalStore, type ReactNode } from "react";

// Closed tips are remembered in this browser. Storage can be missing or blocked (private
// windows, previews): then tips just come back on the next visit.
const KEY = "voyager-space:tips-closed";
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
let closed = read();
let snapshot = closed.join("|");

function write(next: string[]) {
  closed = next;
  snapshot = next.join("|");
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a convenience only */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The ids of the tips closed so far, joined; changes when one is closed or all come back. */
export const useClosedTips = () => useSyncExternalStore(subscribe, () => snapshot);
export const closeTip = (id: string) => write([...closed.filter((x) => x !== id), id]);
export const showAllTips = () => write([]);

/** A short explanation at the top of a step that can be closed for good. */
export function Tip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const all = useClosedTips();
  if (all.split("|").includes(id)) return null;
  return (
    <aside className="tip" aria-label={title}>
      <div className="tip-text">
        <strong>{title}</strong>
        {children}
      </div>
      <button type="button" className="tip-close" aria-label={`Close the tip: ${title}`} title="Close" onClick={() => closeTip(id)}>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
    </aside>
  );
}
