import { chromium } from 'playwright'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })

const errors = []
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`console: ${msg.text()}`)
})

await page.goto('http://localhost:5174/dot-matrix-studio/')
await page.waitForTimeout(1000)

// search for a distinct icon and select it
await page.fill('#icon-search', 'star')
await page.waitForTimeout(300)
await page.click('.icon-tile:first-of-type')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/dot-matrix-star.png' })

// change grid size slider to a higher resolution
await page.fill('#grid-size-number', '20')
await page.dispatchEvent('#grid-size-number', 'input')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/dot-matrix-grid20.png' })

// change roundness to 0 (sharp squares) and spacing to 0.5
await page.fill('#roundness-number', '0')
await page.dispatchEvent('#roundness-number', 'input')
await page.fill('#spacing-number', '0.5')
await page.dispatchEvent('#spacing-number', 'input')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/dot-matrix-square.png' })

// change color
await page.fill('#primary-color-hex', '#ff4d4d')
await page.dispatchEvent('#primary-color-hex', 'input')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/dot-matrix-color.png' })

// switch library to lucide
await page.selectOption('#library-select', 'lucide')
await page.waitForTimeout(300)
await page.fill('#icon-search', 'heart')
await page.waitForTimeout(300)
await page.click('.icon-tile:first-of-type')
await page.waitForTimeout(300)
await page.screenshot({ path: '/tmp/dot-matrix-lucide.png' })

console.log('ERRORS:', JSON.stringify(errors))

await browser.close()
