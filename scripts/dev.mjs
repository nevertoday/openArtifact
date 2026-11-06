// Starts the three Workers for local development. Only the app opens the local D1 and R2 state; the other
// two reach it through service bindings. Each Worker starts after the previous one answers /health, so a
// failure points at one Worker.
import { spawn } from 'node:child_process'

const workers = [
  { name: 'app', healthUrl: 'http://localhost:8787/health' },
  { name: 'usercontent', healthUrl: 'http://localhost:8789/health' },
  { name: 'mcp', healthUrl: 'http://localhost:8788/health' },
]
const STARTUP_TIMEOUT_MS = 60_000
const runningWorkers = []

async function waitUntilHealthy(worker) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(worker.healthUrl)
      if (healthResponse.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`${worker.name} did not answer ${worker.healthUrl} within ${STARTUP_TIMEOUT_MS / 1000}s`)
}

// A runtime left over from an earlier session would answer the health check in place of the new one.
async function assertPortFree(worker) {
  try {
    await fetch(worker.healthUrl)
  } catch {
    return
  }
  throw new Error(`${worker.healthUrl} already answers; stop the earlier dev session first (pkill -f workerd)`)
}

function stopAll() {
  for (const runningWorker of runningWorkers) runningWorker.kill('SIGINT')
}

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)

for (const worker of workers) await assertPortFree(worker)

for (const worker of workers) {
  const workerProcess = spawn('pnpm', ['--dir', `apps/${worker.name}`, 'dev'], { stdio: 'inherit' })
  runningWorkers.push(workerProcess)
  workerProcess.on('exit', code => {
    if (code !== 0 && code !== null) console.error(`${worker.name} exited with code ${code}`)
  })
  try {
    await waitUntilHealthy(worker)
  } catch (error) {
    stopAll()
    throw error
  }
}
console.log('\nOpen Artifact is running: http://localhost:8787')
