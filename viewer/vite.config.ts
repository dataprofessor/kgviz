import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    dedupe: ["three"],
  },
  optimizeDeps: {
    include: ["three", "3d-force-graph", "three-forcegraph"],
  },
  build: {
    outDir: "build",
    assetsDir: "assets",
    rollupOptions: {
      output: {
        entryFileNames: "assets/kgviz.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
  server: {
    port: 3001,
  },
})
