import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  resolve: { alias: { "heic-decoder": decodeURIComponent(new URL("./node_modules/heic-to/src/lib/libheif-without-unsafe-eval.js", import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, "") } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
