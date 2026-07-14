import sharp from 'sharp'

const MAX_OUTPUT_HEIGHT = 30000
const MATCH_WIDTH = 160
const MIN_OVERLAP_RATIO = 0.12
const MAX_OVERLAP_RATIO = 0.96
const MAX_MATCH_SCORE = 24

const clampRect = (rect, width, height) => {
  const left = Math.max(0, Math.min(width - 1, Math.round(rect.x)))
  const top = Math.max(0, Math.min(height - 1, Math.round(rect.y)))
  const right = Math.max(left + 1, Math.min(width, Math.round(rect.x + rect.width)))
  const bottom = Math.max(top + 1, Math.min(height, Math.round(rect.y + rect.height)))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

const getViewportAnalysis = async (input, rect) => {
  const analysisWidth = Math.min(MATCH_WIDTH, rect.width)
  const { data, info } = await sharp(input)
    .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    .removeAlpha()
    .greyscale()
    .resize({ width: analysisWidth })
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

const overlapScore = (previous, next, overlap) => {
  const previousStart = (previous.height - overlap) * previous.width
  let difference = 0
  let samples = 0
  for (let y = 0; y < overlap; y += 2) {
    const previousRow = previousStart + y * previous.width
    const nextRow = y * next.width
    for (let x = 0; x < previous.width; x += 2) {
      difference += Math.abs(previous.data[previousRow + x] - next.data[nextRow + x])
      samples += 1
    }
  }
  return samples ? difference / samples : Number.POSITIVE_INFINITY
}

const findOverlap = (previous, next, viewportHeight) => {
  const minOverlap = Math.max(8, Math.floor(previous.height * MIN_OVERLAP_RATIO))
  const maxOverlap = Math.min(previous.height - 4, Math.floor(previous.height * MAX_OVERLAP_RATIO))
  let bestOverlap = 0
  let bestScore = Number.POSITIVE_INFINITY
  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += 1) {
    const score = overlapScore(previous, next, overlap)
    if (score < bestScore) {
      bestScore = score
      bestOverlap = overlap
    }
  }
  if (!bestOverlap || bestScore > MAX_MATCH_SCORE) {
    throw new Error(`Could not determine screenshot overlap reliably (score ${bestScore.toFixed(1)})`)
  }
  return { overlap: Math.round(bestOverlap * (viewportHeight / previous.height)), score: bestScore }
}

export const stitchAndroidFrames = async (frames, scrollRect) => {
  if (!frames.length) throw new Error('No Android screenshots were captured')
  if (frames.length === 1) return frames[0]
  const firstMetadata = await sharp(frames[0]).metadata()
  const width = firstMetadata.width || 0
  const height = firstMetadata.height || 0
  if (!width || !height) throw new Error('Could not read Android screenshot dimensions')

  const rect = clampRect(scrollRect, width, height)
  const analyses = []
  for (const frame of frames) analyses.push(await getViewportAnalysis(frame, rect))

  const parts = [{ input: frames[0], top: 0, height: rect.bottom }]
  for (let index = 1; index < frames.length; index += 1) {
    const match = findOverlap(analyses[index - 1], analyses[index], rect.height)
    const newHeight = rect.height - match.overlap
    if (newHeight < Math.max(20, rect.height * 0.04)) continue
    parts.push({ input: frames[index], top: rect.top + match.overlap, height: newHeight })
  }

  const bottomHeight = height - rect.bottom
  if (bottomHeight > 0) parts.push({ input: frames.at(-1), top: rect.bottom, height: bottomHeight })
  const outputHeight = parts.reduce((total, part) => total + part.height, 0)
  if (outputHeight > MAX_OUTPUT_HEIGHT) throw new Error(`Full-page screenshot exceeds the ${MAX_OUTPUT_HEIGHT}px height limit`)

  const prepared = []
  for (const part of parts) {
    prepared.push(await sharp(part.input).extract({ left: 0, top: part.top, width, height: part.height }).png().toBuffer())
  }
  let top = 0
  const composite = prepared.map((input, index) => {
    const placement = { input, left: 0, top }
    top += parts[index].height
    return placement
  })
  return sharp({ create: { width, height: outputHeight, channels: 4, background: '#ffffff' } }).composite(composite).png().toBuffer()
}
