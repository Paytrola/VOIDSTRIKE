import { manusGameTuning } from './scripts/manus-tuning/vite.mjs'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import type { Plugin, ViteDevServer } from 'vite'

function vitePluginStorageProxy(): Plugin {
  return {
    name: 'manus-storage-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/manus-storage', async (req, res) => {
        const requestUrl = (req as typeof req & { url?: string }).url
        const key = requestUrl?.replace(/^\//, '')
        if (!key) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Missing storage key')
          return
        }
        const runtime = (globalThis as typeof globalThis & {
          process?: { env?: Record<string, string | undefined> }
        }).process
        const env = runtime?.env ?? {}
        const forgeBaseUrl = (env.BUILT_IN_FORGE_API_URL ?? '').replace(/\/+$/, '')
        const forgeKey = env.BUILT_IN_FORGE_API_KEY
        if (!forgeBaseUrl || !forgeKey) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('Storage proxy not configured')
          return
        }
        try {
          const forgeUrl = new URL('v1/storage/presign/get', forgeBaseUrl + '/')
          forgeUrl.searchParams.set('path', key)
          const forgeResp = await fetch(forgeUrl, {
            headers: { Authorization: `Bearer ${forgeKey}` },
          })
          if (!forgeResp.ok) {
            res.writeHead(502, { 'Content-Type': 'text/plain' })
            res.end('Storage backend error')
            return
          }
          const { url } = await forgeResp.json() as { url: string }
          if (!url) {
            res.writeHead(502, { 'Content-Type': 'text/plain' })
            res.end('Empty signed URL')
            return
          }
          res.writeHead(307, { Location: url, 'Cache-Control': 'no-store' })
          res.end()
        } catch {
          res.writeHead(502, { 'Content-Type': 'text/plain' })
          res.end('Storage proxy error')
        }
      })
    },
  }
}

// Relative base keeps production output portable; the Session owns preview HOST/PORT.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', ['HOST', 'PORT'])
  const port = Number(env.PORT ?? 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
  return {
    base: './',
    plugins: [manusGameTuning(), vitePluginStorageProxy()],
    server: {
      host: env.HOST ?? '127.0.0.1', port, strictPort: true,
      allowedHosts: ['.manuspre.computer', '.manus.computer', '.manus-asia.computer', '.manuscomputer.ai', '.manusvm.computer', 'localhost', '127.0.0.1'],
    },
    build: { target: 'es2022', assetsInlineLimit: 0, chunkSizeWarningLimit: 4600, sourcemap: false },
    test: { environment: 'node', include: ['tests/**/*.test.{ts,mjs}'] },
  }
})
