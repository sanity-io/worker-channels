import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      exclude: ['package.config.ts', 'eslint.config.mjs', 'vitest.config.ts'],
    },
  },
})
