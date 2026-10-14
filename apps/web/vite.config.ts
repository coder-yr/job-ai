import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const rootDir = resolve(__dirname, "../../");
  const env = loadEnv(mode, rootDir, "");
  const token = env.API_TOKEN || process.env.API_TOKEN || "";

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __TOKEN__: JSON.stringify(token),
      "import.meta.env.VITE_API_TOKEN": JSON.stringify(token),
    },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  };
});
