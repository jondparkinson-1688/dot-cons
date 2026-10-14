import type { IconEntry, IconLibrary } from './types'

const materialOutlinedModules = import.meta.glob(
  '/node_modules/@material-symbols/svg-400/outlined/*.svg',
  { query: '?raw', import: 'default' },
) as Record<string, () => Promise<string>>

const lucideModules = import.meta.glob('/node_modules/lucide-static/icons/*.svg', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

function filenameFrom(path: string): string {
  return path.split('/').pop()!.replace(/\.svg$/, '')
}

function labelFrom(name: string): string {
  return name
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function buildMaterialSymbolsLibrary(): IconLibrary {
  const entries = new Map<string, IconEntry>()

  for (const [path, load] of Object.entries(materialOutlinedModules)) {
    const filename = filenameFrom(path)
    const isFilled = filename.endsWith('-fill')
    const name = isFilled ? filename.slice(0, -'-fill'.length) : filename

    const entry = entries.get(name) ?? { name, label: labelFrom(name), styles: {} }
    entry.styles[isFilled ? 'filled' : 'outlined'] = load
    entries.set(name, entry)
  }

  return {
    id: 'material-symbols',
    label: 'Material Symbols',
    license: 'Apache-2.0 — Google',
    icons: Array.from(entries.values()).sort((a, b) => a.name.localeCompare(b.name)),
  }
}

function buildLucideLibrary(): IconLibrary {
  const icons: IconEntry[] = Object.entries(lucideModules).map(([path, load]) => {
    const name = filenameFrom(path)
    return { name, label: labelFrom(name), styles: { outlined: load } }
  })

  return {
    id: 'lucide',
    label: 'Lucide',
    license: 'ISC — Lucide Contributors',
    icons: icons.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

let cachedLibraries: IconLibrary[] | undefined

export function getIconLibraries(): IconLibrary[] {
  if (!cachedLibraries) {
    cachedLibraries = [buildMaterialSymbolsLibrary(), buildLucideLibrary()]
  }
  return cachedLibraries
}
