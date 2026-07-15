import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const daemonDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appiumBin = process.platform === 'win32'
  ? path.join(daemonDir, 'node_modules', '.bin', 'appium.cmd')
  : path.join(daemonDir, 'node_modules', '.bin', 'appium')
const appiumHome = process.env.PIXEL_PERFECT_APPIUM_HOME || path.join(os.homedir(), '.pixel-perfect-appium')
const env = { ...process.env, APPIUM_HOME: appiumHome }

let installed = {}
try {
  installed = JSON.parse(execFileSync(appiumBin, ['driver', 'list', '--installed', '--json'], { cwd: daemonDir, env, encoding: 'utf8' }))
} catch {
  installed = {}
}

if (installed.uiautomator2?.version === '8.1.0') {
  console.log('Appium UiAutomator2 8.1.0 is already installed.')
} else {
  if (installed.uiautomator2) {
    execFileSync(appiumBin, ['driver', 'uninstall', 'uiautomator2'], { cwd: daemonDir, env, stdio: 'inherit' })
  }
  execFileSync(appiumBin, ['driver', 'install', '--source=npm', 'appium-uiautomator2-driver@8.1.0'], {
    cwd: daemonDir,
    env,
    stdio: 'inherit',
  })
}

if (process.platform !== 'darwin') process.exit(0)

if (installed.xcuitest?.version === '11.17.6') {
  console.log('Appium XCUITest 11.17.6 is already installed.')
  process.exit(0)
}

if (installed.xcuitest) {
  execFileSync(appiumBin, ['driver', 'uninstall', 'xcuitest'], { cwd: daemonDir, env, stdio: 'inherit' })
}

execFileSync(appiumBin, ['driver', 'install', '--source=npm', 'appium-xcuitest-driver@11.17.6'], {
  cwd: daemonDir,
  env,
  stdio: 'inherit',
})
