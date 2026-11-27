import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const here = p => fileURLToPath(new URL(p, import.meta.url));

// Four pages: grades.html = the gradebook's family page (students, parents / guardians; /grades); portal.html = the client portal (vendor office only, on PORTAL_HOST); index.html = the app (served only to signed-in people and paired TV screens), signin.html = the small
// signed-out page. Shared code (React) lands in shared chunks the server allows for both (server/index.js publicAssets).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist", chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { main: here("./index.html"), signin: here("./signin.html"), portal: here("./portal.html"), grades: here("./grades.html") } },
  },
});
