export type IconStyle = 'outlined' | 'filled'

export interface DotMatrixSettings {
  gridSize: number
  smoothnessShades: number
  dotRoundness: number
  dotSpacingPx: number
  primaryColor: string
  maxLineWidth: number | null
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
