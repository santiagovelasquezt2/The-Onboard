import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isDrivingLineRunPayload } from './src/features/replay/calibration/drivingLineRunPayload.ts'

const DRIVING_LINE_RUN_ENDPOINT = '/api/driving-line-runs'
const MAXIMUM_RUN_PAYLOAD_BYTES = 1_000_000

function drivingLineRunWriter(): Plugin {
  return {
    name: 'driving-line-run-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(DRIVING_LINE_RUN_ENDPOINT, (request, response, next) => {
        if (request.method !== 'POST') {
          next()
          return
        }

        let body = ''
        let rejected = false
        request.setEncoding('utf8')
        request.on('data', (chunk: string) => {
          if (rejected) return
          body += chunk
          if (Buffer.byteLength(body, 'utf8') > MAXIMUM_RUN_PAYLOAD_BYTES) {
            rejected = true
            response.statusCode = 413
            response.setHeader('content-type', 'application/json')
            response.end(JSON.stringify({ error: 'Pass payload is too large.' }))
          }
        })
        request.on('end', () => {
          if (rejected) return
          void (async () => {
            try {
              let payload: unknown
              try {
                payload = JSON.parse(body)
              } catch {
                response.statusCode = 400
                response.setHeader('content-type', 'application/json')
                response.end(JSON.stringify({ error: 'Pass body must be valid JSON.' }))
                return
              }

              if (!isDrivingLineRunPayload(payload)) {
                response.statusCode = 400
                response.setHeader('content-type', 'application/json')
                response.end(JSON.stringify({ error: 'Invalid driving-line pass.' }))
                return
              }

              const safeId = payload.run.id
              const outputDirectory = path.resolve(
                process.cwd(),
                'data',
                'calibration-runs',
              )
              const outputPath = path.join(outputDirectory, `${safeId}.json`)
              await mkdir(outputDirectory, { recursive: true })
              await writeFile(
                outputPath,
                `${JSON.stringify(payload, null, 2)}\n`,
                'utf8',
              )
              response.statusCode = 200
              response.setHeader('content-type', 'application/json')
              response.end(
                JSON.stringify({
                  path: path.relative(process.cwd(), outputPath),
                }),
              )
            } catch (error) {
              response.statusCode = 500
              response.setHeader('content-type', 'application/json')
              response.end(
                JSON.stringify({
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Could not save pass.',
                }),
              )
            }
          })()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  build: {
    license: {
      fileName: 'THIRD_PARTY_LICENSES.md',
    },
  },
  publicDir: command === 'build' ? '.release/public' : 'public',
  plugins: [react(), drivingLineRunWriter()],
}))
