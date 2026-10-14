import './style.css'
import { getIconLibraries } from './iconLibraries'
import { rasterizeSvgToCoverage } from './rasterize'
import { computeGridCoverage, limitLineWidth, renderDotMatrixToCanvas, buildDotMatrixSvg } from './dotMatrixEngine'
import { downloadPng, downloadSvg } from './download'
import type { DotMatrixSettings, IconEntry, IconLibrary, IconStyle } from './types'

const LARGE_PREVIEW_SIZE = 480
const MAX_RESULTS_SHOWN = 60

const libraries = getIconLibraries()

const librarySelect = document.querySelector<HTMLSelectElement>('#library-select')!
const libraryLicense = document.querySelector<HTMLParagraphElement>('#library-license')!
const styleToggleField = document.querySelector<HTMLDivElement>('#style-toggle-field')!
const styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!
const iconSearch = document.querySelector<HTMLInputElement>('#icon-search')!
const iconResultsCount = document.querySelector<HTMLParagraphElement>('#icon-results-count')!
const iconGrid = document.querySelector<HTMLDivElement>('#icon-grid')!

const gridSizeInput = document.querySelector<HTMLInputElement>('#grid-size')!
const gridSizeNumber = document.querySelector<HTMLInputElement>('#grid-size-number')!
const smoothnessInput = document.querySelector<HTMLInputElement>('#smoothness')!
const smoothnessNumber = document.querySelector<HTMLInputElement>('#smoothness-number')!
const roundnessInput = document.querySelector<HTMLInputElement>('#roundness')!
const roundnessNumber = document.querySelector<HTMLInputElement>('#roundness-number')!
const spacingInput = document.querySelector<HTMLInputElement>('#spacing')!
const spacingNumber = document.querySelector<HTMLInputElement>('#spacing-number')!
const lineWidthRow = document.querySelector<HTMLDivElement>('#line-width-row')!
const lineWidthInput = document.querySelector<HTMLInputElement>('#line-width')!
const lineWidthNumber = document.querySelector<HTMLInputElement>('#line-width-number')!
const lineWidthToggleButtons = document.querySelectorAll<HTMLButtonElement>('[data-line-width-toggle]')
const primaryColorInput = document.querySelector<HTMLInputElement>('#primary-color')!
const primaryColorHexInput = document.querySelector<HTMLInputElement>('#primary-color-hex')!
const downloadFormatSelect = document.querySelector<HTMLSelectElement>('#download-format')!
const downloadButton = document.querySelector<HTMLButtonElement>('#download-button')!

const largeCanvas = document.querySelector<HTMLCanvasElement>('#preview-canvas')!
const smallCanvases = {
  16: document.querySelector<HTMLCanvasElement>('#preview-16')!,
  24: document.querySelector<HTMLCanvasElement>('#preview-24')!,
  40: document.querySelector<HTMLCanvasElement>('#preview-40')!,
}

let currentLibrary: IconLibrary = libraries[0]
let currentStyle: IconStyle = 'outlined'
let selectedIcon: IconEntry | undefined
let selectedGridCoverage: Float32Array | undefined
let lineWidthEnabled = false

const coverageCache = new Map<string, Promise<Float32Array>>()

function readSettings(): DotMatrixSettings {
  return {
    gridSize: Number(gridSizeInput.value),
    smoothnessShades: Number(smoothnessInput.value),
    dotRoundness: Number(roundnessInput.value) / 100,
    dotSpacingPx: Number(spacingInput.value),
    primaryColor: primaryColorHexInput.value,
    maxLineWidth: lineWidthEnabled ? Number(lineWidthInput.value) : null,
  }
}

function populateLibrarySelect(): void {
  librarySelect.innerHTML = libraries
    .map((library) => `<option value="${library.id}">${library.label}</option>`)
    .join('')
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

function matchingIcons(): IconEntry[] {
  const query = iconSearch.value.trim().toLowerCase()
  if (!query) return currentLibrary.icons
  return currentLibrary.icons.filter(
    (icon) => icon.name.includes(query) || icon.label.toLowerCase().includes(query),
  )
}

async function renderIconGrid(): Promise<void> {
  const matches = matchingIcons()
  const shown = matches.slice(0, MAX_RESULTS_SHOWN)

  iconResultsCount.textContent =
    matches.length > shown.length
      ? `Showing ${shown.length} of ${matches.length} matches — refine your search`
      : `${matches.length} icon${matches.length === 1 ? '' : 's'}`

  iconGrid.innerHTML = ''

  for (const icon of shown) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'icon-tile'
    button.title = icon.label
    button.setAttribute('role', 'option')
    button.setAttribute('aria-selected', String(selectedIcon === icon))
    iconGrid.appendChild(button)

    const loader = icon.styles[currentStyle] ?? icon.styles.outlined ?? icon.styles.filled
    if (loader) {
      loader().then((svg) => {
        button.innerHTML = `<span class="icon-thumb">${svg}</span>`
      })
    }

    button.addEventListener('click', () => selectIcon(icon))
  }
}

async function selectIcon(icon: IconEntry): Promise<void> {
  selectedIcon = icon
  for (const tile of iconGrid.querySelectorAll<HTMLButtonElement>('.icon-tile')) {
    tile.setAttribute('aria-selected', String(tile.title === icon.label))
  }
  await rerasterizeSelectedIcon()
}

async function rerasterizeSelectedIcon(): Promise<void> {
  if (!selectedIcon) return

  const loader = selectedIcon.styles[currentStyle] ?? selectedIcon.styles.outlined ?? selectedIcon.styles.filled
  if (!loader) return

  const cacheKey = `${currentLibrary.id}:${selectedIcon.name}:${currentStyle}`
  let coveragePromise = coverageCache.get(cacheKey)
  if (!coveragePromise) {
    coveragePromise = loader().then(rasterizeSvgToCoverage)
    coverageCache.set(cacheKey, coveragePromise)
  }

  const coverage = await coveragePromise
  redraw(coverage)
}

function redraw(coverage: Float32Array): void {
  const settings = readSettings()
  let gridCoverage = computeGridCoverage(coverage, settings.gridSize)
  if (settings.maxLineWidth !== null) {
    gridCoverage = limitLineWidth(gridCoverage, settings.gridSize, settings.maxLineWidth)
  }
  selectedGridCoverage = gridCoverage

  renderDotMatrixToCanvas(largeCanvas, selectedGridCoverage, settings, LARGE_PREVIEW_SIZE)
  for (const [size, canvas] of Object.entries(smallCanvases)) {
    renderDotMatrixToCanvas(canvas, selectedGridCoverage, settings, Number(size))
  }
}

function onSettingsChanged(): void {
  void rerasterizeSelectedIcon()
}

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

function initCollapsibleSections(): void {
  for (const section of document.querySelectorAll<HTMLElement>('[data-section]')) {
    const header = section.querySelector<HTMLButtonElement>('.section-header')!
    const body = section.querySelector<HTMLElement>('.section-body')!
    header.addEventListener('click', () => {
      const collapsed = section.classList.toggle('collapsed')
      header.setAttribute('aria-expanded', String(!collapsed))
      body.hidden = collapsed
    })
  }
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
  onSettingsChanged()
}

function handleDownload(): void {
  if (!selectedIcon || !selectedGridCoverage) return

  const settings = readSettings()
  const filename = `${selectedIcon.name}-dot-matrix`

  if (downloadFormatSelect.value === 'png') {
    downloadPng(largeCanvas, `${filename}.png`)
  } else {
    const svg = buildDotMatrixSvg(selectedGridCoverage, settings, LARGE_PREVIEW_SIZE)
    downloadSvg(svg, `${filename}.svg`)
  }
}

function wireEvents(): void {
  librarySelect.addEventListener('change', () => {
    currentLibrary = libraries.find((library) => library.id === librarySelect.value) ?? libraries[0]
    updateLibraryChrome()
    selectedIcon = undefined
    void renderIconGrid()
  })

  styleSelect.addEventListener('change', () => {
    currentStyle = styleSelect.value as IconStyle
    void renderIconGrid()
    void rerasterizeSelectedIcon()
  })

  iconSearch.addEventListener('input', () => void renderIconGrid())

  bindRangeNumber(gridSizeInput, gridSizeNumber, onSettingsChanged)
  bindRangeNumber(smoothnessInput, smoothnessNumber, onSettingsChanged)
  bindRangeNumber(roundnessInput, roundnessNumber, onSettingsChanged)
  bindRangeNumber(spacingInput, spacingNumber, onSettingsChanged)
  bindRangeNumber(lineWidthInput, lineWidthNumber, onSettingsChanged)

  for (const button of lineWidthToggleButtons) {
    button.addEventListener('click', () => {
      lineWidthEnabled = button.dataset.lineWidthToggle === 'on'
      for (const option of lineWidthToggleButtons) {
        option.setAttribute('aria-pressed', String(option === button))
      }
      lineWidthRow.hidden = !lineWidthEnabled
      onSettingsChanged()
    })
  }

  primaryColorInput.addEventListener('input', () => syncColorInputs('picker'))
  primaryColorHexInput.addEventListener('input', () => syncColorInputs('hex'))

  downloadButton.addEventListener('click', handleDownload)
}

async function init(): Promise<void> {
  populateLibrarySelect()
  updateLibraryChrome()
  wireEvents()
  initCollapsibleSections()
  await renderIconGrid()

  const defaultIcon = currentLibrary.icons.find((icon) => icon.name === 'home') ?? currentLibrary.icons[0]
  if (defaultIcon) await selectIcon(defaultIcon)
}

void init()
