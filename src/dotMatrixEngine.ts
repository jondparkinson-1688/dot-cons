import { SAMPLE_RESOLUTION } from './rasterize'
import type { DotMatrixSettings } from './types'

/**
 * Downsamples full-resolution pixel coverage into one averaged coverage value per grid cell,
 * then rescales so the single densest cell reaches 1.0. Without this, a coarse grid (large
 * cells relative to the icon's stroke width) dilutes every cell's average down — even a cell
 * that's genuinely "this is solid icon" might only average 40-60% coverage once blended across
 * an 80px block — so a fixed downstream threshold would need to vary with grid size to mean the
 * same thing. Rescaling relative to the icon's own densest cell keeps "how solid is this cell
 * relative to the icon's most solid point" a stable, resolution-independent quantity.
 */
export function computeGridCoverage(coverage: Float32Array, gridSize: number): Float32Array {
  const block = SAMPLE_RESOLUTION / gridSize
  const grid = new Float32Array(gridSize * gridSize)
  let maxCoverage = 0

  for (let row = 0; row < gridSize; row++) {
    const yStart = Math.floor(row * block)
    const yEnd = Math.floor((row + 1) * block)

    for (let col = 0; col < gridSize; col++) {
      const xStart = Math.floor(col * block)
      const xEnd = Math.floor((col + 1) * block)

      let sum = 0
      let count = 0
      for (let y = yStart; y < yEnd; y++) {
        const rowOffset = y * SAMPLE_RESOLUTION
        for (let x = xStart; x < xEnd; x++) {
          sum += coverage[rowOffset + x]
          count++
        }
      }
      const value = count > 0 ? sum / count : 0
      grid[row * gridSize + col] = value
      if (value > maxCoverage) maxCoverage = value
    }
  }

  if (maxCoverage > 0 && maxCoverage < 1) {
    for (let i = 0; i < grid.length; i++) grid[i] /= maxCoverage
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

  const { gridSize, smoothnessShades, primaryColor } = settings
  const { cellSize, dotSize, cornerRadius } = dotGeometryFor(settings, canvasSize)
  const [r, g, b] = hexToRgb(primaryColor)

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const opacity = quantizeCoverage(gridCoverage[row * gridSize + col], smoothnessShades)
      if (opacity === 0) continue

      const cx = col * cellSize + cellSize / 2
      const cy = row * cellSize + cellSize / 2

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`
      ctx.beginPath()
      ctx.roundRect(cx - dotSize / 2, cy - dotSize / 2, dotSize, dotSize, cornerRadius)
      ctx.fill()
    }
  }
}

export function buildDotMatrixSvg(
  gridCoverage: Float32Array,
  settings: DotMatrixSettings,
  canvasSize: number,
): string {
  const { gridSize, smoothnessShades, primaryColor } = settings
  const { cellSize, dotSize, cornerRadius } = dotGeometryFor(settings, canvasSize)

  const rects: string[] = []
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const opacity = quantizeCoverage(gridCoverage[row * gridSize + col], smoothnessShades)
      if (opacity === 0) continue

      const cx = col * cellSize + cellSize / 2
      const cy = row * cellSize + cellSize / 2
      const x = (cx - dotSize / 2).toFixed(2)
      const y = (cy - dotSize / 2).toFixed(2)

      rects.push(
        `  <rect x="${x}" y="${y}" width="${dotSize.toFixed(2)}" height="${dotSize.toFixed(2)}" rx="${cornerRadius.toFixed(2)}" ry="${cornerRadius.toFixed(2)}" fill="${primaryColor}" fill-opacity="${opacity.toFixed(3)}" />`,
      )
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasSize}" height="${canvasSize}" viewBox="0 0 ${canvasSize} ${canvasSize}">`,
    ...rects,
    '</svg>',
  ].join('\n')
}
