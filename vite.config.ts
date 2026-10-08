import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No `base` here on purpose: Webflow Cloud sets it at build time from the
// environment's mount path (e.g. /voyager-earth). Everything in the app is loaded
// through bundled imports, so it works under any mount path.
export default defineConfig({
  plugins: [react()],
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
