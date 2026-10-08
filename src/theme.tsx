import { useEffect, useState } from "react";

/**
 * Light/dark mode, shared with nassau.se. The site's toggle script stores the choice in
 * localStorage "dark-mode" and puts the class "dark-mode" on <html>; the app lives on the same
 * domain, so it reads and writes the same key and both stay in step. Dark is the default.
 */
const KEY = "dark-mode";

export function storedDark(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

export function applyTheme(dark: boolean, persist = true) {
  document.documentElement.classList.toggle("dark-mode", dark);
  if (persist) {
    try {
      localStorage.setItem(KEY, String(dark));
    } catch {
      /* private mode: the choice lasts for this page only */
    }
  }
}

/** The square header toggle from the Nassau design system (Theme toggle component). */
export function ThemeToggle() {
  const [dark, setDark] = useState(storedDark);
  useEffect(() => {
    // Follow a change made in another nassau.se tab.
    const on = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue !== null) {
        const d = e.newValue === "true";
        setDark(d);
        applyTheme(d, false);
      }
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  return (
    <button
      type="button"
      className="toggle_wrap"
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={() => {
        applyTheme(!dark);
        setDark(!dark);
      }}
    >
      <span className="toggle_inner">
        <svg className="switchbtn" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="var(--color--mode-light)"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12 0C12.5523 0 13 0.447715 13 1V3C13 3.55228 12.5523 4 12 4C11.4477 4 11 3.55228 11 3V1C11 0.447715 11.4477 0 12 0ZM3.5129 3.51286C3.90343 3.12234 4.53659 3.12234 4.92711 3.51286L6.34711 4.93286C6.73764 5.32338 6.73764 5.95655 6.34711 6.34707C5.95659 6.7376 5.32343 6.7376 4.9329 6.34707L3.5129 4.92707C3.12238 4.53655 3.12238 3.90338 3.5129 3.51286ZM20.4871 3.51286C20.8776 3.90339 20.8776 4.53655 20.4871 4.92707L19.0671 6.34707C18.6766 6.7376 18.0434 6.7376 17.6529 6.34707C17.2624 5.95655 17.2624 5.32338 17.6529 4.93286L19.0729 3.51286C19.4634 3.12234 20.0966 3.12234 20.4871 3.51286ZM12 8C9.79086 8 8 9.79086 8 12C8 14.2091 9.79086 16 12 16C14.2091 16 16 14.2091 16 12C16 9.79086 14.2091 8 12 8ZM6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 15.3137 15.3137 18 12 18C8.68629 18 6 15.3137 6 12ZM0 12C0 11.4477 0.447715 11 1 11H3C3.55228 11 4 11.4477 4 12C4 12.5523 3.55228 13 3 13H1C0.447715 13 0 12.5523 0 12ZM20 12C20 11.4477 20.4477 11 21 11H23C23.5523 11 24 11.4477 24 12C24 12.5523 23.5523 13 23 13H21C20.4477 13 20 12.5523 20 12ZM6.34712 17.6529C6.73764 18.0435 6.73764 18.6766 6.34711 19.0672L4.92711 20.4872C4.53659 20.8777 3.90342 20.8777 3.5129 20.4872C3.12238 20.0966 3.12238 19.4635 3.5129 19.0729L4.9329 17.6529C5.32343 17.2624 5.95659 17.2624 6.34712 17.6529ZM17.6529 17.6529C18.0434 17.2624 18.6766 17.2624 19.0671 17.6529L20.4871 19.0729C20.8776 19.4635 20.8776 20.0966 20.4871 20.4872C20.0966 20.8777 19.4634 20.8777 19.0729 20.4872L17.6529 19.0672C17.2624 18.6766 17.2624 18.0435 17.6529 17.6529ZM12 20C12.5523 20 13 20.4477 13 21V23C13 23.5523 12.5523 24 12 24C11.4477 24 11 23.5523 11 23V21C11 20.4477 11.4477 20 12 20Z"
          />
        </svg>
        <svg className="switchbtn" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="var(--color--mode-dark)"
            fillRule="evenodd"
            clipRule="evenodd"
            d="M12.0811 2.50904C12.2746 2.85242 12.2484 3.27745 12.0141 3.59442C11.1598 4.75008 10.7488 6.17395 10.8557 7.60706C10.9625 9.04018 11.5802 10.3873 12.5964 11.4035C13.6126 12.4197 14.9597 13.0374 16.3929 13.1443C17.826 13.2511 19.2498 12.8401 20.4055 11.9859C20.7225 11.7516 21.1475 11.7253 21.4909 11.9188C21.8343 12.1124 22.0319 12.4895 21.9957 12.882C21.8209 14.7734 21.1111 16.5758 19.9493 18.0785C18.7875 19.5811 17.2218 20.7218 15.4353 21.3671C13.6489 22.0124 11.7156 22.1355 9.86177 21.7221C8.0079 21.3088 6.3101 20.376 4.96702 19.0329C3.62394 17.6898 2.69115 15.992 2.27778 14.1381C1.86441 12.2843 1.98757 10.351 2.63284 8.56459C3.27811 6.77816 4.4188 5.21244 5.92145 4.05065C7.4241 2.88886 9.22654 2.17904 11.1179 2.00426C11.5104 1.96799 11.8876 2.16566 12.0811 2.50904ZM9.31629 4.43908C8.53868 4.72043 7.8055 5.12204 7.14478 5.63289C5.94266 6.56232 5.0301 7.81489 4.51389 9.24404C3.99767 10.6732 3.89914 12.2198 4.22984 13.7029C4.56054 15.186 5.30677 16.5442 6.38123 17.6187C7.45569 18.6931 8.81394 19.4394 10.297 19.7701C11.7801 20.1008 13.3267 20.0022 14.7559 19.486C16.185 18.9698 17.4376 18.0573 18.367 16.8551C18.8779 16.1944 19.2795 15.4612 19.5608 14.6836C18.5077 15.0646 17.3781 15.2233 16.2441 15.1387C14.3333 14.9962 12.5371 14.1726 11.1822 12.8177C9.82729 11.4628 9.0037 9.66661 8.8612 7.7558C8.77664 6.62183 8.93528 5.4922 9.31629 4.43908Z"
          />
        </svg>
      </span>
    </button>
  );
}

/** nassau.se's own logo file, served from the site's Webflow CDN; links back to the site. */
export const LOGO_URL = "https://cdn.prod.website-files.com/62909cbb569cec46ad7cc1fa/65569cc6a80c94742870fafe_LogoClean.svg";

export function NassauLogo() {
  return (
    <a className="brand" href="/" aria-label="Nassau, back to nassau.se">
      <img className="header-logo" src={LOGO_URL} alt="" width={96} height={20} />
    </a>
  );
}
