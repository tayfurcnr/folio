import type { EngineCommand, KeyInput, PointerInput } from '@folio/engine-adapter'

export type DocumentOperationAction =
  | { readonly kind: 'commands'; readonly commands: readonly EngineCommand[] }
  | { readonly kind: 'pointer'; readonly inputs: readonly PointerInput[] }
  | { readonly kind: 'key'; readonly input: KeyInput }
  | { readonly kind: 'text'; readonly text: string; readonly mode: 'insert' | 'commit' }
  | { readonly kind: 'undo' | 'redo' }
  | { readonly kind: 'insert-shapes'; readonly shapes: readonly unknown[]; readonly media?: readonly unknown[] }
  | { readonly kind: 'replace-document'; readonly snapshot: Uint8Array | null }

/** A committed, ordered document action. The collaboration service will assign its global sequence. */
export interface DocumentOperation {
  readonly id: string
  readonly documentId: string
  readonly sequence: number
  readonly baseRevision: number
  readonly revision: number
  readonly action: DocumentOperationAction
}

export type DocumentOperationListener = (operation: DocumentOperation) => void
