import { useEffect, useState } from "react";

/**
 * Hash routing (#/ and #/p/<id>). The app is mounted under a path on nassau.se by Webflow Cloud,
 * and hash routes work under any mount path without server rewrites.
 */
export function navigate(path: string) {
  location.hash = `#${path}`;
}

export function useRoute(): string {
  const read = () => location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
