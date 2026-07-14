import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const daemonDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appiumEntry = path.join(daemonDir, 'node_modules', 'appium', 'index.js')
const appiumHome = process.env.PIXEL_PERFECT_APPIUM_HOME || path.join(os.homedir(), '.pixel-perfect-appium')

const getAndroidSdkRoot = () => {
  if (process.env.ANDROID_HOME) return process.env.ANDROID_HOME
  if (process.env.ANDROID_SDK_ROOT) return process.env.ANDROID_SDK_ROOT
  const standardRoots = [
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    path.join(os.homedir(), 'Android', 'Sdk'),
  ]
  const standardRoot = standardRoots.find((root) => fs.existsSync(path.join(root, 'platform-tools')))
  if (standardRoot) return standardRoot
  if (process.env.ADB_PATH) return path.dirname(path.dirname(fs.realpathSync(process.env.ADB_PATH)))
  return standardRoots[0]
}

let appiumProcess = null
let appiumServer = null
let startupPromise = null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer()
  server.unref()
  server.on('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    server.close(() => resolve(port))
  })
})

const waitForAppium = async (url, processRef) => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (processRef.exitCode !== null) throw new Error('Appium stopped before it became ready')
    try {
      const response = await fetch(`${url}/status`)
      if (response.ok) return
    } catch {
      // Appium is still starting.
    }
    await sleep(250)
  }
  throw new Error('Appium did not become ready within 20 seconds')
}

export const ensureAppiumServer = async () => {
  if (appiumServer && appiumProcess?.exitCode === null) return appiumServer
  if (startupPromise) return startupPromise

  startupPromise = (async () => {
    const port = await getFreePort()
    const processRef = spawn(process.execPath, [appiumEntry, '--address', '127.0.0.1', '--port', String(port), '--log-level', 'warn'], {
      cwd: daemonDir,
      env: {
        ...process.env,
        APPIUM_HOME: appiumHome,
        ANDROID_HOME: getAndroidSdkRoot(),
        ANDROID_SDK_ROOT: getAndroidSdkRoot(),
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    })

    appiumProcess = processRef
    const url = `http://127.0.0.1:${port}`
    try {
      await waitForAppium(url, processRef)
      appiumServer = { hostname: '127.0.0.1', port, path: '/', url }
      return appiumServer
    } catch (error) {
      processRef.kill('SIGTERM')
      appiumProcess = null
      appiumServer = null
      throw error
    }
  })().finally(() => {
    startupPromise = null
  })

  return startupPromise
}

export const stopAppiumServer = () => {
  if (appiumProcess?.exitCode === null) appiumProcess.kill('SIGTERM')
  appiumProcess = null
  appiumServer = null
}
