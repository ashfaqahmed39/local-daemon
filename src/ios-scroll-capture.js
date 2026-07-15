import { ensureAppiumServer } from './appium-service.js'
import { areIosFramesEquivalent, scaleIosScrollRect, stitchIosFrames } from './ios-image-stitcher.js'

const MAX_FRAMES = 30
const SCROLL_SETTLE_MS = 800
const RENDER_SETTLE_MS = 300
const SCROLL_DISTANCE = 0.4
const SCROLLABLE_XPATH = '//*[self::XCUIElementTypeScrollView or self::XCUIElementTypeTable or self::XCUIElementTypeCollectionView or self::XCUIElementTypeWebView]'
const FIXED_CHROME_XPATH = '//*[self::XCUIElementTypeNavigationBar or self::XCUIElementTypeToolbar or self::XCUIElementTypeTabBar or self::XCUIElementTypeStatusBar]'
const ANCHOR_TYPES = new Set(['StaticText', 'Button', 'Image', 'Link'])
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
  if (!sessionId) throw new Error('Appium did not return an iOS session id')
  const sessionPath = `/session/${encodeURIComponent(sessionId)}`
  const execute = (script, args = []) => appiumRequest(server, 'POST', `${sessionPath}/execute/sync`, { script, args })

  return {
    getActiveAppInfo: () => execute('mobile: activeAppInfo'),
    getWindowRect: () => appiumRequest(server, 'GET', `${sessionPath}/window/rect`),
    findScrollableElements: () => appiumRequest(server, 'POST', `${sessionPath}/elements`, { using: 'xpath', value: SCROLLABLE_XPATH }),
    findFixedChromeElements: () => appiumRequest(server, 'POST', `${sessionPath}/elements`, { using: 'xpath', value: FIXED_CHROME_XPATH }),
    getElementRect: (elementId) => appiumRequest(server, 'GET', `${sessionPath}/element/${encodeURIComponent(elementId)}/rect`),
    getSourceTree: () => execute('mobile: source', [{ format: 'json' }]),
    scroll: (elementId, direction) => execute('mobile: scroll', [{ elementId, direction, distance: SCROLL_DISTANCE }]),
    takeScreenshot: () => appiumRequest(server, 'GET', `${sessionPath}/screenshot`),
    deleteSession: () => appiumRequest(server, 'DELETE', sessionPath),
  }
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
    throw new Error(`No visible scrollable iOS content was found (${elements.length} node(s)).${detail}`)
  }
  return candidates[0]
}

const getNodeRect = (node) => {
  const rect = node?.rect || {}
  return {
    x: Number(rect.x ?? rect.origin?.x),
    y: Number(rect.y ?? rect.origin?.y),
    width: Number(rect.width ?? rect.size?.width),
    height: Number(rect.height ?? rect.size?.height),
  }
}

const getAccessibilityAnchors = async (driver, contentRect) => {
  try {
    const source = await driver.getSourceTree()
    const root = typeof source === 'string' ? JSON.parse(source) : source
    const anchors = []
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      const rect = getNodeRect(node)
      const identity = node.rawIdentifier || node.name || node.label || node.value
      const centerX = rect.x + rect.width / 2
      const centerY = rect.y + rect.height / 2
      const isVisible = String(node.isVisible ?? '1') !== '0'
      const isInside = centerX >= contentRect.x
        && centerX <= contentRect.x + contentRect.width
        && centerY >= contentRect.y
        && centerY <= contentRect.y + contentRect.height

      if (identity != null && ANCHOR_TYPES.has(node.type) && isVisible && isInside && rect.width > 0 && rect.height > 0) {
        anchors.push({
          key: [node.type || '', String(identity)].join('\u0000'),
          y: rect.y,
          height: rect.height,
        })
      }
      for (const child of node.children || []) visit(child)
    }
    visit(root)
    return anchors
  } catch {
    return []
  }
}

const captureFrame = async (driver, contentRect) => {
  const anchors = await getAccessibilityAnchors(driver, contentRect)
  await sleep(RENDER_SETTLE_MS)
  const image = Buffer.from(await driver.takeScreenshot(), 'base64')
  return { image, anchors }
}

const getFixedChromeRects = async (driver) => {
  const elements = await driver.findFixedChromeElements()
  const rects = []
  for (const element of elements) {
    const elementId = getElementId(element)
    if (!elementId) continue
    try {
      rects.push(await driver.getElementRect(elementId))
    } catch {}
  }
  return rects
}

const scrollToTop = async (driver, elementId, initialFrame, scrollRect) => {
  let previousFrame = initialFrame
  for (let attempt = 0; attempt < MAX_FRAMES; attempt += 1) {
    await driver.scroll(elementId, 'up')
    await sleep(SCROLL_SETTLE_MS)
    const currentFrame = await captureFrame(driver, scrollRect.sourceRect)
    if (await areIosFramesEquivalent(previousFrame.image, currentFrame.image, scrollRect)) return currentFrame
    previousFrame = currentFrame
  }
  throw new Error(`iOS scroll capture could not reach the top within ${MAX_FRAMES} frames`)
}

const normalizeIosCaptureError = (error) => {
  const message = String(error?.message || error)
  if (/Could not find a driver|automationName.*XCUITest|not installed/i.test(message)) {
    return new Error('Appium XCUITest is not installed. Reinstall the Local Device Helper on macOS.')
  }
  if (/Appium did not become ready|Appium stopped before it became ready/i.test(message)) {
    return new Error('iOS automation could not start. Restart the Local Device Helper and try again. If the problem continues, reinstall the helper to repair its Appium drivers.')
  }
  if (/Unable to start WebDriverAgent|ECONNREFUSED\s+127\.0\.0\.1:8100|xcodebuild.*(?:failed|code\s*70)|Unable to find a destination matching/i.test(message)) {
    return new Error('iOS simulator setup required. In Xcode, open Settings > Components and install a simulator runtime compatible with your Xcode version. Then create and boot a simulator using that runtime, refresh devices, and try again.')
  }
  return error
}

const runIosFullPageCapture = async ({ deviceId, platformVersion }) => {
  if (process.platform !== 'darwin') throw new Error('iOS scroll capture requires macOS')
  if (!deviceId) throw new Error('Select a Booted iOS simulator before capturing a scroll screenshot')
  if (!platformVersion) throw new Error('Could not determine the selected iOS simulator runtime')

  let driver = null
  try {
    const appium = await ensureAppiumServer()
    driver = await createAppiumClient(appium, {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:udid': deviceId,
      'appium:platformVersion': platformVersion,
      'appium:autoLaunch': false,
      'appium:noReset': true,
      'appium:forceAppLaunch': false,
      'appium:shouldTerminateApp': false,
      'appium:useNewWDA': false,
      'appium:newCommandTimeout': 300,
      'appium:wdaLaunchTimeout': 180000,
      'appium:wdaStartupRetries': 1,
      'appium:screenshotQuality': 0,
      'appium:disableAutomaticScreenshots': true,
      'appium:skipLogCapture': true,
      'appium:forceSimulatorSoftwareKeyboardPresence': false,
      'appium:useNativeCachingStrategy': false,
    })

    const activeApp = await driver.getActiveAppInfo()
    if (!activeApp?.bundleId || activeApp.bundleId === 'com.apple.springboard') {
      throw new Error('Open the target app on the selected iOS simulator before capturing a scroll screenshot')
    }

    const scrollable = await findScrollableElement(driver)
    const windowRect = await driver.getWindowRect()
    const fixedChromeRects = await getFixedChromeRects(driver)
    const initialImage = Buffer.from(await driver.takeScreenshot(), 'base64')
    const scrollRect = await scaleIosScrollRect(initialImage, scrollable.rect, windowRect, fixedChromeRects)
    const initialFrame = {
      image: initialImage,
      anchors: await getAccessibilityAnchors(driver, scrollRect.sourceRect),
    }
    const topFrame = await scrollToTop(driver, scrollable.elementId, initialFrame, scrollRect)

    const frames = [topFrame]
    let reachedBottom = false
    while (frames.length < MAX_FRAMES) {
      await driver.scroll(scrollable.elementId, 'down')
      await sleep(SCROLL_SETTLE_MS)
      const currentFrame = await captureFrame(driver, scrollRect.sourceRect)
      if (await areIosFramesEquivalent(frames.at(-1).image, currentFrame.image, scrollRect)) {
        reachedBottom = true
        break
      }
      frames.push(currentFrame)
    }

    if (!reachedBottom && frames.length >= MAX_FRAMES) {
      throw new Error(`iOS scroll capture exceeded the ${MAX_FRAMES}-frame limit`)
    }
    return stitchIosFrames(frames, scrollRect)
  } catch (error) {
    throw normalizeIosCaptureError(error)
  } finally {
    if (driver) await driver.deleteSession().catch(() => {})
  }
}

export const captureIosFullPage = (options) => {
  const capture = captureQueue.then(() => runIosFullPageCapture(options))
  captureQueue = capture.catch(() => {})
  return capture
}
