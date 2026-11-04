# Folio architecture

## WP1 application shell

`apps/editor/src/main.tsx` mounts one React root. `App.tsx` owns shell-only state: active panel, UI color mode, ruler visibility, filmstrip visibility, active preview slide and comments-panel visibility. Header, navigation, context panel, workspace, comments panel and `SlideFilmstrip` are Folio React components. There is no copied ATLAS `main.ts`, `DocumentStore`, portal mount, DOM `CustomEvent` command bridge or TypeScript document model.

The static slide and filmstrip are labelled previews. The filmstrip can locally reorder its three sample cards for UI review, but this state is not a presentation document and is not persisted. The comments panel uses sample messages and local `@Slayt` selection interactions; it is not a collaboration service. Commands that require the engine, collaboration, presentation playback, file operations, AI, layers and document actions remain disabled or clearly unavailable. See [`UI-DECISIONS.md`](./UI-DECISIONS.md) for the implemented UI behavior and prototype boundaries.

## Planned engine boundary

WP2 will add `packages/engine-adapter` and `crates/folio-wasm`; WP3 will connect projections and render frames to the shell. React should receive small Folio-owned view models and issue typed commands through that adapter. It must not import DeckCraft model types or own a second mutable presentation document. `EditorWorkspace` is the canvas host; `SlideFilmstrip` should receive the authoritative slide list/active slide through a Folio view model and dispatch reorder/selection commands through the adapter. Its current local sample order must be replaced, not promoted into document state. `WorkspacePanel` and `NavigationRail` remain presentation components.

## Planned host boundary

WP5 may add a host adapter for web and Electron file capabilities. UI components should not access Node.js or local filesystem APIs directly.
