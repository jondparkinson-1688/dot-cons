import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })

const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}\n${err.stack}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})

await page.goto('http://localhost:5174/dot-matrix-studio/')
await page.waitForTimeout(1000)

await page.fill('#icon-search', 'star')
await page.waitForTimeout(300)
await page.click('.icon-tile[title="Star"]')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/baseline-1-star.png' })

await page.click('[data-rail="grid"]')
await page.waitForTimeout(200)
const gridSizeInput = await page.$('#grid-size-input')
if (gridSizeInput) {
  await gridSizeInput.fill('18')
  await gridSizeInput.press('Enter')
}
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/baseline-2-gridsize.png' })

await page.click('[data-rail="style"]')
await page.waitForTimeout(200)
const roundnessInput = await page.$('#dot-roundness-input')
if (roundnessInput) {
  await roundnessInput.fill('50')
  await roundnessInput.press('Enter')
}
const spacingInput = await page.$('#dot-spacing-input')
if (spacingInput) {
  await spacingInput.fill('2')
  await spacingInput.press('Enter')
}
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/baseline-3-style.png' })

const colorInput = await page.$('#primary-color-input')
if (colorInput) {
  await colorInput.fill('#ff6600')
  await colorInput.press('Enter')
}
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/baseline-4-color.png' })

await page.click('[data-rail="library"]')
await page.waitForTimeout(200)
const librarySelect = await page.$('#icon-library-select')
if (librarySelect) {
  await librarySelect.selectOption({ label: 'Lucide' })
}
await page.waitForTimeout(300)
await page.fill('#icon-search', 'heart')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/baseline-5-lucide.png' })

console.log('ERRORS:', JSON.stringify(errors))
await browser.close()
