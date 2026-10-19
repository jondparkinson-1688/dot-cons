import './style.css'
import { getIconLibraries } from './iconLibraries'
import { rasterizeSvgToCoverage } from './rasterize'
import { computeGridCoverage, limitLineWidth, renderDotMatrixToCanvas, buildDotMatrixSvg } from './dotMatrixEngine'
import { downloadPng, downloadSvg } from './download'
import type { DotMatrixSettings, DotShape, IconEntry, IconLibrary, IconStyle } from './types'

const LARGE_PREVIEW_SIZE = 480
const MAX_RESULTS_SHOWN = 60

const libraries = getIconLibraries()

const TILE_SIZE = 190
const TILE_GAP = 24
/** Tiles snap to a lattice this many content-space px on a side — one tile plus one gap, so
 * adjacent cells always land flush with a consistent gap, however they're arranged. */
const GRID_CELL = TILE_SIZE + TILE_GAP

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const ZOOM_STEP = 0.25

/** One icon "artboard" on the canvas — its own icon reference, its own fully-resolved settings,
 * and its own freely-draggable position in canvas space (independent of the viewport's pan). */
interface IconInstance {
  id: string
  library: IconLibrary
  icon: IconEntry
  iconStyle: IconStyle
  settings: DotMatrixSettings
  rawCoverage: Float32Array | null
  gridCoverage: Float32Array | null
  tileEl: HTMLButtonElement | null
  x: number
  y: number
}

function createDefaultSettings(): DotMatrixSettings {
  return {
    gridSize: 12,
    smoothnessShades: 1,
    dotRoundness: 0.5,
    dotSpacingPx: 2,
    primaryColor: '#ffffff',
    maxLineWidth: null,
    dotShape: 'square',
    polygonSides: 6,
    starPoints: 5,
    dotText: 'A',
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    skewDeg: 0,
  }
}

// --- DOM: side rail / docked panel -----------------------------------------------------------

const railButtons = document.querySelectorAll<HTMLButtonElement>('[data-panel]')
const sidePanel = document.querySelector<HTMLDivElement>('#side-panel')!
const sidePanelTitle = document.querySelector<HTMLSpanElement>('#side-panel-title')!
const panelContents = document.querySelectorAll<HTMLDivElement>('[data-panel-content]')
const editScopeControl = document.querySelector<HTMLDivElement>('#edit-scope-control')!
const editScopeButtons = document.querySelectorAll<HTMLButtonElement>('[data-edit-scope]')

// --- DOM: library panel ------------------------------------------------------------------------

const librarySelect = document.querySelector<HTMLSelectElement>('#library-select')!
const libraryLicense = document.querySelector<HTMLParagraphElement>('#library-license')!
const styleToggleField = document.querySelector<HTMLDivElement>('#style-toggle-field')!
const styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!
const iconSearch = document.querySelector<HTMLInputElement>('#icon-search')!
const iconResultsCount = document.querySelector<HTMLParagraphElement>('#icon-results-count')!
const iconGrid = document.querySelector<HTMLDivElement>('#icon-grid')!

// --- DOM: grid panel ----------------------------------------------------------------------------

const gridSizeInput = document.querySelector<HTMLInputElement>('#grid-size')!
const gridSizeNumber = document.querySelector<HTMLInputElement>('#grid-size-number')!
const smoothnessInput = document.querySelector<HTMLInputElement>('#smoothness')!
const smoothnessNumber = document.querySelector<HTMLInputElement>('#smoothness-number')!
const lineWidthRow = document.querySelector<HTMLDivElement>('#line-width-row')!
const lineWidthInput = document.querySelector<HTMLInputElement>('#line-width')!
const lineWidthNumber = document.querySelector<HTMLInputElement>('#line-width-number')!
const lineWidthToggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-line-width-toggle]')
const gridOverlayToggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-grid-overlay-toggle]')

// --- DOM: style panel ----------------------------------------------------------------------------

const roundnessInput = document.querySelector<HTMLInputElement>('#roundness')!
const roundnessNumber = document.querySelector<HTMLInputElement>('#roundness-number')!
const spacingInput = document.querySelector<HTMLInputElement>('#spacing')!
const spacingNumber = document.querySelector<HTMLInputElement>('#spacing-number')!
const shapeButtons = document.querySelectorAll<HTMLButtonElement>('[data-shape]')
const polygonSidesControl = document.querySelector<HTMLDivElement>('#polygon-sides-control')!
const polygonSidesInput = document.querySelector<HTMLInputElement>('#polygon-sides')!
const polygonSidesNumber = document.querySelector<HTMLInputElement>('#polygon-sides-number')!
const starPointsControl = document.querySelector<HTMLDivElement>('#star-points-control')!
const starPointsInput = document.querySelector<HTMLInputElement>('#star-points')!
const starPointsNumber = document.querySelector<HTMLInputElement>('#star-points-number')!
const textControl = document.querySelector<HTMLDivElement>('#text-control')!
const textInput = document.querySelector<HTMLInputElement>('#dot-text')!
const textClearButton = document.querySelector<HTMLButtonElement>('#dot-text-clear')!
const scaleXInput = document.querySelector<HTMLInputElement>('#scale-x')!
const scaleXNumber = document.querySelector<HTMLInputElement>('#scale-x-number')!
const scaleYInput = document.querySelector<HTMLInputElement>('#scale-y')!
const scaleYNumber = document.querySelector<HTMLInputElement>('#scale-y-number')!
const rotationInput = document.querySelector<HTMLInputElement>('#rotation')!
const rotationNumber = document.querySelector<HTMLInputElement>('#rotation-number')!
const skewInput = document.querySelector<HTMLInputElement>('#skew')!
const skewNumber = document.querySelector<HTMLInputElement>('#skew-number')!
const primaryColorInput = document.querySelector<HTMLInputElement>('#primary-color')!
const primaryColorHexInput = document.querySelector<HTMLInputElement>('#primary-color-hex')!

// --- DOM: canvas + toolbar -----------------------------------------------------------------------

const appEl = document.querySelector<HTMLDivElement>('#app')!
const canvasViewport = document.querySelector<HTMLDivElement>('#canvas-viewport')!
const iconStage = document.querySelector<HTMLDivElement>('#icon-stage')!
const canvasBgButtons = document.querySelectorAll<HTMLButtonElement>('.canvas-bg-swatch[data-canvas-bg]')
const smallMounts = {
  16: document.querySelector<HTMLDivElement>('#preview-mount-16')!,
  24: document.querySelector<HTMLDivElement>('#preview-mount-24')!,
  40: document.querySelector<HTMLDivElement>('#preview-mount-40')!,
}
const downloadFormatSelect = document.querySelector<HTMLSelectElement>('#download-format')!
const downloadButton = document.querySelector<HTMLButtonElement>('#download-button')!
const zoomOutButton = document.querySelector<HTMLButtonElement>('#zoom-out')!
const zoomInButton = document.querySelector<HTMLButtonElement>('#zoom-in')!
const zoomResetButton = document.querySelector<HTMLButtonElement>('#zoom-reset')!
const zoomFitButton = document.querySelector<HTMLButtonElement>('#zoom-fit')!

/** Never attached to the DOM — exists purely so PNG export has a bitmap to rasterize into. */
const exportCanvas = document.createElement('canvas')

// --- State -----------------------------------------------------------------------------------

let currentLibrary: IconLibrary = libraries[0]
let currentStyle: IconStyle = 'outlined'
let activePanel: 'library' | 'grid' | 'style' = 'library'
let editScope: 'selected' | 'all' = 'selected'
let gridOverlayVisible = false

const instances: IconInstance[] = []
let selectedInstanceId = ''
let nextInstanceId = 1

let panX = 0
let panY = 0
let zoom = 1

const coverageCache = new Map<string, Promise<Float32Array>>()

function selectedInstance(): IconInstance | undefined {
  return instances.find((instance) => instance.id === selectedInstanceId)
}

function updateStageTransform(): void {
  iconStage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
}

/**
 * The lattice tiles snap onto isn't anchored at a fixed (0,0) — it's anchored wherever the very
 * first tile actually lands (set once, the first time an instance is placed). Snapping onto an
 * absolute (0,0)-based grid would round that first, deliberately-centered tile away from true
 * center by up to half a cell; anchoring the lattice to it instead means the starting tile is
 * always exactly where it was placed, and everything else aligns relative to *it*.
 */
let gridOriginX: number | null = null
let gridOriginY: number | null = null

function snapToGridX(value: number): number {
  if (gridOriginX === null) return value
  return gridOriginX + Math.round((value - gridOriginX) / GRID_CELL) * GRID_CELL
}

function snapToGridY(value: number): number {
  if (gridOriginY === null) return value
  return gridOriginY + Math.round((value - gridOriginY) / GRID_CELL) * GRID_CELL
}

/** Converts a screen-space point (relative to the viewport) into the canvas's own content-space
 * coordinates — i.e. undoes the current pan/zoom transform. */
function screenToContent(screenX: number, screenY: number): { x: number; y: number } {
  return { x: (screenX - panX) / zoom, y: (screenY - panY) / zoom }
}

function setZoom(nextZoom: number, anchorScreenX?: number, anchorScreenY?: number): void {
  const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  if (clamped === zoom) return

  const rect = canvasViewport.getBoundingClientRect()
  const screenX = anchorScreenX ?? rect.width / 2
  const screenY = anchorScreenY ?? rect.height / 2
  const anchorContent = screenToContent(screenX, screenY)

  zoom = clamped
  panX = screenX - anchorContent.x * zoom
  panY = screenY - anchorContent.y * zoom

  zoomResetButton.textContent = `${Math.round(zoom * 100)}%`
  updateStageTransform()
}

/** Re-centers the view and picks a zoom level that fits every icon on screen at once — the fix
 * for "I zoomed/panned and now I can't find my icons" rather than hoping manual zoom always
 * happens to anchor somewhere useful. */
function fitToContent(): void {
  const rect = canvasViewport.getBoundingClientRect()

  if (instances.length === 0) {
    zoom = 1
    panX = rect.width / 2 - TILE_SIZE / 2
    panY = rect.height / 2 - TILE_SIZE / 2
    zoomResetButton.textContent = '100%'
    updateStageTransform()
    return
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const instance of instances) {
    minX = Math.min(minX, instance.x)
    minY = Math.min(minY, instance.y)
    maxX = Math.max(maxX, instance.x + TILE_SIZE)
    maxY = Math.max(maxY, instance.y + TILE_SIZE)
  }

  const contentWidth = maxX - minX
  const contentHeight = maxY - minY
  const contentCenterX = (minX + maxX) / 2
  const contentCenterY = (minY + maxY) / 2

  const padding = 80
  const availableWidth = Math.max(rect.width - padding * 2, 100)
  const availableHeight = Math.max(rect.height - padding * 2, 100)
  const fitZoom = Math.min(availableWidth / contentWidth, availableHeight / contentHeight)

  zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, fitZoom))
  panX = rect.width / 2 - contentCenterX * zoom
  panY = rect.height / 2 - contentCenterY * zoom

  zoomResetButton.textContent = `${Math.round(zoom * 100)}%`
  updateStageTransform()
}

/** Where a newly added tile should land: centered in the current view for the very first one,
 * then trailing after the last tile — both expressed in canvas space (i.e. already compensated
 * for the current pan/zoom, so it appears where it visually looks like it should). */
function nextTilePosition(): { x: number; y: number } {
  if (instances.length === 0) {
    const rect = canvasViewport.getBoundingClientRect()
    const center = screenToContent(rect.width / 2, rect.height / 2)
    const x = center.x - TILE_SIZE / 2
    const y = center.y - TILE_SIZE / 2
    // This exact spot becomes the grid's origin, so the first tile is never rounded off-center.
    gridOriginX = x
    gridOriginY = y
    return { x, y }
  }
  const last = instances[instances.length - 1]
  return { x: last.x + GRID_CELL, y: last.y }
}

// --- Rendering ---------------------------------------------------------------------------------

/**
 * dotSpacingPx is an absolute pixel value calibrated against the large (480px) render. Reused
 * as-is at a 16-40px "actual size" preview, it can easily exceed the entire cell size (e.g. a
 * 2px gap when each cell is only ~1.3px across), clamping every dot to zero size and rendering
 * nothing. Scaling it down by the same ratio as the canvas size keeps the gap proportionate.
 */
function smallPreviewSettings(settings: DotMatrixSettings, canvasSize: number): DotMatrixSettings {
  return { ...settings, dotSpacingPx: settings.dotSpacingPx * (canvasSize / LARGE_PREVIEW_SIZE) }
}

/** Renders a single instance's current coverage/settings into its own canvas tile. */
function renderInstance(instance: IconInstance): void {
  if (!instance.rawCoverage || !instance.tileEl) return

  let gridCoverage = computeGridCoverage(instance.rawCoverage, instance.settings.gridSize)
  if (instance.settings.maxLineWidth !== null) {
    gridCoverage = limitLineWidth(gridCoverage, instance.settings.gridSize, instance.settings.maxLineWidth)
  }
  instance.gridCoverage = gridCoverage

  const mount = instance.tileEl.querySelector<HTMLDivElement>('.svg-mount')!
  mount.innerHTML = buildDotMatrixSvg(gridCoverage, instance.settings, LARGE_PREVIEW_SIZE)

  const overlay = instance.tileEl.querySelector<HTMLDivElement>('.grid-overlay')!
  overlay.style.setProperty('--grid-cols', String(instance.settings.gridSize))
  overlay.style.setProperty('--grid-rows', String(instance.settings.gridSize))
  overlay.hidden = !gridOverlayVisible

  if (instance.id === selectedInstanceId) renderSelectedExtras(instance)
}

/** The toolbar's actual-size previews and the hidden export canvas always track the selection. */
function renderSelectedExtras(instance: IconInstance): void {
  if (!instance.gridCoverage) return
  for (const [size, mount] of Object.entries(smallMounts)) {
    mount.innerHTML = buildDotMatrixSvg(
      instance.gridCoverage,
      smallPreviewSettings(instance.settings, Number(size)),
      Number(size),
    )
  }
  renderDotMatrixToCanvas(exportCanvas, instance.gridCoverage, instance.settings, LARGE_PREVIEW_SIZE)
}

async function loadInstanceCoverage(instance: IconInstance): Promise<void> {
  const loader = instance.icon.styles[instance.iconStyle] ?? instance.icon.styles.outlined ?? instance.icon.styles.filled
  if (!loader) return

  const cacheKey = `${instance.library.id}:${instance.icon.name}:${instance.iconStyle}`
  let coveragePromise = coverageCache.get(cacheKey)
  if (!coveragePromise) {
    coveragePromise = loader().then(rasterizeSvgToCoverage)
    coverageCache.set(cacheKey, coveragePromise)
  }

  instance.rawCoverage = await coveragePromise
  renderInstance(instance)
}

// --- Canvas tiles --------------------------------------------------------------------------------

function createTileElement(instance: IconInstance): HTMLButtonElement {
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = 'icon-tile-canvas'
  tile.dataset.instanceId = instance.id
  tile.setAttribute('aria-selected', String(instance.id === selectedInstanceId))
  tile.title = instance.icon.label

  const overlay = document.createElement('div')
  overlay.className = 'grid-overlay'
  overlay.hidden = !gridOverlayVisible
  tile.appendChild(overlay)

  const mount = document.createElement('div')
  mount.className = 'svg-mount'
  tile.appendChild(mount)

  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.className = 'icon-tile-remove'
  removeButton.setAttribute('aria-label', `Remove ${instance.icon.label}`)
  removeButton.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="5" x2="15" y2="15" /><line x1="15" y1="5" x2="5" y2="15" /></svg>'
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation()
    removeInstance(instance.id)
  })
  tile.appendChild(removeButton)

  makeTileDraggable(instance, tile)

  return tile
}

/** Dragging a tile moves just that icon, snapped onto the shared grid lattice the whole way —
 * like a chess piece, it only ever occupies a cell, never a position in between. A plain click
 * (no movement) just selects it. stopPropagation keeps the canvas-pan handler from also firing
 * for the same gesture. Pointer deltas are divided by the current zoom since a tile's left/top
 * live in content space, but the pointer moves in screen space. */
function makeTileDraggable(instance: IconInstance, tile: HTMLButtonElement): void {
  tile.addEventListener('pointerdown', (event) => {
    if (event.target instanceof HTMLElement && event.target.closest('.icon-tile-remove')) return
    event.stopPropagation()
    selectInstance(instance.id)

    const startX = event.clientX
    const startY = event.clientY
    const startLeft = instance.x
    const startTop = instance.y
    tile.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const rawX = startLeft + (moveEvent.clientX - startX) / zoom
      const rawY = startTop + (moveEvent.clientY - startY) / zoom
      instance.x = snapToGridX(rawX)
      instance.y = snapToGridY(rawY)
      tile.style.left = `${instance.x}px`
      tile.style.top = `${instance.y}px`
    }
    const onUp = () => {
      tile.removeEventListener('pointermove', onMove)
      tile.removeEventListener('pointerup', onUp)
    }
    tile.addEventListener('pointermove', onMove)
    tile.addEventListener('pointerup', onUp)
  })
}

function createAddTileElement(position: { x: number; y: number }): HTMLButtonElement {
  const tile = document.createElement('button')
  tile.type = 'button'
  tile.className = 'icon-tile-canvas icon-tile-canvas--add'
  tile.style.left = `${position.x}px`
  tile.style.top = `${position.y}px`
  tile.setAttribute('aria-label', 'Add icon')
  tile.innerHTML =
    '<svg width="32" height="32" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><line x1="10" y1="4" x2="10" y2="16" /><line x1="4" y1="10" x2="16" y2="10" /></svg>'
  tile.addEventListener('pointerdown', (event) => event.stopPropagation())
  tile.addEventListener('click', handleAddInstance)
  return tile
}

function renderIconStage(): void {
  iconStage.innerHTML = ''
  for (const instance of instances) {
    const tile = createTileElement(instance)
    tile.style.left = `${instance.x}px`
    tile.style.top = `${instance.y}px`
    instance.tileEl = tile
    iconStage.appendChild(tile)
    if (instance.rawCoverage) renderInstance(instance)
  }
  iconStage.appendChild(createAddTileElement(nextTilePosition()))
}

// --- Selection & library picking -----------------------------------------------------------------

/** Pushes an instance's own settings into the Grid/Style controls so editing shows its state. */
function syncPanelFromSettings(settings: DotMatrixSettings): void {
  gridSizeInput.value = String(settings.gridSize)
  gridSizeNumber.value = String(settings.gridSize)
  smoothnessInput.value = String(settings.smoothnessShades)
  smoothnessNumber.value = String(settings.smoothnessShades)
  roundnessInput.value = String(Math.round(settings.dotRoundness * 100))
  roundnessNumber.value = roundnessInput.value
  spacingInput.value = String(settings.dotSpacingPx)
  spacingNumber.value = spacingInput.value
  primaryColorInput.value = settings.primaryColor
  primaryColorHexInput.value = settings.primaryColor
  scaleXInput.value = String(settings.scaleX)
  scaleXNumber.value = scaleXInput.value
  scaleYInput.value = String(settings.scaleY)
  scaleYNumber.value = scaleYInput.value
  rotationInput.value = String(settings.rotationDeg)
  rotationNumber.value = rotationInput.value
  skewInput.value = String(settings.skewDeg)
  skewNumber.value = skewInput.value
  polygonSidesInput.value = String(settings.polygonSides)
  polygonSidesNumber.value = polygonSidesInput.value
  starPointsInput.value = String(settings.starPoints)
  starPointsNumber.value = starPointsInput.value
  textInput.value = settings.dotText

  const lineWidthEnabled = settings.maxLineWidth !== null
  for (const button of lineWidthToggleButtons) {
    button.setAttribute('aria-pressed', String((button.dataset.lineWidthToggle === 'on') === lineWidthEnabled))
  }
  lineWidthRow.hidden = !lineWidthEnabled
  lineWidthInput.value = String(settings.maxLineWidth ?? 2)
  lineWidthNumber.value = lineWidthInput.value

  for (const button of shapeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.shape === settings.dotShape))
  }
  polygonSidesControl.hidden = settings.dotShape !== 'polygon'
  starPointsControl.hidden = settings.dotShape !== 'star'
  textControl.hidden = settings.dotShape !== 'text'
}

/** Re-applies aria-selected on the library grid to match whatever the selected instance shows. */
function updateLibrarySelectionHighlight(): void {
  const instance = selectedInstance()
  for (const tile of iconGrid.querySelectorAll<HTMLButtonElement>('.icon-tile')) {
    tile.setAttribute('aria-selected', String(!!instance && tile.title === instance.icon.label))
  }
}

function selectInstance(id: string): void {
  selectedInstanceId = id
  for (const instance of instances) {
    instance.tileEl?.setAttribute('aria-selected', String(instance.id === id))
  }

  const instance = selectedInstance()
  if (!instance) return
  syncPanelFromSettings(instance.settings)
  updateLibrarySelectionHighlight()
  if (instance.gridCoverage) renderSelectedExtras(instance)
}

function removeInstance(id: string): void {
  const index = instances.findIndex((instance) => instance.id === id)
  if (index === -1) return
  instances.splice(index, 1)

  if (selectedInstanceId === id) {
    selectedInstanceId = instances[Math.max(0, index - 1)]?.id ?? ''
  }
  renderIconStage()

  const instance = selectedInstance()
  if (instance) {
    syncPanelFromSettings(instance.settings)
    if (instance.gridCoverage) renderSelectedExtras(instance)
  }
  updateLibrarySelectionHighlight()
}

function handleAddInstance(): void {
  const source = selectedInstance() ?? instances[instances.length - 1]
  const fallbackIcon = currentLibrary.icons.find((icon) => icon.name === 'home') ?? currentLibrary.icons[0]
  const position = nextTilePosition()

  const instance: IconInstance = {
    id: `inst-${nextInstanceId++}`,
    library: source?.library ?? currentLibrary,
    icon: source?.icon ?? fallbackIcon,
    iconStyle: source?.iconStyle ?? 'outlined',
    settings: source ? { ...source.settings } : createDefaultSettings(),
    rawCoverage: source?.rawCoverage ?? null,
    gridCoverage: null,
    tileEl: null,
    x: position.x,
    y: position.y,
  }

  instances.push(instance)
  selectedInstanceId = instance.id
  renderIconStage()
  openPanel('library')
  syncPanelFromSettings(instance.settings)
  updateLibrarySelectionHighlight()

  if (!instance.rawCoverage) void loadInstanceCoverage(instance)
}

async function chooseIconForSelectedInstance(icon: IconEntry): Promise<void> {
  const instance = selectedInstance()
  if (!instance) return

  instance.library = currentLibrary
  instance.icon = icon
  instance.iconStyle = currentStyle
  instance.rawCoverage = null
  if (instance.tileEl) instance.tileEl.title = icon.label

  updateLibrarySelectionHighlight()
  await loadInstanceCoverage(instance)
}

// --- Editing: apply a change to the selected instance, or every instance -----------------------

function applySettingChange(mutate: (settings: DotMatrixSettings) => void): void {
  const targets = editScope === 'all' ? instances : instances.filter((instance) => instance.id === selectedInstanceId)
  for (const instance of targets) {
    mutate(instance.settings)
    renderInstance(instance)
  }
}

// --- Library browsing (which icons are listed, independent of canvas selection) -----------------

function populateLibrarySelect(): void {
  librarySelect.innerHTML = libraries.map((library) => `<option value="${library.id}">${library.label}</option>`).join('')
}

function libraryHasFilledStyle(library: IconLibrary): boolean {
  return library.icons.some((icon) => icon.styles.filled)
}

function updateLibraryChrome(): void {
  libraryLicense.textContent = currentLibrary.license
  const showToggle = libraryHasFilledStyle(currentLibrary)
  styleToggleField.hidden = !showToggle
  if (!showToggle) currentStyle = 'outlined'
}

/**
 * Scores how well `word` matches within `text`. A direct substring match scores highest (earlier
 * matches score higher, so "home" beats "townhome" for the query "home"). Otherwise falls back to
 * a subsequence/fuzzy match (same family of heuristic as VS Code's command palette or fzf) so
 * close or abbreviated queries like "arwlft" still surface "arrow-left". Returns null if `word`
 * isn't even a subsequence of `text` — i.e. no match at all.
 */
function fuzzyWordScore(word: string, text: string): number | null {
  const directIndex = text.indexOf(word)
  if (directIndex !== -1) return 1000 - directIndex

  let queryIndex = 0
  let score = 0
  let lastMatchIndex = -1
  for (let textIndex = 0; textIndex < text.length && queryIndex < word.length; textIndex++) {
    if (text[textIndex] === word[queryIndex]) {
      score += lastMatchIndex === textIndex - 1 ? 5 : 1
      lastMatchIndex = textIndex
      queryIndex++
    }
  }
  return queryIndex === word.length ? score : null
}

function matchingIcons(): IconEntry[] {
  const query = iconSearch.value.trim().toLowerCase()
  if (!query) return currentLibrary.icons

  const words = query.split(/\s+/).filter(Boolean)
  const scored: { icon: IconEntry; score: number }[] = []

  for (const icon of currentLibrary.icons) {
    const haystack = `${icon.label.toLowerCase()} ${icon.name.toLowerCase()}`
    let total = 0
    let matchesAllWords = true
    for (const word of words) {
      const wordScore = fuzzyWordScore(word, haystack)
      if (wordScore === null) {
        matchesAllWords = false
        break
      }
      total += wordScore
    }
    if (matchesAllWords) scored.push({ icon, score: total })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.map((entry) => entry.icon)
}

async function renderIconGrid(): Promise<void> {
  const matches = matchingIcons()
  const shown = matches.slice(0, MAX_RESULTS_SHOWN)

  iconResultsCount.textContent =
    matches.length > shown.length
      ? `Showing ${shown.length} of ${matches.length} matches — refine your search`
      : `${matches.length} icon${matches.length === 1 ? '' : 's'}`

  iconGrid.innerHTML = ''

  const instance = selectedInstance()
  for (const icon of shown) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'icon-tile'
    button.title = icon.label
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(!!instance && instance.icon.name === icon.name))
    iconGrid.appendChild(button)

    const loader = icon.styles[currentStyle] ?? icon.styles.outlined ?? icon.styles.filled
    if (loader) {
      loader().then((svg) => {
        button.innerHTML = `<span class="icon-thumb">${svg}</span>`
      })
    }

    button.addEventListener('click', () => void chooseIconForSelectedInstance(icon))
  }
}

// --- Side rail / docked panel ---------------------------------------------------------------------

/** Always ensures `panel` is the open, visible one — used wherever code needs the panel open,
 * as opposed to the rail button's own click handler, which additionally toggles it closed when
 * the already-active panel's button is clicked again. */
function openPanel(panel: 'library' | 'grid' | 'style'): void {
  activePanel = panel
  sidePanel.hidden = false
  sidePanelTitle.textContent = panel.charAt(0).toUpperCase() + panel.slice(1)
  editScopeControl.hidden = panel === 'library'

  for (const button of railButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.panel === panel))
  }
  for (const content of panelContents) {
    content.hidden = content.dataset.panelContent !== panel
  }
}

function handleRailButtonClick(panel: 'library' | 'grid' | 'style'): void {
  if (activePanel === panel && !sidePanel.hidden) {
    sidePanel.hidden = true
    for (const button of railButtons) button.setAttribute('aria-pressed', 'false')
    return
  }
  openPanel(panel)
}

// --- Shared control bindings ----------------------------------------------------------------------

/** Keeps a range input and its paired number input in sync in both directions. */
function bindRangeNumber(range: HTMLInputElement, number: HTMLInputElement, onChange: () => void): void {
  range.addEventListener('input', () => {
    number.value = range.value
    onChange()
  })

  number.addEventListener('input', () => {
    const value = Number(number.value)
    if (!Number.isFinite(value) || value < Number(range.min) || value > Number(range.max)) return
    range.value = number.value
    onChange()
  })

  number.addEventListener('change', () => {
    number.value = range.value
  })
}

/** Drag-to-pan on empty canvas: moves the whole icon stage (and every tile in it) together,
 * independent of any tile's own position within that space. Dragging a tile itself is handled
 * separately by makeTileDraggable and stops this from also firing via stopPropagation. */
function initCanvasPanning(): void {
  let panning = false
  let startX = 0
  let startY = 0
  let startPanX = 0
  let startPanY = 0

  canvasViewport.addEventListener('pointerdown', (event) => {
    if (event.target !== canvasViewport && event.target !== iconStage) return

    panning = true
    canvasViewport.classList.add('is-panning')
    startX = event.clientX
    startY = event.clientY
    startPanX = panX
    startPanY = panY
    canvasViewport.setPointerCapture(event.pointerId)
  })

  canvasViewport.addEventListener('pointermove', (event) => {
    if (!panning) return
    panX = startPanX + (event.clientX - startX)
    panY = startPanY + (event.clientY - startY)
    updateStageTransform()
  })

  const stopPanning = () => {
    panning = false
    canvasViewport.classList.remove('is-panning')
  }
  canvasViewport.addEventListener('pointerup', stopPanning)
  canvasViewport.addEventListener('pointercancel', stopPanning)

  // Trackpad pinch (and ctrl/cmd+scroll) zooms toward the cursor; a plain two-finger scroll pans.
  canvasViewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = canvasViewport.getBoundingClientRect()
        setZoom(zoom - event.deltaY * 0.01, event.clientX - rect.left, event.clientY - rect.top)
      } else {
        panX -= event.deltaX
        panY -= event.deltaY
        updateStageTransform()
      }
    },
    { passive: false },
  )
}

function syncColorInputs(source: 'picker' | 'hex'): void {
  if (source === 'picker') {
    primaryColorHexInput.value = primaryColorInput.value
  } else {
    const value = primaryColorHexInput.value.trim()
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
      primaryColorInput.value = value
    }
  }
  applySettingChange((settings) => {
    settings.primaryColor = primaryColorHexInput.value
  })
}

function handleDownload(): void {
  const instance = selectedInstance()
  if (!instance || !instance.gridCoverage) return

  const filename = `${instance.icon.name}-dot-matrix`
  if (downloadFormatSelect.value === 'png') {
    downloadPng(exportCanvas, `${filename}.png`)
  } else {
    const svg = buildDotMatrixSvg(instance.gridCoverage, instance.settings, LARGE_PREVIEW_SIZE)
    downloadSvg(svg, `${filename}.svg`)
  }
}

function wireEvents(): void {
  for (const button of railButtons) {
    button.addEventListener('click', () => handleRailButtonClick(button.dataset.panel as 'library' | 'grid' | 'style'))
  }

  for (const button of editScopeButtons) {
    button.addEventListener('click', () => {
      editScope = button.dataset.editScope as 'selected' | 'all'
      for (const option of editScopeButtons) option.setAttribute('aria-pressed', String(option === button))
    })
  }

  librarySelect.addEventListener('change', () => {
    currentLibrary = libraries.find((library) => library.id === librarySelect.value) ?? libraries[0]
    updateLibraryChrome()
    void renderIconGrid()
  })

  styleSelect.addEventListener('change', () => {
    currentStyle = styleSelect.value as IconStyle
    void renderIconGrid()
  })

  iconSearch.addEventListener('input', () => void renderIconGrid())

  bindRangeNumber(gridSizeInput, gridSizeNumber, () =>
    applySettingChange((s) => {
      s.gridSize = Number(gridSizeInput.value)
    }),
  )
  bindRangeNumber(smoothnessInput, smoothnessNumber, () =>
    applySettingChange((s) => {
      s.smoothnessShades = Number(smoothnessInput.value)
    }),
  )
  bindRangeNumber(roundnessInput, roundnessNumber, () =>
    applySettingChange((s) => {
      s.dotRoundness = Number(roundnessInput.value) / 100
    }),
  )
  bindRangeNumber(spacingInput, spacingNumber, () =>
    applySettingChange((s) => {
      s.dotSpacingPx = Number(spacingInput.value)
    }),
  )
  bindRangeNumber(lineWidthInput, lineWidthNumber, () =>
    applySettingChange((s) => {
      if (s.maxLineWidth !== null) s.maxLineWidth = Number(lineWidthInput.value)
    }),
  )
  bindRangeNumber(polygonSidesInput, polygonSidesNumber, () =>
    applySettingChange((s) => {
      s.polygonSides = Number(polygonSidesInput.value)
    }),
  )
  bindRangeNumber(starPointsInput, starPointsNumber, () =>
    applySettingChange((s) => {
      s.starPoints = Number(starPointsInput.value)
    }),
  )
  bindRangeNumber(scaleXInput, scaleXNumber, () =>
    applySettingChange((s) => {
      s.scaleX = Number(scaleXInput.value)
    }),
  )
  bindRangeNumber(scaleYInput, scaleYNumber, () =>
    applySettingChange((s) => {
      s.scaleY = Number(scaleYInput.value)
    }),
  )
  bindRangeNumber(rotationInput, rotationNumber, () =>
    applySettingChange((s) => {
      s.rotationDeg = Number(rotationInput.value)
    }),
  )
  bindRangeNumber(skewInput, skewNumber, () =>
    applySettingChange((s) => {
      s.skewDeg = Number(skewInput.value)
    }),
  )

  for (const button of lineWidthToggleButtons) {
    button.addEventListener('click', () => {
      const enabled = button.dataset.lineWidthToggle === 'on'
      for (const option of lineWidthToggleButtons) option.setAttribute('aria-pressed', String(option === button))
      lineWidthRow.hidden = !enabled
      applySettingChange((s) => {
        s.maxLineWidth = enabled ? Number(lineWidthInput.value) : null
      })
    })
  }

  for (const button of gridOverlayToggleButtons) {
    button.addEventListener('click', () => {
      gridOverlayVisible = button.dataset.gridOverlayToggle === 'on'
      for (const option of gridOverlayToggleButtons) option.setAttribute('aria-pressed', String(option === button))
      for (const instance of instances) {
        const overlay = instance.tileEl?.querySelector<HTMLElement>('.grid-overlay')
        if (overlay) overlay.hidden = !gridOverlayVisible
      }
    })
  }

  for (const button of shapeButtons) {
    button.addEventListener('click', () => {
      const shape = button.dataset.shape as DotShape
      for (const option of shapeButtons) option.setAttribute('aria-pressed', String(option === button))
      polygonSidesControl.hidden = shape !== 'polygon'
      starPointsControl.hidden = shape !== 'star'
      textControl.hidden = shape !== 'text'
      applySettingChange((s) => {
        s.dotShape = shape
      })
    })
  }

  textInput.addEventListener('input', () =>
    applySettingChange((s) => {
      s.dotText = textInput.value
    }),
  )
  textClearButton.addEventListener('click', () => {
    textInput.value = ''
    textInput.focus()
    applySettingChange((s) => {
      s.dotText = ''
    })
  })

  primaryColorInput.addEventListener('input', () => syncColorInputs('picker'))
  primaryColorHexInput.addEventListener('input', () => syncColorInputs('hex'))

  for (const button of canvasBgButtons) {
    button.addEventListener('click', () => {
      appEl.dataset.canvasBg = button.dataset.canvasBg
      for (const option of canvasBgButtons) option.setAttribute('aria-pressed', String(option === button))
    })
  }

  downloadButton.addEventListener('click', handleDownload)

  zoomInButton.addEventListener('click', () => setZoom(zoom + ZOOM_STEP))
  zoomOutButton.addEventListener('click', () => setZoom(zoom - ZOOM_STEP))
  zoomResetButton.addEventListener('click', () => setZoom(1))
  zoomFitButton.addEventListener('click', fitToContent)

  // Shift+1 matches Figma's own "zoom to fit" shortcut.
  window.addEventListener('keydown', (event) => {
    if (event.shiftKey && event.key === '!') {
      const target = event.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
      event.preventDefault()
      fitToContent()
    }
  })
}

async function init(): Promise<void> {
  populateLibrarySelect()
  updateLibraryChrome()
  wireEvents()
  initCanvasPanning()

  iconSearch.value = 'home'
  await renderIconGrid()

  const defaultIcon = currentLibrary.icons.find((icon) => icon.name === 'home') ?? currentLibrary.icons[0]
  if (defaultIcon) {
    const position = nextTilePosition()
    const instance: IconInstance = {
      id: `inst-${nextInstanceId++}`,
      library: currentLibrary,
      icon: defaultIcon,
      iconStyle: currentStyle,
      settings: createDefaultSettings(),
      rawCoverage: null,
      gridCoverage: null,
      tileEl: null,
      x: position.x,
      y: position.y,
    }
    instances.push(instance)
    selectedInstanceId = instance.id
    renderIconStage()
    syncPanelFromSettings(instance.settings)
    updateLibrarySelectionHighlight()
    await loadInstanceCoverage(instance)
  }
}

void init()
