import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Thin Logseq/DOM glue; logic lives in tested modules.
      exclude: ['src/main.ts', 'src/ui/mainDialog.ts', 'src/ui/dialogConflictResolver.ts'],
    },
  },
});
