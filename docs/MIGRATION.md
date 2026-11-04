# WP1 migration notes

## Reused source material

- `atlas/apps/editor/src/ui/tokens.css` → `apps/editor/src/styles/tokens.css` (semantic Folio colors and layout dimensions).
- `atlas/apps/editor/src/ui/atlas-icons.svg` → `apps/editor/src/assets/atlas-icons.svg` (existing icon sprite, copied unchanged).
- `atlas/apps/editor/public/fonts/Inter-{Regular,Bold}.ttf` and `LICENSE-Inter.txt` → `apps/editor/public/fonts/` (copied unchanged).
- `atlas/apps/editor/src/ui/components/Button.tsx` and `atlas/apps/editor/src/ui/buttons.css` are copied byte-for-byte as the Folio shared Button implementation and interaction styles. The ATLAS `motion.create(Button)` rail wrapper and spring hover/tap behavior are carried in Folio's `NavigationRail.tsx`, with only the section order, Folio brand asset and panel callback adapted. The status bar's Notes, presentation, hand, zoom, fit and filmstrip controls use the shared Button variants. The small `Icon.tsx` wrapper remains Folio-local and reads the copied icon sprite.
- `folio/logo/folio_logo.svg` and `folio-icon.svg` remain in their original location and are imported by the new app for the header and compact brand mark/favicon.
- `folio/.agents/skills/frontend-design/` is a full copy of the local skill and its Apache-2.0 license.

## Excluded from WP1

The legacy `apps/editor/src/main.ts`, `DocumentStore`, document packages, TypeScript renderer, persistence, undo/redo, DOM event bridge and React portal mount are not copied. Rust/WASM, real document editing, real file operations, AI provider, floating selection toolbar and Electron belong to WP2–WP5.

## Known visual and behavior limits

The workspace starts with a static blank 16:9 slide. The filmstrip is a labelled preview only. Engine-dependent menu commands, share, comments, collaboration, presentation playback, slide insertion, hand/pan and panel actions are disabled. Rulers preserve ATLAS's 20 px rails and corner treatment and show restrained static ticks; tick labels are illustrative only and do not track canvas coordinates, zoom or pan until a viewport is connected. The existing ATLAS sprite does not include the exact WP1 `zap` or `hand` glyphs; the closest existing action glyph is used and the pan control uses its text label instead of introducing a new icon.
