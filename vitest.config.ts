import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
      "cloudflare:workers": path.resolve(
        import.meta.dirname,
        "lib/__tests__/cloudflare-workers-stub.ts"
      ),
    },
  },
  test: {
    include: ["lib/__tests__/**/*.test.ts"],
  },
})
