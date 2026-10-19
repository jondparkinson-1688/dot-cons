# Dot Matrix Studio

Turn a basic icon into a dot-matrix icon. Style, arrange, and export it.

**Live app:** https://jondparkinson-1688.github.io/dot-matrix-studio/

![Dot Matrix Studio screenshot](docs/screenshot.png)

## What it does

- **Pick an icon** from Material Symbols or Lucide and drop it onto an infinite canvas. Add as many as you like and arrange them on a snapping grid.
- **Select one icon or all of them** and edit together or individually — grid size, edge smoothness, dot shape, color, spacing, and more.
- **Choose a dot shape**: square, circle, diamond, polygon, star, plus, or a custom character/emoji — with corner rounding, independent width/height scale, rotation, and skew.
- **Keep thin strokes readable at coarse grid sizes** via connected-component-aware coverage normalization and optional max-line-width skeletonization, so details like a door cutout or an exclamation mark don't disappear or smear together.
- **Export** as PNG or SVG, with live previews at 16px/24px/40px to check how an icon reads at actual size.

## Tech

Vanilla TypeScript + Vite, no UI framework. No backend — it's a static site.

## Running locally

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

## Deployment

Pushes to `main` build and deploy automatically to GitHub Pages via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

## Icon libraries

- [Material Symbols](https://github.com/google/material-design-icons) — Apache-2.0, © Google
- [Lucide](https://lucide.dev/) — ISC, © Lucide Contributors
