export type IconStyle = 'outlined' | 'filled'

export type DotShape = 'square' | 'circle' | 'diamond' | 'polygon' | 'star' | 'plus' | 'text'

export interface DotMatrixSettings {
  gridSize: number
  smoothnessShades: number
  dotRoundness: number
  dotSpacingPx: number
  primaryColor: string
  maxLineWidth: number | null
  dotShape: DotShape
  polygonSides: number
  starPoints: number
  dotText: string
  scaleX: number
  scaleY: number
  rotationDeg: number
  skewDeg: number
}

export interface IconEntry {
  name: string
  label: string
  styles: Partial<Record<IconStyle, () => Promise<string>>>
}

export interface IconLibrary {
  id: string
  label: string
  license: string
  icons: IconEntry[]
}
