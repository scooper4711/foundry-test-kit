import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // Browser automation is exercised against live Foundry servers by the
      // e2e fixture suite (e2e/fixture-module, on 12–14), not by unit tests.
      exclude: [
        "src/index.ts",
        "src/fixtures.ts",
        "src/foundry-ui.ts",
        "src/overlays.ts",
        "src/session.ts",
        "src/world.ts",
        "src/seed/finish.ts",
        "src/seed/license.ts",
        "src/seed/systems.ts",
        "src/seed/world.ts",
        "src/**/cli.ts",
      ],
      thresholds: { lines: 80, branches: 80, functions: 80, statements: 80 },
    },
  },
});
