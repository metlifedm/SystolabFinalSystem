import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      SYSTOLAB_MEMORY_STORE: "true",
      NODE_ENV: "test",
      SYSTOLAB_OWNER_ADMIN_KEY: "OwnerPassword!Secure123"
    },
    setupFiles: ["./src/vitest.setup.ts"]
  }
});
