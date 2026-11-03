#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { generate } from './generator.js'
import { parseCliArgs } from './cli-args.js'

const parsed = parseCliArgs(process.argv, process.cwd())

if (parsed.action === 'help') {
  console.log(
    [
      'Usage: openapi-react-query [--config <path>]',
      '',
      'Generate typed React Query v5 hooks from an OpenAPI 3.1 spec.',
      '',
      'Options:',
      '  --config <path>   Path to config file (default: openapi-react-query.config.json in cwd)',
      '  --help, -h        Show this help message',
      '  --version, -v     Show version number',
    ].join('\n')
  )
  process.exit(0)
}

if (parsed.action === 'version') {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
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
