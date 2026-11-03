import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        portfolio: resolve(__dirname, "portfolio.html"),
        project: resolve(__dirname, "project.html"),
        reviews: resolve(__dirname, "reviews.html"),
        baseplate: resolve(__dirname, "baseplate.html"),
        admin: resolve(__dirname, "admin.html"),
      },
    },
  },
});
