#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generate } from './generator.js'
import { parseCliArgs } from './cli-args.js'

// esbuild bundles this file to CJS where __dirname is provided by Node.js.
// TypeScript does not know about __dirname in ESM source, so we declare it here.
// This file is excluded from tsc (tsconfig.build.json) and processed only by esbuild.
declare const __dirname: string

const parsed = parseCliArgs(process.argv, process.cwd())

if (parsed.action === 'help') {
  console.log(
    [
      'Usage: openapi-server [--config <path>]',
      '',
      'Generate a typed service interface and a Hono router from an OpenAPI 3.1 spec.',
      '',
      'Options:',
      '  --config <path>   Path to config file (default: openapi-server.config.json in cwd)',
      '  --help, -h        Show this help message',
      '  --version, -v     Show version number',
    ].join('\n')
  )
  process.exit(0)
}

if (parsed.action === 'version') {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
    version: string
  }
  console.log(pkg.version)
  process.exit(0)
}

if (parsed.action === 'error') {
  console.error(parsed.message)
  process.exit(1)
}

generate(parsed.cwd, parsed.configFile).catch((err: Error) => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
