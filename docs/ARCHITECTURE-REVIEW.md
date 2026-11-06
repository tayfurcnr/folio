# Folio Architecture Review

## Current layout

The editor currently places the application shell and action wiring in `apps/editor/src/App.tsx`; the Rust Session boundary and UI projections live in `features/engine/editorEngine.ts`; canvas input, canvas overlays, zoom/pan, rulers and status controls live together in `ui/workspace/EditorWorkspace.tsx`; slide actions and thumbnails live in `ui/workspace/SlideFilmstrip.tsx`; and panel-specific UI, including the Library list, lives in `ui/panels/WorkspacePanel.tsx`. Shared visual controls and theme tokens are already separated under `ui/components` and `styles`.

The Rust/WASM adapter is the only TypeScript boundary to DeckCraft. The Rust Session owns document edits, selection, history and rendering. `App.tsx` currently owns short-lived browser UI state, including the Library's `File[]`, so imported media disappears on reload. There is no project/account identity in the current shell, so the application cannot honestly scope an asset library to a user or a project yet.

## WP4-ready boundaries

| Concern | Current location | Recommended boundary |
|---|---|---|
| Session commands, projections, render invalidation | `features/engine` | Keep here; Rust remains the sole document and selection authority. |
| Canvas input, viewport, selection overlays, rulers and grid | `ui/workspace/EditorWorkspace.tsx` | Extract only when a second canvas feature needs an independent lifecycle; avoid a broad move during WP3.5. |
| Slide list, drag reorder and thumbnails | `ui/workspace/SlideFilmstrip.tsx` | Keep as the existing focused component. |
| Browser media bytes, metadata and deduplication | no feature module | Add a small `features/media-library` IndexedDB service; keep presentation references and edits in Rust. |
| Library and other panel presentation | `ui/panels/WorkspacePanel.tsx` | Keep UI here; receive persisted asset metadata and handlers through props. |
| Header, menus and toolbar actions | `ui/header` and `ui/workspace` | Keep shared controls in `ui/components`; do not create a second button system. |

## Scope recommendation

Do not relocate existing working code just to populate `features/`. For WP3.5, limit structural additions to the media asset service and focused tests. Keep reusable canvas calculations local until they have more than one consumer. `App.tsx` is an integration composition root and currently owns too many action implementations; a later change can move cohesive action groups behind feature hooks, after WP3.5 has measured the interaction boundaries. Do not create empty `selection`, `slides`, `toolbar` or `ai` directories.

## Canva parity: shared documents and live collaboration

The editor now includes an optional collaboration service (`apps/collab-server`) with durable document snapshots, expiring/revocable bearer invite links, role checks, ordered operation storage, comments and presenter sessions. Browser IndexedDB autosave remains useful local recovery. The service has no user accounts or account-based ownership recovery; possession of a bearer invite link grants its role until revocation.

The shared-document implementation needs these contracts before the Share button can claim link collaboration:

| Boundary | Required behavior |
|---|---|
| Identity and access | Authenticated owner; revocable invite/link grants for view, comment and edit; permissions checked by the service on every read/write. |
| Document storage | Durable document identity and revision; validated PPTX snapshot import/export; binary media stored separately with document-scoped access. |
| Live edits | Ordered, acknowledged edit operations with reconnect/replay and conflict handling. Whole-document snapshot broadcasts are insufficient for simultaneous editing. DeckCraft remains the client document engine; the collaboration adapter translates ordered service operations into the engine boundary. |
| Comments and presence | Server-backed threads and resolution state; ephemeral collaborator identity, cursor and selection presence. These remain distinct from the Rust document model. |
| Failure behavior | Offline edits are queued or explicitly rejected; permission loss and stale revisions are visible; reconnect cannot silently replace newer work. |
| Verification | Two independent browser contexts against the real service: owner shares, viewer cannot edit, commenter can comment, editor changes appear in both sessions, concurrent edits converge or surface a recoverable conflict, revocation takes effect, reconnect replays changes. |

`scripts/collaboration-server-regression.mjs` verifies capability-token access, role checks, persistence/restart, ordered operations, comments, revocation and presenter sessions. `scripts/two-client-operation-regression.mjs` verifies operation propagation across independent browser contexts, reconnect after reload, comment sharing, stale revision rejection and role-limited editing. These checks establish the current service boundary, but they do not establish production identity/accounts, account-based document recovery, offline edit queues, or conflict-free concurrent text editing for every operation type.

`features/engine/documentOperations.ts` defines the transport-neutral operation envelope. `EditorEngine.subscribeDocumentOperations` publishes ordered document commands, grouped pointer gestures, keyboard/text edits, undo/redo, batch insertion and full-document replacement snapshots, each tagged with stable document identity and engine revisions. `applyRemoteOperation` validates document identity and the base revision, ignores duplicate operation IDs, applies supported actions without echoing them, and reports revision mismatches. The two-context and service regressions exercise this boundary against the local collaboration service; deployment-scale availability, backup/restore drills and broader simultaneous-edit conflict behavior remain open.

## Decisions for this implementation

- The Session continues to receive pointer and command input and remains the only writer of document geometry.
- Grid visibility and spacing are editor view preferences. If grid snapping is enabled, only pointer coordinates are quantized before they are sent to the Session; all resulting geometry is still calculated and stored by Rust.
- Media bytes are stored in browser IndexedDB, deduplicated by content digest, and passed to the Session only when the user inserts the asset. Until a user/project identity exists this is a local browser-profile library, not a shared user or project library. The stored `{id, name, mime, size, digest, blob}` record can later be packaged into a `.folio` archive without changing document authority.
- Rotation and resize are driven by DeckCraft's existing pointer hit-testing and `shape.rotate` command. React only draws handles from Rust projections.
- Overflow rendering is bounded by the visible stage and renderer pixel limits; it is not expanded without a viewport-derived bound.
