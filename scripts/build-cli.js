const path = require('node:path')
const fs = require('node:fs')
const esbuild = require('esbuild')

esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  banner: { js: '#!/usr/bin/env node' },
  outfile: path.resolve(__dirname, '../lib/cli.cjs'),
  logLevel: 'info',
})
fs.chmodSync(path.resolve(__dirname, '../lib/cli.cjs'), 0o755)
