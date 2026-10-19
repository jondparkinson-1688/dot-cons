import { SAMPLE_RESOLUTION } from './rasterize'
import type { DotMatrixSettings } from './types'

/**
 * A source pixel needs at least this much of its own alpha before it counts as "ink" for the
 * purpose of finding distinct shapes. Matches the standard antialiasing midpoint — pixels below
 * this are edge fuzz, not part of a shape's body.
 */
const COMPONENT_INK_THRESHOLD = 0.5

/**
 * A labeled region smaller than this many source pixels is treated as stray antialiasing debris
 * rather than a real, deliberate shape (e.g. a one-pixel fragment where two curves nearly touch).
 * Real icon details — even a small one like a dot — span hundreds of source pixels at
 * SAMPLE_RESOLUTION; this is set far below that so it only catches genuine noise.
 */
const MIN_COMPONENT_PIXELS = 9

/** 8-connected flood fill over the fine-resolution alpha mask. -1 means "not ink". */
function labelComponents(coverage: Float32Array, resolution: number): { labels: Int32Array; count: number } {
  const labels = new Int32Array(coverage.length).fill(-1)
  let nextLabel = 0
  const stack: number[] = []

  for (let start = 0; start < coverage.length; start++) {
    if (labels[start] !== -1 || coverage[start] <= COMPONENT_INK_THRESHOLD) continue

    const label = nextLabel++
    labels[start] = label
    stack.push(start)

    while (stack.length > 0) {
      const idx = stack.pop()!
      const x = idx % resolution
      const y = (idx / resolution) | 0

      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= resolution) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= resolution) continue

          const nIdx = ny * resolution + nx
          if (labels[nIdx] === -1 && coverage[nIdx] > COMPONENT_INK_THRESHOLD) {
            labels[nIdx] = label
            stack.push(nIdx)
          }
        }
      }
    }
  }

  return { labels, count: nextLabel }
}

/**
 * Downsamples full-resolution pixel coverage into one coverage value per grid cell, normalizing
 * each distinct shape in the icon against its *own* densest cell rather than one shared peak.
 *
 * A single global peak punishes small shapes: a coarse grid dilutes every cell's average down
 * (a cell that's genuinely "solid icon" might only average 40-60% once blended across an 80px
 * block), so a fixed downstream threshold needs coverage to mean "how solid relative to this
 * icon's most solid point" — but a small isolated detail (e.g. the dot under an exclamation
 * mark) never reaches the same peak as a bold outline even in a perfect sampling, simply because
 * it covers less area. Normalized against the *whole icon's* peak, it reads as permanently faint
 * and gets thresholded away regardless of grid size. Normalized against its own peak instead, it
 * reaches full strength on its own terms. Shapes that are already part of one connected band
 * (e.g. a wall merging into a door frame) keep sharing a peak, since they're one component —
 * this only helps shapes that are genuinely separate.
 */
export function computeGridCoverage(coverage: Float32Array, gridSize: number): Float32Array {
  const block = SAMPLE_RESOLUTION / gridSize
  const cellCount = gridSize * gridSize

  const { labels, count: componentCount } = labelComponents(coverage, SAMPLE_RESOLUTION)

  const cellTotalPixels = new Int32Array(cellCount)
  const componentCellSum: Float32Array[] = Array.from({ length: componentCount }, () => new Float32Array(cellCount))
  const componentPixelCount = new Int32Array(componentCount)

  for (let y = 0; y < SAMPLE_RESOLUTION; y++) {
    const row = Math.min(gridSize - 1, Math.floor(y / block))
    const rowBase = y * SAMPLE_RESOLUTION

    for (let x = 0; x < SAMPLE_RESOLUTION; x++) {
      const col = Math.min(gridSize - 1, Math.floor(x / block))
      const cellIdx = row * gridSize + col
      cellTotalPixels[cellIdx]++

      const label = labels[rowBase + x]
      if (label !== -1) {
        componentCellSum[label][cellIdx] += coverage[rowBase + x]
        componentPixelCount[label]++
      }
    }
  }

  // Each component's peak is the largest fraction-of-a-cell it fills anywhere. Components too
  // small to trust get no peak of their own — they fall back to the shared global peak below.
  const componentPeak = new Float32Array(componentCount)
  let globalPeak = 0
  for (let label = 0; label < componentCount; label++) {
    if (componentPixelCount[label] < MIN_COMPONENT_PIXELS) continue
    let peak = 0
    for (let cell = 0; cell < cellCount; cell++) {
      const total = cellTotalPixels[cell]
      if (total === 0) continue
      const frac = componentCellSum[label][cell] / total
      if (frac > peak) peak = frac
    }
    componentPeak[label] = peak
    if (peak > globalPeak) globalPeak = peak
  }

  const bestLabel = new Int32Array(cellCount).fill(-1)
  const bestNormalized = new Float32Array(cellCount)

  for (let cell = 0; cell < cellCount; cell++) {
    const total = cellTotalPixels[cell]
    if (total === 0) continue

    let best = 0
    let winner = -1
    for (let label = 0; label < componentCount; label++) {
      const frac = componentCellSum[label][cell] / total
      if (frac <= 0) continue
      const peak = componentPeak[label] > 0 ? componentPeak[label] : globalPeak
      if (peak <= 0) continue
      const normalized = frac / peak
      if (normalized > best) {
        best = normalized
        winner = label
      }
    }
    bestNormalized[cell] = Math.min(1, best)
    bestLabel[cell] = winner
  }

  // A cell touching a *different* component's territory is where two distinct shapes meet —
  // exactly where a real gap between them (e.g. the break in an exclamation mark between its
  // bar and dot) can land mostly, but not entirely, inside one grid cell. Cubing pulls a
  // confident cell (~1.0) down barely at all, but pulls a merely-partial one (e.g. a stroke's
  // fading tail, ~0.6-0.7) below the visibility threshold — preserving the gap instead of
  // bridging it. Cells deep inside a single component's own territory (no foreign neighbor) are
  // left alone, since that's the graze-tolerant behavior thin diagonal strokes depend on.
  const grid = new Float32Array(cellCount)
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const cell = row * gridSize + col
      const label = bestLabel[cell]
      if (label === -1) continue

      let touchesOtherComponent = false
      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= gridSize || c < 0 || c >= gridSize) continue
        const neighborLabel = bestLabel[r * gridSize + c]
        if (neighborLabel !== -1 && neighborLabel !== label && bestNormalized[r * gridSize + c] > 0.3) {
          touchesOtherComponent = true
          break
        }
      }

      grid[cell] = touchesOtherComponent ? bestNormalized[cell] ** 3 : bestNormalized[cell]
    }
  }

  return grid
}

/**
 * Minimum per-cell coverage before a dot appears at all. This has to balance two failure modes
 * that pull in opposite directions:
 *  - Too low, and at a coarse grid, incidental coverage from a nearby-but-separate detail (e.g.
 *    a door cutout a few cells from the wall it sits inside) is enough to light up, and fine
 *    interior detail can bleed together into what reads as a solid filled blob instead of the
 *    icon's actual (hollow) silhouette.
 *  - Too high, and a thin stroke that only grazes a cell (common on diagonals, where a cell's
 *    average coverage is diluted by the area the stroke *doesn't* cross) rounds down to nothing,
 *    fragmenting what should be a continuous edge.
 * 0.45 was picked empirically against both: an outlined icon with interior detail (a house, with
 * a door cutout near the walls) rendering as a clean hollow outline rather than a filled blob,
 * and a diagonal-heavy icon (an X) staying fully connected rather than gapping out. Any single
 * fixed threshold is a compromise — very coarse grids (under ~10 cells) can still drop or fuse
 * detail no threshold alone can rescue, since there's just not enough cells to represent it.
 */
const MIN_VISIBLE_COVERAGE = 0.45

function getCell(mask: Uint8Array, gridSize: number, row: number, col: number): number {
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) return 0
  return mask[row * gridSize + col]
}

/**
 * Zhang-Suen thinning: erodes a filled/stroked mask down to a 1-cell-wide skeleton while
 * preserving topology (every piece stays connected to what it was connected to, and no new
 * gaps or loops appear). This is what makes line-width limiting safe on diagonals and curves —
 * a naive per-row/per-column thickness heuristic treats each small anti-aliasing cluster along
 * a diagonal independently, and can keep the "top" cell of one cluster and the "bottom" cell of
 * the next, breaking an otherwise-solid edge into disconnected dots.
 */
function skeletonize(on: Uint8Array, gridSize: number): Uint8Array {
  const mask = Uint8Array.from(on)
  let changed = true

  while (changed) {
    changed = false

    for (const subIteration of [1, 2] as const) {
      const toRemove: number[] = []

      for (let row = 0; row < gridSize; row++) {
        for (let col = 0; col < gridSize; col++) {
          const idx = row * gridSize + col
          if (!mask[idx]) continue

          // P2..P9, clockwise from north.
          const p2 = getCell(mask, gridSize, row - 1, col)
          const p3 = getCell(mask, gridSize, row - 1, col + 1)
          const p4 = getCell(mask, gridSize, row, col + 1)
          const p5 = getCell(mask, gridSize, row + 1, col + 1)
          const p6 = getCell(mask, gridSize, row + 1, col)
          const p7 = getCell(mask, gridSize, row + 1, col - 1)
          const p8 = getCell(mask, gridSize, row, col - 1)
          const p9 = getCell(mask, gridSize, row - 1, col - 1)
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9]

          const neighborCount = ring.reduce((sum, v) => sum + v, 0)
          if (neighborCount < 2 || neighborCount > 6) continue

          let transitions = 0
          for (let i = 0; i < ring.length; i++) {
            if (ring[i] === 0 && ring[(i + 1) % ring.length] === 1) transitions++
          }
          if (transitions !== 1) continue

          if (subIteration === 1) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }

          toRemove.push(idx)
        }
      }

      if (toRemove.length > 0) {
        changed = true
        for (const idx of toRemove) mask[idx] = 0
      }
    }
  }

  return mask
}

/**
 * Re-thickens a skeleton to `width` cells by stamping a `width`×`width` square centered on
 * each skeleton cell (one extra cell toward +row/+col for even widths, since a symmetric even
 * stamp can't exist on an integer grid). Stamping along the whole skeleton — rather than scaling
 * each cell independently — is what keeps diagonal and curved strokes an even, continuous band.
 */
function thickenSkeleton(skeleton: Uint8Array, gridSize: number, width: number): Uint8Array {
  const result = new Uint8Array(skeleton.length)
  const before = Math.floor((width - 1) / 2)
  const after = Math.ceil((width - 1) / 2)

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (!skeleton[row * gridSize + col]) continue

      for (let dr = -before; dr <= after; dr++) {
        const r = row + dr
        if (r < 0 || r >= gridSize) continue
        for (let dc = -before; dc <= after; dc++) {
          const c = col + dc
          if (c < 0 || c >= gridSize) continue
          result[r * gridSize + c] = 1
        }
      }
    }
  }

  return result
}

/**
 * Normalizes every stroke to a uniform `maxWidth` dots thick, regardless of how the coarse
 * grid happened to sample the original icon (which otherwise renders some edges 1 dot thick
 * and others 3-4, depending on luck of alignment). Filled regions with no single "width" axis
 * (e.g. a filled icon rather than an outline) get carved down to their skeleton too — an
 * accepted tradeoff for a control aimed at keeping outlined strokes a consistent dot or two wide.
 */
export function limitLineWidth(gridCoverage: Float32Array, gridSize: number, maxWidth: number): Float32Array {
  const on = new Uint8Array(gridCoverage.length)
  for (let i = 0; i < gridCoverage.length; i++) on[i] = gridCoverage[i] > MIN_VISIBLE_COVERAGE ? 1 : 0

  const skeleton = skeletonize(on, gridSize)
  const thickened = thickenSkeleton(skeleton, gridSize, maxWidth)

  const result = new Float32Array(gridCoverage.length)
  for (let i = 0; i < gridCoverage.length; i++) {
    result[i] = thickened[i] ? gridCoverage[i] : 0
  }
  return result
}

/**
 * Quantizes a 0..1 coverage value into one of `shades` opacity levels, plus an implicit
 * "no dot" level for near-zero coverage. The lowest shade starts just above
 * MIN_VISIBLE_COVERAGE rather than at an even 1/(shades+1) split, so grazing/thin strokes
 * still round up to a dot instead of disappearing; remaining shades split the rest of the
 * range evenly for cells with real density.
 */
export function quantizeCoverage(value: number, shades: number): number {
  if (value <= MIN_VISIBLE_COVERAGE) return 0
  const normalized = (value - MIN_VISIBLE_COVERAGE) / (1 - MIN_VISIBLE_COVERAGE)
  const level = Math.min(shades, Math.ceil(normalized * shades))
  return level / shades
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const r = parseInt(normalized.substring(0, 2), 16)
  const g = parseInt(normalized.substring(2, 4), 16)
  const b = parseInt(normalized.substring(4, 6), 16)
  return [r, g, b]
}

/** Keeps color emoji rendering (not just the fill color) consistent across platforms. */
const TEXT_DOT_FONT_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", system-ui, sans-serif'

/** A glyph rarely fills its own em-square, so render it somewhat larger than the cell. */
const TEXT_DOT_SIZE_SCALE = 1.25

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

interface Point {
  x: number
  y: number
}

function regularPolygonVertices(sides: number, radius: number): Point[] {
  const vertices: Point[] = []
  for (let i = 0; i < sides; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    vertices.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
  }
  return vertices
}

function starVertices(points: number, outerRadius: number, innerRadius: number): Point[] {
  const vertices: Point[] = []
  for (let i = 0; i < points * 2; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / points
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    vertices.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
  }
  return vertices
}

/** A 12-vertex cross outline. armRatio is the arm's thickness as a fraction of the full size. */
function plusVertices(size: number, armRatio: number): Point[] {
  const half = size / 2
  const armHalf = half * armRatio
  return [
    { x: -armHalf, y: -half },
    { x: armHalf, y: -half },
    { x: armHalf, y: -armHalf },
    { x: half, y: -armHalf },
    { x: half, y: armHalf },
    { x: armHalf, y: armHalf },
    { x: armHalf, y: half },
    { x: -armHalf, y: half },
    { x: -armHalf, y: armHalf },
    { x: -half, y: armHalf },
    { x: -half, y: -armHalf },
    { x: -armHalf, y: -armHalf },
  ]
}

function diamondVertices(size: number): Point[] {
  const half = size / 2
  return [
    { x: 0, y: -half },
    { x: half, y: 0 },
    { x: 0, y: half },
    { x: -half, y: 0 },
  ]
}

/**
 * Builds an SVG path "d" string for a polygon with its corners rounded, by cutting each corner
 * back along both adjacent edges and bridging the cut with a quadratic curve through the original
 * (sharp) vertex as the control point — the standard "corner-cut" technique for rounding an
 * arbitrary polygon. The same string works unmodified as a canvas Path2D, which is why every
 * non-trivial shape (diamond, polygon, star, plus) is expressed this way: one definition drives
 * both the canvas (export) and SVG (preview + download) renderers.
 */
function roundedPolygonPath(vertices: Point[], cornerRadius: number): string {
  const n = vertices.length
  if (cornerRadius <= 0 || n < 3) {
    return `M${vertices.map((v) => `${v.x.toFixed(2)},${v.y.toFixed(2)}`).join('L')}Z`
  }

  const commands: string[] = []
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i - 1 + n) % n]
    const curr = vertices[i]
    const next = vertices[(i + 1) % n]

    const toPrevLen = Math.hypot(prev.x - curr.x, prev.y - curr.y)
    const toNextLen = Math.hypot(next.x - curr.x, next.y - curr.y)
    const radius = Math.min(cornerRadius, toPrevLen / 2, toNextLen / 2)

    const p1 = {
      x: curr.x + ((prev.x - curr.x) / toPrevLen) * radius,
      y: curr.y + ((prev.y - curr.y) / toPrevLen) * radius,
    }
    const p2 = {
      x: curr.x + ((next.x - curr.x) / toNextLen) * radius,
      y: curr.y + ((next.y - curr.y) / toNextLen) * radius,
    }

    commands.push(i === 0 ? `M${p1.x.toFixed(2)},${p1.y.toFixed(2)}` : `L${p1.x.toFixed(2)},${p1.y.toFixed(2)}`)
    commands.push(`Q${curr.x.toFixed(2)},${curr.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`)
  }
  commands.push('Z')
  return commands.join(' ')
}

/**
 * The maximum corner radius polygon/star/plus shapes accept, as a fraction of dot size. Capped
 * well below a rect's natural dotSize/2 ceiling since corner-cutting on a shape with few sides
 * (a diamond, a star's narrow points) self-intersects much sooner than it does on a square.
 */
const POLYGON_CORNER_SCALE = 0.3

/** Path "d" string for shapes built via roundedPolygonPath — everything except square/circle. */
function polygonShapePathD(settings: DotMatrixSettings, dotSize: number): string {
  const cornerRadius = settings.dotRoundness * dotSize * POLYGON_CORNER_SCALE
  const half = dotSize / 2

  switch (settings.dotShape) {
    case 'diamond':
      return roundedPolygonPath(diamondVertices(dotSize), cornerRadius)
    case 'polygon':
      return roundedPolygonPath(regularPolygonVertices(settings.polygonSides, half), cornerRadius)
    case 'star':
      return roundedPolygonPath(starVertices(settings.starPoints, half, half * 0.45), cornerRadius)
    case 'plus':
      return roundedPolygonPath(plusVertices(dotSize, 0.38), cornerRadius)
    default:
      return roundedPolygonPath(diamondVertices(dotSize), cornerRadius)
  }
}

interface DotGeometry {
  cellSize: number
  dotSize: number
  cornerRadius: number
}

function dotGeometryFor(settings: DotMatrixSettings, canvasSize: number): DotGeometry {
  const cellSize = canvasSize / settings.gridSize
  const dotSize = Math.max(cellSize - settings.dotSpacingPx, 0)
  const cornerRadius = (settings.dotRoundness * dotSize) / 2
  return { cellSize, dotSize, cornerRadius }
}

export function renderDotMatrixToCanvas(
  canvas: HTMLCanvasElement,
  gridCoverage: Float32Array,
  settings: DotMatrixSettings,
  canvasSize: number,
): void {
  canvas.width = canvasSize
  canvas.height = canvasSize

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvasSize, canvasSize)

  const { gridSize, smoothnessShades, primaryColor, dotShape, scaleX, scaleY, rotationDeg, skewDeg } = settings
  const { cellSize, dotSize, cornerRadius } = dotGeometryFor(settings, canvasSize)
  const [r, g, b] = hexToRgb(primaryColor)
  const isPathShape = dotShape !== 'square' && dotShape !== 'circle' && dotShape !== 'text'
  const path = isPathShape ? new Path2D(polygonShapePathD(settings, dotSize)) : null
  const text = settings.dotText.trim()

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (dotShape === 'text' && !text) continue

      const opacity = quantizeCoverage(gridCoverage[row * gridSize + col], smoothnessShades)
      if (opacity === 0) continue

      const cx = col * cellSize + cellSize / 2
      const cy = row * cellSize + cellSize / 2

      ctx.save()
      ctx.translate(cx, cy)
      if (rotationDeg) ctx.rotate((rotationDeg * Math.PI) / 180)
      if (skewDeg) ctx.transform(1, 0, Math.tan((skewDeg * Math.PI) / 180), 1, 0, 0)
      ctx.scale(scaleX, scaleY)

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`
      if (dotShape === 'circle') {
        ctx.beginPath()
        ctx.arc(0, 0, dotSize / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (dotShape === 'square') {
        ctx.beginPath()
        ctx.roundRect(-dotSize / 2, -dotSize / 2, dotSize, dotSize, cornerRadius)
        ctx.fill()
      } else if (dotShape === 'text') {
        ctx.font = `${dotSize * TEXT_DOT_SIZE_SCALE}px ${TEXT_DOT_FONT_STACK}`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, 0, 0)
      } else {
        ctx.fill(path!)
      }
      ctx.restore()
    }
  }
}

export function buildDotMatrixSvg(
  gridCoverage: Float32Array,
  settings: DotMatrixSettings,
  canvasSize: number,
): string {
  const { gridSize, smoothnessShades, primaryColor, dotShape, scaleX, scaleY, rotationDeg, skewDeg } = settings
  const { cellSize, dotSize, cornerRadius } = dotGeometryFor(settings, canvasSize)
  const isPathShape = dotShape !== 'square' && dotShape !== 'circle' && dotShape !== 'text'
  const path = isPathShape ? polygonShapePathD(settings, dotSize) : null
  const text = settings.dotText.trim()

  // Design tools that import SVG as editable vectors (Framer, Figma, …) size the resulting layer
  // to the geometric bounding box of its contents, ignoring the declared width/height/viewBox —
  // so a sparse icon gets cropped down to just its dots instead of keeping the full square canvas.
  // This invisible rect spans the whole canvas purely so that bounding box includes the full square.
  const nodes: string[] = [`  <rect x="0" y="0" width="${canvasSize}" height="${canvasSize}" fill="none" />`]
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (dotShape === 'text' && !text) continue

      const opacity = quantizeCoverage(gridCoverage[row * gridSize + col], smoothnessShades)
      if (opacity === 0) continue

      const cx = col * cellSize + cellSize / 2
      const cy = row * cellSize + cellSize / 2

      const transformParts = [`translate(${cx.toFixed(2)} ${cy.toFixed(2)})`]
      if (rotationDeg) transformParts.push(`rotate(${rotationDeg})`)
      if (skewDeg) transformParts.push(`skewX(${skewDeg})`)
      if (scaleX !== 1 || scaleY !== 1) transformParts.push(`scale(${scaleX} ${scaleY})`)
      const transform = transformParts.join(' ')

      if (dotShape === 'circle') {
        nodes.push(
          `  <circle cx="0" cy="0" r="${(dotSize / 2).toFixed(2)}" fill="${primaryColor}" fill-opacity="${opacity.toFixed(3)}" transform="${transform}" />`,
        )
      } else if (dotShape === 'square') {
        const half = (dotSize / 2).toFixed(2)
        nodes.push(
          `  <rect x="-${half}" y="-${half}" width="${dotSize.toFixed(2)}" height="${dotSize.toFixed(2)}" rx="${cornerRadius.toFixed(2)}" ry="${cornerRadius.toFixed(2)}" fill="${primaryColor}" fill-opacity="${opacity.toFixed(3)}" transform="${transform}" />`,
        )
      } else if (dotShape === 'text') {
        const fontSize = (dotSize * TEXT_DOT_SIZE_SCALE).toFixed(2)
        nodes.push(
          `  <text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" font-family='${TEXT_DOT_FONT_STACK}' fill="${primaryColor}" fill-opacity="${opacity.toFixed(3)}" transform="${transform}">${escapeXmlText(text)}</text>`,
        )
      } else {
        nodes.push(
          `  <path d="${path}" fill="${primaryColor}" fill-opacity="${opacity.toFixed(3)}" transform="${transform}" />`,
        )
      }
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">`,
    ...nodes,
    '</svg>',
  ].join('\n')
}
