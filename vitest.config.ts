import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // "server-only" só faz sentido dentro do Next; nos testes vira um módulo vazio.
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
  // O tsconfig deixa o JSX para o Next; nos testes de componentes o Vite transforma.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    fileParallelism: false,
    testTimeout: 30000,
  },
});
