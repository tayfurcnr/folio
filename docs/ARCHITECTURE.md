# Folio architecture

## WP1 application shell

`apps/editor/src/main.tsx` mounts one React root. `App.tsx` owns shell-only state: active panel, UI color mode, ruler visibility and filmstrip visibility. Header, navigation, context panel and workspace are React components. There is no copied ATLAS `main.ts`, `DocumentStore`, portal mount, DOM `CustomEvent` command bridge or TypeScript document model.

The static slide and filmstrip in WP1 are labelled previews. They do not represent an editable document or persist data. Commands that require the engine, collaboration, comments, presentation playback, file operations, AI, layers and document actions remain disabled or clearly unavailable.

## Planned engine boundary

WP2 will add `packages/engine-adapter` and `crates/folio-wasm`; WP3 will connect projections and render frames to the shell. React should receive small Folio-owned view models and issue typed commands through that adapter. It must not import DeckCraft model types or own a second mutable presentation document. `EditorWorkspace` is the future canvas host; `WorkspacePanel` and `NavigationRail` remain presentation components.

## Planned host boundary

WP5 may add a host adapter for web and Electron file capabilities. UI components should not access Node.js or local filesystem APIs directly.
