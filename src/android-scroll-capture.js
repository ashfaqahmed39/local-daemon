import { ensureAppiumServer } from './appium-service.js'
import { stitchAndroidFrames } from './image-stitcher.js'

const MAX_FRAMES = 20
let captureQueue = Promise.resolve()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const appiumRequest = async (server, method, requestPath, body) => {
  const response = await fetch(`${server.url}${requestPath}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.value?.error) {
    throw new Error(payload.value?.message || payload.message || `Appium request failed with HTTP ${response.status}`)
  }
  return payload.value
}

const createAppiumClient = async (server, capabilities) => {
  const session = await appiumRequest(server, 'POST', '/session', {
    capabilities: { alwaysMatch: capabilities, firstMatch: [{}] },
  })
  const sessionId = session?.sessionId
  if (!sessionId) throw new Error('Appium did not return a session id')
  const sessionPath = `/session/${encodeURIComponent(sessionId)}`
  return {
    getCurrentPackage: () => appiumRequest(server, 'GET', `${sessionPath}/appium/device/current_package`),
    findScrollableElements: () => appiumRequest(server, 'POST', `${sessionPath}/elements`, { using: 'xpath', value: '//*[@scrollable="true"]' }),
    getElementRect: (elementId) => appiumRequest(server, 'GET', `${sessionPath}/element/${encodeURIComponent(elementId)}/rect`),
    scrollGesture: (options) => appiumRequest(server, 'POST', `${sessionPath}/execute/sync`, { script: 'mobile: scrollGesture', args: [options] }),
    takeScreenshot: () => appiumRequest(server, 'GET', `${sessionPath}/screenshot`),
    deleteSession: () => appiumRequest(server, 'DELETE', sessionPath),
  }
}

const getForegroundApp = async (deviceId, run, adbArgs) => {
  const result = await run('adb', adbArgs(deviceId, ['shell', 'dumpsys', 'window']), { timeout: 10000, maxBuffer: 4 * 1024 * 1024 })
  const output = String(result.stdout || '')
  const match = output.match(/mCurrentFocus=.*?\s([A-Za-z0-9._]+)\/([^\s}]+)/)
  if (!result.ok || !match) throw new Error('Could not determine the foreground Android application')
  return { packageName: match[1], activityName: match[2], windowDump: output }
}

const excludeSystemBars = (rect, windowDump) => {
  const navigation = windowDump.match(/type=navigationBars frame=\[(\d+),(\d+)\]\[(\d+),(\d+)\] visible=true/)
  if (!navigation) return rect
  const navigationTop = Number(navigation[2])
  const rectBottom = rect.y + rect.height
  if (!Number.isFinite(navigationTop) || navigationTop <= rect.y || rectBottom <= navigationTop) return rect
  return { ...rect, height: navigationTop - rect.y }
}

const getElementId = (element) => element.elementId || element['element-6066-11e4-a52e-4f735466cecf']

const findScrollableElement = async (driver) => {
  const elements = await driver.findScrollableElements()
  const candidates = []
  const failures = []
  for (const element of elements) {
    try {
      const elementId = getElementId(element)
      if (!elementId) continue
      const rect = await driver.getElementRect(elementId)
      if (rect.width < 100 || rect.height < 200) continue
      candidates.push({ elementId, rect, area: rect.width * rect.height })
    } catch (error) {
      failures.push(String(error?.message || error))
    }
  }
  candidates.sort((a, b) => b.area - a.area)
  if (!candidates.length) {
    const detail = failures[0] ? ` ${failures[0]}` : ''
    throw new Error(`No visible scrollable Android content was found (${elements.length} node(s)).${detail}`)
  }
  return candidates[0]
}

const scrollGesture = async (driver, element, direction) => {
  const elementId = typeof element === 'string' ? element : getElementId(element)
  if (!elementId) throw new Error('Could not identify the Android scrollable element')
  return Boolean(await driver.scrollGesture({
    elementId,
    direction,
    percent: direction === 'up' ? 0.9 : 0.72,
    speed: direction === 'up' ? 1500 : 1200,
  }))
}

const scrollToTop = async (driver, element) => {
  for (let attempt = 0; attempt < MAX_FRAMES; attempt += 1) {
    const canContinue = await scrollGesture(driver, element, 'up')
    await sleep(300)
    if (!canContinue) return
  }
  throw new Error('Could not reach the top of the Android scrollable content')
}

const captureFrame = async (driver) => Buffer.from(await driver.takeScreenshot(), 'base64')

const runAndroidFullPageCapture = async ({ deviceId, run, adbArgs }) => {
  const foreground = await getForegroundApp(deviceId, run, adbArgs)
  const appium = await ensureAppiumServer()
  let driver = null
  try {
    driver = await createAppiumClient(appium, {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:udid': deviceId,
        'appium:appPackage': foreground.packageName,
        'appium:appActivity': foreground.activityName,
        'appium:noReset': true,
        'appium:dontStopAppOnReset': true,
        'appium:forceAppLaunch': false,
        'appium:autoLaunch': false,
        'appium:newCommandTimeout': 180,
    })
    const activePackage = await driver.getCurrentPackage()
    if (activePackage !== foreground.packageName) throw new Error(`Foreground app changed from ${foreground.packageName} to ${activePackage}`)
    const scrollable = await findScrollableElement(driver)
    await scrollToTop(driver, scrollable.elementId)
    await sleep(400)

    const frames = [await captureFrame(driver)]
    let reachedBottom = false
    while (frames.length < MAX_FRAMES) {
      const canContinue = await scrollGesture(driver, scrollable.elementId, 'down')
      await sleep(450)
      frames.push(await captureFrame(driver))
      if (!canContinue) {
        reachedBottom = true
        break
      }
    }
    if (!reachedBottom && frames.length >= MAX_FRAMES) throw new Error(`Android scroll capture exceeded the ${MAX_FRAMES}-frame limit`)
    return stitchAndroidFrames(frames, excludeSystemBars(scrollable.rect, foreground.windowDump))
  } catch (error) {
    const message = String(error?.message || error)
    if (/Could not find a driver|automationName.*UiAutomator2|not installed/i.test(message)) {
      throw new Error('Appium UiAutomator2 is not installed. Reinstall the Local Device Helper.')
    }
    throw error
  } finally {
    if (driver) await driver.deleteSession().catch(() => {})
  }
}

export const captureAndroidFullPage = (options) => {
  const capture = captureQueue.then(() => runAndroidFullPageCapture(options))
  captureQueue = capture.catch(() => {})
  return capture
}
