import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..', '..')

function fail(message) {
  throw new Error(`[release-toolchain] ${message}`)
}

function npmVersionFromUserAgent(userAgent) {
  const match = /(?:^|\s)npm\/([^\s]+)/.exec(userAgent ?? '')
  return match?.[1] ?? null
}

async function verifyToolchain() {
  const [packageSource, nodeVersionSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, '.nvmrc'), 'utf8'),
  ])
  const packageJson = JSON.parse(packageSource)
  const expectedNode = nodeVersionSource.trim()
  const expectedNpm = '11.10.1'

  if (packageJson.engines?.node !== '24.x') {
    fail('package.json engines.node must remain 24.x.')
  }
  if (packageJson.packageManager !== `npm@${expectedNpm}`) {
    fail(`package.json packageManager must remain npm@${expectedNpm}.`)
  }
  if (process.version !== `v${expectedNode}`) {
    fail(`Expected Node v${expectedNode}; found ${process.version}.`)
  }

  const npmVersion = npmVersionFromUserAgent(process.env.npm_config_user_agent)
  if (!npmVersion) {
    fail('Run this check through npm so the npm version can be verified.')
  }
  if (npmVersion !== expectedNpm) {
    fail(`Expected npm ${expectedNpm}; found ${npmVersion}.`)
  }

  console.log(`[release-toolchain] Node v${expectedNode} and npm ${expectedNpm} verified.`)
}

verifyToolchain().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
