/**
 * Standalone worker sync script (Currently commented out for standard Next.js web app mode)
 *
 * const fs = require('node:fs')
 * const path = require('node:path')
 * const rootDir = path.resolve(__dirname, '..')
 * const openNextDir = path.join(rootDir, '.open-next')
 * const openNextAssetsDir = path.join(openNextDir, 'assets')
 * const workerSrc = path.join(rootDir, 'worker.js')
 * const workerDest = path.join(openNextDir, 'worker.js')
 * if (!fs.existsSync(openNextDir)) fs.mkdirSync(openNextDir, { recursive: true })
 * if (!fs.existsSync(openNextAssetsDir)) fs.mkdirSync(openNextAssetsDir, { recursive: true })
 * if (fs.existsSync(workerSrc)) fs.copyFileSync(workerSrc, workerDest)
 */

console.log('[App Mode] Running in standard Next.js web application mode.')

