# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/) — bump the first number for breaking/major redesigns, the second for new features, the third for fixes.

## [Unreleased]

## [1.0.0] — 2026-10-19

First tagged release.

### Added
- Infinite canvas: add multiple icons, drag them on a grid-snapped lattice, pan/zoom, fit-to-view, undo/redo
- Edit one icon or all of them at once
- Dot shape engine: square, circle, diamond, polygon, star, plus, or custom character/emoji, with corner rounding, width/height scale, rotation, skew, max line width, and edge smoothness
- Four icon libraries with fuzzy search: Material Symbols, Lucide, Ionicons, Tabler Icons
- PNG and SVG export, with actual-size previews at 16/24/40px
- Auto-deploy to GitHub Pages on push to `main`

### Fixed
- Exported SVGs now keep their full square canvas in vector tools like Framer, instead of being cropped to just the drawn dots
- Lucide icons rendered filled instead of outlined in the library picker
- The canvas tile's remove (×) button didn't respond to clicks on its icon graphic
- Dragging a tile behind another could permanently hide it; interacting with a tile now brings it to front
