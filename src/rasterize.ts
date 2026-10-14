export const SAMPLE_RESOLUTION = 480

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load icon SVG as an image'))
    image.src = url
  })
}

/** Rasterizes an SVG icon and returns its per-pixel alpha coverage (0..1) on a SAMPLE_RESOLUTION grid. */
export async function rasterizeSvgToCoverage(svgString: string): Promise<Float32Array> {
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)

  try {
    const image = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_RESOLUTION
    canvas.height = SAMPLE_RESOLUTION

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    ctx.clearRect(0, 0, SAMPLE_RESOLUTION, SAMPLE_RESOLUTION)
    ctx.drawImage(image, 0, 0, SAMPLE_RESOLUTION, SAMPLE_RESOLUTION)

    const { data } = ctx.getImageData(0, 0, SAMPLE_RESOLUTION, SAMPLE_RESOLUTION)
    const coverage = new Float32Array(SAMPLE_RESOLUTION * SAMPLE_RESOLUTION)
    for (let i = 0; i < coverage.length; i++) {
      coverage[i] = data[i * 4 + 3] / 255
    }
    return coverage
  } finally {
    URL.revokeObjectURL(url)
  }
}
