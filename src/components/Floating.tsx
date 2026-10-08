import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Pos = { x: number; y: number };
// v2: default places changed (legs top left, search top right), so older saved spots are dropped.
const KEY = "voyager-space:panels";

function load(id: string): Pos | null {
  try {
    return (JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Pos>)[id] ?? null;
  } catch {
    return null;
  }
}
function save(id: string, pos: Pos | null) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Pos>;
    if (pos) all[id] = pos;
    else delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* positions are a convenience only */
  }
}

/**
 * A panel over the map that can be dragged by its grip and stays inside the map frame.
 * Without a saved position it sits where its CSS class (or `anchorStyle`) puts it.
 * Double-clicking the grip puts it back.
 */
export function Floating(props: {
  id: string;
  className?: string;
  /** where the panel sits until it is dragged */
  anchorStyle?: CSSProperties;
  /** remember the position between visits */
  persist?: boolean;
  /** size of the area it lives in, so it can be kept inside when that changes */
  bounds: { w: number; h: number };
  children: ReactNode;
}) {
  const persist = props.persist ?? true;
  const [pos, setPos] = useState<Pos | null>(() => (persist ? load(props.id) : null));
  const ref = useRef<HTMLDivElement>(null);

  const clamp = (p: Pos): Pos => {
    const el = ref.current;
    if (!el) return p;
    const maxX = Math.max(0, props.bounds.w - el.offsetWidth);
    const maxY = Math.max(0, props.bounds.h - el.offsetHeight);
    return { x: Math.min(maxX, Math.max(0, p.x)), y: Math.min(maxY, Math.max(0, p.y)) };
  };

  // Keep it inside when the frame changes size (window resize, other video shape).
  useEffect(() => {
    if (pos) setPos((p) => (p ? clamp(p) : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.bounds.w, props.bounds.h]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop };
    let latest: Pos = { x: start.left, y: start.top };
    const move = (ev: PointerEvent) => {
      latest = clamp({ x: start.left + ev.clientX - start.x, y: start.top + ev.clientY - start.y });
      setPos(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-dragging");
      if (persist) save(props.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.classList.add("is-dragging");
  };

  const style: CSSProperties = pos ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto", transform: "none" } : (props.anchorStyle ?? {});
  return (
    <div ref={ref} className={`floating ${props.className ?? ""}`} style={style}>
      <button
        type="button"
        className="grip"
        aria-label="Move panel (double-click to put it back)"
        title="Drag to move. Double-click to put it back."
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          setPos(null);
          if (persist) save(props.id, null);
        }}
      >
        <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden>
          {[2, 7, 12].flatMap((y) => [2, 6].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" fill="currentColor" />))}
        </svg>
      </button>
      {props.children}
    </div>
  );
}
