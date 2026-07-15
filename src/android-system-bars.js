export const parseAndroidStatusBarHeight = (windowDump) => {
  const candidates = []
  for (const line of String(windowDump || '').split('\n')) {
    if (!/(?:statusBars|status_bar|ITYPE_STATUS_BAR)/i.test(line)) continue
    if (/(?:mVisible|visible)=false/i.test(line)) continue

    const frame = line.match(/(?:mFrame|frame)=\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/i)
    if (!frame) continue
    const height = Number(frame[4]) - Number(frame[2])
    if (Number.isFinite(height) && height > 0 && height <= 500) candidates.push(height)
  }

  if (candidates.length) return Math.max(...candidates)

  const stableRect = String(windowDump || '').match(/mStableInsets=Rect\(\s*\d+\s*,\s*(\d+)\s*-/i)
  if (stableRect) {
    const height = Number(stableRect[1])
    if (height > 0 && height <= 500) return height
  }

  const stableInsets = String(windowDump || '').match(/stableInsets=Insets\{[^}]*\btop=(\d+)/i)
  if (stableInsets) {
    const height = Number(stableInsets[1])
    if (height > 0 && height <= 500) return height
  }

  return null
}

export const parseAndroidBottomBarHeight = (windowDump) => {
  const candidates = []
  for (const line of String(windowDump || '').split('\n')) {
    if (!/(?:navigationBars|navigation_bar|ITYPE_NAVIGATION_BAR)/i.test(line)) continue
    if (/(?:mVisible|visible)=false/i.test(line)) continue

    const frame = line.match(/(?:mFrame|frame)=\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]\[\s*(-?\d+)\s*,\s*(-?\d+)\s*\]/i)
    if (!frame) continue
    const height = Number(frame[4]) - Number(frame[2])
    if (Number.isFinite(height) && height > 0 && height <= 500) candidates.push(height)
  }

  if (candidates.length) return Math.max(...candidates)

  const stableRect = String(windowDump || '').match(/mStableInsets=Rect\(\s*\d+\s*,\s*\d+\s*-\s*\d+\s*,\s*(\d+)\s*\)/i)
  if (stableRect) {
    const height = Number(stableRect[1])
    if (height > 0 && height <= 500) return height
  }

  const stableInsets = String(windowDump || '').match(/stableInsets=Insets\{[^}]*\bbottom=(\d+)/i)
  if (stableInsets) {
    const height = Number(stableInsets[1])
    if (height > 0 && height <= 500) return height
  }

  return null
}
