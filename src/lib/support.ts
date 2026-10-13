/**
 * "Buy me a coffee": the same on-page support panel as on nassau.se/apps. Markup, classes and
 * behaviour follow the Apps page's own script, so both open the identical dialog: the Buy Me a
 * Coffee widget page in a frame, a close button, Escape and the backdrop to close, focus kept
 * inside while open and returned to the button afterwards. The styles are the `.nx-bmc` block in
 * styles.css, copied from the Apps page.
 */
const BMC_ID = "nassau";
export const BMC_PAGE = `https://buymeacoffee.com/${BMC_ID}`;
const BMC_SRC =
  `https://www.buymeacoffee.com/widget/page/${BMC_ID}` +
  `?description=${encodeURIComponent("Thanks for supporting Nassau Apps!")}&color=${encodeURIComponent("#BAD70A")}`;

let bmc: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
let last: HTMLElement | null = null;
let hideTimer = 0;

function build(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "nx-bmc";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "nx-bmc-title");
  el.hidden = true;
  el.innerHTML =
    '<div class="nx-bmc-backdrop" data-bmc-close></div>' +
    '<div class="nx-bmc-panel">' +
    '<div class="nx-bmc-head"><div><div class="nx-bmc-eyebrow">Support Nassau Apps</div><div class="nx-bmc-title" id="nx-bmc-title">Buy me a coffee</div></div>' +
    '<button type="button" class="nx-bmc-close" data-bmc-close aria-label="Close"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>' +
    '<div class="nx-bmc-frame"><div class="nx-bmc-loading"><span></span>Loading…</div></div>' +
    `<div class="nx-bmc-foot">Payments are handled securely by Buy Me a Coffee. <a href="${BMC_PAGE}" target="_blank" rel="noopener">Open in new tab ↗</a></div>` +
    "</div>";
  document.body.appendChild(el);
  el.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-bmc-close]")) closeSupport();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSupport();
    }
    if (e.key === "Tab") {
      const f = Array.from(el.querySelectorAll<HTMLElement>("button,a[href],iframe"));
      if (!f.length) return;
      const a = f[0];
      const z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
  });
  return el;
}

export function openSupport(trigger?: HTMLElement | null) {
  const el = (bmc ??= build());
  last = trigger ?? (document.activeElement as HTMLElement | null);
  window.clearTimeout(hideTimer);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.title = "Buy me a coffee for Nassau";
    frame.src = BMC_SRC;
    frame.setAttribute("allow", "payment");
    frame.addEventListener("load", () => el.classList.add("is-loaded"));
    el.querySelector(".nx-bmc-frame")!.appendChild(frame);
  }
  el.hidden = false;
  document.documentElement.classList.add("nx-bmc-lock");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.classList.add("is-open");
      el.querySelector<HTMLElement>(".nx-bmc-close")?.focus();
    }),
  );
}

export function closeSupport() {
  const el = bmc;
  if (!el || el.hidden) return;
  el.classList.remove("is-open");
  document.documentElement.classList.remove("nx-bmc-lock");
  hideTimer = window.setTimeout(() => {
    el.hidden = true;
  }, 320);
  last?.focus?.();
}
