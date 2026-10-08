import { useId, type ReactNode } from "react";

export function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section-title">{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Segmented<T extends string | number>(props: {
  label: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  stacked?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className={`segmented${props.stacked ? " stacked" : ""}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={props.value === o.value}
          className={props.value === o.value ? "on" : ""}
          disabled={props.disabled}
          onClick={() => props.onChange(o.value)}
        >
          <span className="seg-label">{o.label}</span>
          {o.hint && <span className="seg-hint">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  ends?: [string, string];
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{props.label}</label>
        <output htmlFor={id}>{props.format ? props.format(props.value) : props.value}</output>
      </div>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
      />
      {props.ends && (
        <div className="slider-ends" aria-hidden>
          <span>{props.ends[0]}</span>
          <span>{props.ends[1]}</span>
        </div>
      )}
    </div>
  );
}

export function Toggle(props: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="toggle">
      <input id={id} type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <label htmlFor={id}>
        <span className="toggle-track" aria-hidden />
        <span className="toggle-text">
          {props.label}
          {props.hint && <span className="toggle-hint">{props.hint}</span>}
        </span>
      </label>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}

/** A section that can be folded away; remembers nothing, opens by default. */
export function Fold({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="fold" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

export const COLORS = ["#BAD70A", "#E6FF4C", "#0ABED7", "#4FA3FF", "#F0592B", "#C5A11F", "#B98CF2", "#E6E6E6", "#0E0E0E"];

export function ColorPicker({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="colors" role="group" aria-label={label}>
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={`color${value.toLowerCase() === c.toLowerCase() ? " on" : ""}`}
          style={{ background: c }}
          aria-label={`${label} ${c}`}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          onClick={() => onChange(c)}
        />
      ))}
      <label className="color color-custom" title="Pick any colour">
        <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value || "#bad70a"} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      </label>
    </div>
  );
}
