// Packages the built app (out/) into a Windows installer in dist/.
// ELECTRON_RUN_AS_NODE can be set by editors like VS Code and breaks Electron tooling, so drop it.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const bin = join(root, 'node_modules', 'electron-builder', 'cli.js')
const result = spawnSync(process.execPath, [bin, '--win', 'nsis', '--x64'], { cwd: root, env, stdio: 'inherit' })
process.exit(result.status ?? 1)
