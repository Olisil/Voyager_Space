import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// "0.3.0" shows as "0.3"; a patch number shows only when it is not 0.
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const version = pkg.version.replace(/\.0$/, "");

// No `base` here on purpose: Webflow Cloud sets it at build time from the
// environment's mount path (e.g. /voyager-space). Everything in the app is loaded
// through bundled imports, so it works under any mount path.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
