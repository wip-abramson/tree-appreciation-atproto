import { defineConfig } from 'tsup'

export default defineConfig({
  // Two entrypoints: the web server and the standalone firehose ingester.
  entry: ['src/index.ts', 'src/ingester-runner.ts'],
  format: ['cjs'],
  target: 'esnext',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: false,
  dts: false,
})
