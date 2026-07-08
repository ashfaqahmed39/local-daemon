import { execFile } from 'node:child_process'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const port = Number(process.env.PIXEL_PERFECT_DAEMON_PORT || 8765)
const host = process.env.PIXEL_PERFECT_DAEMON_HOST || '0.0.0.0'
const installedApps = new Map()

const defaultAllowedOrigins = [
  'https://pixelperfectui.io',
  'https://www.pixelperfectui.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://192.168.12.35',
  'http://192.168.12.35:5173',
]
const allowedOrigins = (process.env.PIXEL_PERFECT_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

const getCorsHeaders = (req) => {
  const origin = req.headers.origin
  const headers = {
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Private-Network': 'true',
    Vary: 'Origin',
  }

  if (!origin) return { ...headers, 'Access-Control-Allow-Origin': '*' }
  if (allowedOrigins.includes(origin)) return { ...headers, 'Access-Control-Allow-Origin': origin }
  return headers
}

const isOriginAllowed = (req) => {
  const origin = req.headers.origin
  return !origin || allowedOrigins.includes(origin)
}

const json = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...res.corsHeaders,
  })
  res.end(JSON.stringify(body))
}

const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})

const parseJson = async (req) => {
  const body = await readBody(req)
  if (!body.length) return {}
  return JSON.parse(body.toString('utf8'))
}

const getRequestPath = (req) => new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

const commandCandidates = (command) => {
  if (command !== 'adb') return [command]
  const home = os.homedir()
  const androidHomes = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.join(home, 'Library', 'Android', 'sdk'),
    path.join(home, 'Android', 'Sdk'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    '/opt/android-sdk',
  ].filter(Boolean)
  const adbName = process.platform === 'win32' ? 'adb.exe' : 'adb'

  return [
    process.env.ADB_PATH,
    command,
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    ...androidHomes.map((sdkPath) => path.join(sdkPath, 'platform-tools', adbName)),
  ].filter(Boolean)
}

const run = async (command, args, options = {}) => {
  let lastError = ''
  for (const candidate of commandCandidates(command)) {
    try {
      const result = await execFileAsync(candidate, args, {
        timeout: options.timeout || 60000,
        encoding: options.encoding || 'utf8',
        maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
      })
      return { ok: true, stdout: result.stdout, stderr: result.stderr, command: candidate }
    } catch (error) {
      lastError = error.stderr || error.stdout || error.message || String(error)
      if (error.code !== 'ENOENT') {
        return { ok: false, stdout: error.stdout || '', stderr: lastError, command: candidate }
      }
    }
  }
  return { ok: false, stdout: '', stderr: `${command} not found. ${lastError}` }
}

const runFirst = async (commands, args, options = {}) => {
  let last = { ok: false, stdout: '', stderr: 'No command attempted' }
  for (const command of commands) {
    last = await run(command, args, options)
    if (last.ok) return last
  }
  return last
}

const toolStatus = async (command, args) => {
  const result = await run(command, args, { timeout: 5000, maxBuffer: 1024 * 1024 })
  return {
    available: result.ok,
    command: result.command || command,
    detail: result.ok ? '' : result.stderr || result.stdout || `${command} not available`,
  }
}

const adbArgs = (deviceId, args) => (deviceId ? ['-s', deviceId, ...args] : args)

const extractZipEntry = async (zipPath, entryName) => {
  const data = await fs.readFile(zipPath)
  let offset = data.length - 22
  while (offset >= 0 && data.readUInt32LE(offset) !== 0x06054b50) offset -= 1
  if (offset < 0) return null

  const centralDirectorySize = data.readUInt32LE(offset + 12)
  const centralDirectoryOffset = data.readUInt32LE(offset + 16)
  let cursor = centralDirectoryOffset
  const end = centralDirectoryOffset + centralDirectorySize

  while (cursor < end && data.readUInt32LE(cursor) === 0x02014b50) {
    const compressionMethod = data.readUInt16LE(cursor + 10)
    const compressedSize = data.readUInt32LE(cursor + 20)
    const fileNameLength = data.readUInt16LE(cursor + 28)
    const extraLength = data.readUInt16LE(cursor + 30)
    const commentLength = data.readUInt16LE(cursor + 32)
    const localHeaderOffset = data.readUInt32LE(cursor + 42)
    const fileName = data.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8')

    if (fileName === entryName) {
      const localNameLength = data.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = data.readUInt16LE(localHeaderOffset + 28)
      const fileStart = localHeaderOffset + 30 + localNameLength + localExtraLength
      const compressed = data.subarray(fileStart, fileStart + compressedSize)
      if (compressionMethod === 0) return compressed
      if (compressionMethod === 8) return zlib.inflateRawSync(compressed)
      return null
    }

    cursor += 46 + fileNameLength + extraLength + commentLength
  }

  return null
}

const extractLikelyPackageFromManifest = async (apkPath) => {
  const manifest = await extractZipEntry(apkPath, 'AndroidManifest.xml').catch(() => null)
  if (!manifest) return ''

  const candidates = new Set()
  const collect = (text) => {
    const matches = text.match(/[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*){1,}/g) || []
    for (const match of matches) {
      if (match.startsWith('android.')) continue
      if (match.startsWith('com.android.')) continue
      if (match.includes('intent.')) continue
      candidates.add(match)
    }
  }

  collect(manifest.toString('utf8'))
  collect(manifest.toString('utf16le').replace(/\u0000/g, ''))

  const sorted = Array.from(candidates).sort((a, b) => {
    const aScore = (a.startsWith('com.') ? 0 : 1) + a.length / 1000
    const bScore = (b.startsWith('com.') ? 0 : 1) + b.length / 1000
    return aScore - bScore
  })

  return sorted[0] || ''
}

const listAndroidPackages = async (deviceId) => {
  const result = await run('adb', adbArgs(deviceId, ['shell', 'pm', 'list', 'packages']))
  if (!result.ok) return []
  return result.stdout
    .split('\n')
    .map((line) => line.trim().replace(/^package:/, ''))
    .filter(Boolean)
}

const listAndroidPackageUpdateTimes = async (deviceId) => {
  const packages = await listAndroidPackages(deviceId)
  const result = await run('adb', adbArgs(deviceId, ['shell', 'dumpsys', 'package', 'packages']), { timeout: 60000, maxBuffer: 50 * 1024 * 1024 })
  if (!result.ok) return new Map(packages.map((pkg) => [pkg, '']))

  const updateTimes = new Map()
  let currentPackage = ''
  for (const line of result.stdout.split('\n')) {
    const packageMatch = line.match(/^\s*Package \[([^\]]+)\]/)
    if (packageMatch) {
      currentPackage = packageMatch[1]
      if (!updateTimes.has(currentPackage)) updateTimes.set(currentPackage, '')
      continue
    }
    const updateMatch = line.match(/^\s*lastUpdateTime=(.+)$/)
    if (currentPackage && updateMatch) updateTimes.set(currentPackage, updateMatch[1].trim())
  }

  for (const pkg of packages) {
    if (!updateTimes.has(pkg)) updateTimes.set(pkg, '')
  }

  return updateTimes
}

const isAndroidPackageInstalled = async (deviceId, packageName) => {
  if (!packageName) return false
  const result = await run('adb', adbArgs(deviceId, ['shell', 'pm', 'path', packageName]), { timeout: 10000 })
  return result.ok && String(result.stdout).trim().startsWith('package:')
}

const listAndroidDevices = async () => {
  const result = await run('adb', ['devices'])
  if (!result.ok) return []
  const devices = result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map(([id]) => ({ id, name: id, platform: 'android', source: 'adb' }))

  return Promise.all(devices.map(async (device) => {
    const size = await run('adb', adbArgs(device.id, ['shell', 'wm', 'size']))
    const match = size.ok ? String(size.stdout).match(/(\d+)x(\d+)/) : null
    return match ? { ...device, width: Number(match[1]), height: Number(match[2]) } : device
  }))
}

const inspectAndroidDevices = async () => {
  const result = await run('adb', ['devices'])
  if (!result.ok) {
    return {
      status: result.stderr?.includes('not found') ? 'adb_not_found' : 'adb_error',
      detail: result.stderr || result.stdout || 'adb devices failed',
      command: result.command || 'adb',
      devices: [],
    }
  }

  const devices = result.stdout
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === 'device')
    .map(([id]) => ({ id, name: id, platform: 'android', source: 'adb' }))

  const enriched = await Promise.all(devices.map(async (device) => {
    const size = await run('adb', adbArgs(device.id, ['shell', 'wm', 'size']))
    const match = size.ok ? String(size.stdout).match(/(\d+)x(\d+)/) : null
    return match ? { ...device, width: Number(match[1]), height: Number(match[2]) } : device
  }))

  return {
    status: enriched.length ? 'devices_found' : 'no_devices',
    detail: enriched.length ? '' : 'No Android devices are visible to adb',
    command: result.command || 'adb',
    devices: enriched,
  }
}

const listIosSimulators = async () => {
  if (process.platform !== 'darwin') return []
  const result = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
  if (!result.ok) return []
  try {
    const data = JSON.parse(result.stdout)
    return Object.values(data.devices || {})
      .flat()
      .filter((device) => device && device.isAvailable)
      .map((device) => ({ id: device.udid, name: device.name, platform: 'ios', state: device.state, source: 'simctl' }))
  } catch {
    return []
  }
}

const inspectIosSimulators = async () => {
  if (process.platform !== 'darwin') {
    return {
      status: 'xcrun_not_available',
      detail: 'iOS simulators are only available on macOS',
      command: 'xcrun',
      devices: [],
    }
  }

  const result = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json'])
  if (!result.ok) {
    return {
      status: result.stderr?.includes('not found') ? 'xcrun_not_available' : 'xcrun_error',
      detail: result.stderr || result.stdout || 'xcrun simctl failed',
      command: result.command || 'xcrun',
      devices: [],
    }
  }

  try {
    const data = JSON.parse(result.stdout)
    const devices = Object.values(data.devices || {})
      .flat()
      .filter((device) => device && device.isAvailable)
      .map((device) => ({ id: device.udid, name: device.name, platform: 'ios', state: device.state, source: 'simctl' }))

    return {
      status: devices.length ? 'devices_found' : 'no_devices',
      detail: devices.length ? '' : 'No iOS simulators are available to xcrun simctl',
      command: result.command || 'xcrun',
      devices,
    }
  } catch (error) {
    return {
      status: 'xcrun_error',
      detail: error.message || 'Failed to parse xcrun simctl output',
      command: result.command || 'xcrun',
      devices: [],
    }
  }
}

const daemonHealth = async () => {
  const [adb, xcrun] = await Promise.all([
    toolStatus('adb', ['version']),
    process.platform === 'darwin'
      ? toolStatus('xcrun', ['--version'])
      : Promise.resolve({ available: false, command: 'xcrun', detail: 'iOS simulators are only available on macOS' }),
  ])

  return {
    success: true,
    service: 'pixel-perfect-local-daemon',
    platform: process.platform,
    tools: { adb, xcrun },
  }
}

const daemonDiagnostics = async () => {
  const adbVersion = await toolStatus('adb', ['version'])
  const adbDevices = await run('adb', ['devices'], { timeout: 10000, maxBuffer: 1024 * 1024 })
  const health = await daemonHealth()

  return {
    ...health,
    adb: {
      available: adbVersion.available,
      command: adbVersion.command,
      detail: adbVersion.detail,
      devicesOutput: adbDevices.stdout || adbDevices.stderr || '',
    },
  }
}

const inferAndroidPackageName = async (apkPath) => {
  const aapt = await runFirst(['aapt'], ['dump', 'badging', apkPath], { timeout: 30000 })
  if (aapt.ok) {
    const match = String(aapt.stdout).match(/package:\s+name='([^']+)'/)
    if (match?.[1]) return match[1]
  }
  const analyzer = await runFirst(['apkanalyzer'], ['manifest', 'application-id', apkPath], { timeout: 30000 })
  if (analyzer.ok && String(analyzer.stdout).trim()) return String(analyzer.stdout).trim().split(/\s+/)[0]
  const manifestPackage = await extractLikelyPackageFromManifest(apkPath)
  if (manifestPackage) return manifestPackage
  return ''
}

const findAppBundle = async (directory) => {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) return entryPath
    if (entry.isDirectory()) {
      const nested = await findAppBundle(entryPath)
      if (nested) return nested
    }
  }
  return ''
}

const inferIosBundleId = async (appPath) => {
  const result = await run('plutil', ['-extract', 'CFBundleIdentifier', 'raw', path.join(appPath, 'Info.plist')], { timeout: 30000 })
  return result.ok ? String(result.stdout).trim() : ''
}

const parseMultipart = async (req) => {
  const contentType = req.headers['content-type'] || ''
  const match = contentType.match(/boundary=(.+)$/)
  if (!match) throw new Error('Missing multipart boundary')
  const boundary = Buffer.from(`--${match[1]}`)
  const body = await readBody(req)
  const parts = []
  let start = body.indexOf(boundary)
  while (start !== -1) {
    const next = body.indexOf(boundary, start + boundary.length)
    if (next === -1) break
    const part = body.subarray(start + boundary.length + 2, next - 2)
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'))
    if (headerEnd !== -1) {
      const headers = part.subarray(0, headerEnd).toString('utf8')
      const data = part.subarray(headerEnd + 4)
      parts.push({ headers, data })
    }
    start = next
  }

  const fields = {}
  let file = null
  for (const part of parts) {
    const name = part.headers.match(/name="([^"]+)"/)?.[1]
    const filename = part.headers.match(/filename="([^"]+)"/)?.[1]
    if (filename) file = { filename, data: part.data }
    else if (name) fields[name] = part.data.toString('utf8')
  }
  return { fields, file }
}

const handleInstall = async (req, res) => {
  const { fields, file } = await parseMultipart(req)
  if (!file) return json(res, 400, { success: false, detail: 'Build file is required' })
  const platform = String(fields.platform || 'android').toLowerCase()
  const deviceId = String(fields.device_id || '').trim()
  const extension = path.extname(file.filename || '').toLowerCase()
  if (platform === 'android' && extension !== '.apk') return json(res, 400, { success: false, detail: 'Android install requires an .apk file' })
  if (platform === 'ios' && !['.zip', '.app'].includes(extension)) return json(res, 400, { success: false, detail: 'iOS simulator install requires a zipped .app bundle' })

  const buildPath = path.join(os.tmpdir(), `pixel-perfect-${Date.now()}${extension}`)
  await fs.writeFile(buildPath, file.data)

  let result
  let appId = ''
  let extractedDir = ''
  try {
    if (platform === 'android') {
      const beforePackages = await listAndroidPackages(deviceId)
      const beforeUpdateTimes = await listAndroidPackageUpdateTimes(deviceId)
      appId = await inferAndroidPackageName(buildPath)
      result = await run('adb', adbArgs(deviceId, ['install', '-r', buildPath]), { timeout: 180000 })
      if (result.ok && appId && !await isAndroidPackageInstalled(deviceId, appId)) appId = ''
      if (result.ok && !appId) {
        const afterPackages = await listAndroidPackages(deviceId)
        const beforeSet = new Set(beforePackages)
        const added = afterPackages.filter((pkg) => !beforeSet.has(pkg))
        if (added.length === 1) appId = added[0]
      }
      if (result.ok && !appId) {
        const afterUpdateTimes = await listAndroidPackageUpdateTimes(deviceId)
        const changed = Array.from(afterUpdateTimes.entries())
          .filter(([pkg, updateTime]) => beforeUpdateTimes.has(pkg) && beforeUpdateTimes.get(pkg) !== updateTime)
          .map(([pkg]) => pkg)
        if (changed.length === 1) appId = changed[0]
      }
    } else {
      let installPath = buildPath
      if (extension === '.zip') {
        extractedDir = path.join(os.tmpdir(), `pixel-perfect-ios-app-${Date.now()}`)
        await fs.mkdir(extractedDir, { recursive: true })
        const unzip = await run('ditto', ['-x', '-k', buildPath, extractedDir], { timeout: 60000 })
        if (!unzip.ok) return json(res, 500, { success: false, detail: unzip.stderr || unzip.stdout || 'Failed to unzip app bundle' })
        installPath = await findAppBundle(extractedDir)
        if (!installPath) return json(res, 400, { success: false, detail: 'No .app bundle found inside zip' })
      }
      appId = await inferIosBundleId(installPath)
      result = await run('xcrun', ['simctl', 'install', deviceId || 'booted', installPath], { timeout: 180000 })
    }
  } finally {
    await fs.rm(buildPath, { force: true }).catch(() => {})
    if (extractedDir) await fs.rm(extractedDir, { recursive: true, force: true }).catch(() => {})
  }

  if (!result.ok) return json(res, 500, { success: false, detail: result.stderr || result.stdout || 'Install failed' })
  if (appId) installedApps.set(`${platform}:${deviceId || 'default'}`, appId)
  return json(res, 200, { success: true, message: 'App installed', app_id: appId, package_name: platform === 'android' ? appId : '', bundle_id: platform === 'ios' ? appId : '' })
}

const handleLaunch = async (req, res) => {
  const body = await parseJson(req)
  const platform = String(body.platform || '').toLowerCase()
  const deviceId = String(body.device_id || '').trim()
  const appId = String(body.app_id || body.package_name || body.bundle_id || installedApps.get(`${platform}:${deviceId || 'default'}`) || '').trim()
  if (!appId) return json(res, 400, { success: false, detail: 'App identifier could not be inferred. Enter package name or bundle id.' })

  if (platform === 'android' && !await isAndroidPackageInstalled(deviceId, appId)) {
    return json(res, 400, { success: false, detail: `Android package is not installed: ${appId}` })
  }

  const result = platform === 'android'
    ? await run('adb', adbArgs(deviceId, ['shell', 'monkey', '-p', appId, '1']))
    : await run('xcrun', ['simctl', 'launch', deviceId || 'booted', appId])
  if (!result.ok) return json(res, 500, { success: false, detail: result.stderr || result.stdout || 'Launch failed' })
  return json(res, 200, { success: true, message: 'App launched', app_id: appId })
}

const handleScreenshot = async (req, res) => {
  const body = await parseJson(req)
  const platform = String(body.platform || '').toLowerCase()
  const deviceId = String(body.device_id || '').trim()

  if (platform === 'android') {
    const result = await run('adb', adbArgs(deviceId, ['exec-out', 'screencap', '-p']), { encoding: 'buffer', maxBuffer: 30 * 1024 * 1024 })
    if (!result.ok || !result.stdout?.length) return json(res, 500, { success: false, detail: result.stderr || 'Screenshot failed' })
    res.writeHead(200, { 'Content-Type': 'image/png', ...res.corsHeaders })
    return res.end(result.stdout)
  }

  const targetPath = path.join(os.tmpdir(), `pixel-perfect-${Date.now()}.png`)
  const result = await run('xcrun', ['simctl', 'io', deviceId || 'booted', 'screenshot', targetPath])
  if (!result.ok) return json(res, 500, { success: false, detail: result.stderr || result.stdout || 'Screenshot failed' })
  const image = await fs.readFile(targetPath)
  await fs.rm(targetPath, { force: true }).catch(() => {})
  res.writeHead(200, { 'Content-Type': 'image/png', ...res.corsHeaders })
  return res.end(image)
}

const server = http.createServer(async (req, res) => {
  const url = getRequestPath(req)
  res.corsHeaders = getCorsHeaders(req)
  if (!isOriginAllowed(req)) return json(res, 403, { success: false, detail: 'Origin is not allowed' })
  if (req.method === 'OPTIONS') return json(res, 204, {})
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, await daemonHealth())
    if (req.method === 'GET' && url.pathname === '/diagnostics') return json(res, 200, await daemonDiagnostics())
    if (req.method === 'GET' && url.pathname === '/devices') {
      const platform = url.searchParams.get('platform')
      if (platform === 'android') {
        const android = await inspectAndroidDevices()
        return json(res, 200, { success: true, devices: android.devices, diagnostics: { android } })
      }
      if (platform === 'ios') {
        const ios = await inspectIosSimulators()
        return json(res, 200, { success: true, devices: ios.devices, diagnostics: { ios } })
      }
      const [android, ios] = await Promise.all([inspectAndroidDevices(), inspectIosSimulators()])
      return json(res, 200, { success: true, devices: [...android.devices, ...ios.devices], diagnostics: { android, ios } })
    }
    if (req.method === 'POST' && url.pathname === '/install') return handleInstall(req, res)
    if (req.method === 'POST' && url.pathname === '/launch') return handleLaunch(req, res)
    if (req.method === 'POST' && url.pathname === '/screenshot') return handleScreenshot(req, res)
    return json(res, 404, { success: false, detail: 'Not found' })
  } catch (error) {
    return json(res, 500, { success: false, detail: error.message || String(error) })
  }
})

server.listen(port, host, () => {
  console.log(`Pixel Perfect local daemon listening on http://${host}:${port}`)
})
