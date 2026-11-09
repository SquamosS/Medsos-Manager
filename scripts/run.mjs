// Launches electron-vite. Some hosts (e.g. VS Code terminals) set ELECTRON_RUN_AS_NODE,
// which makes Electron behave like plain Node and breaks the app, so we clear it.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const bin = join(process.cwd(), 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [bin, ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
