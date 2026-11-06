export type DocumentCommentReply = {
  readonly id: string
  readonly author: string
  readonly initials: string
  readonly time: string
  readonly text: string
}

export type DocumentComment = {
  readonly id: string
  readonly author: string
  readonly initials: string
  readonly time: string
  readonly text: string
  readonly slideId: string
  readonly slideIndex?: number
  readonly shapeId?: string
  readonly shapeName?: string
  readonly replies?: readonly DocumentCommentReply[]
  readonly resolved?: boolean
}

const DATABASE_NAME = 'folio-document-comments'
const STORE_NAME = 'comments'
let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'))
  if (databasePromise) return databasePromise
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'documentKey' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local comment storage.'))
    request.onblocked = () => reject(new Error('Local comment storage is blocked by another tab.'))
  }).catch((error: unknown) => { databasePromise = null; throw error })
  databasePromise = opening
  return opening
}

export function commentDocumentKey(title: string, slides: readonly { id: string; title: string }[]): string {
  // Legacy key retained to migrate comment storage for autosaves made before document IDs existed.
  // New autosaves persist a UUID and do not depend on mutable presentation or slide titles.
  return `${title.trim()}\u0000${slides.length}\u0000${slides.map((slide) => slide.title).join('\u0001')}`
}

export async function loadDocumentComments(documentKey: string): Promise<readonly DocumentComment[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(documentKey)
    request.onsuccess = () => resolve((request.result?.comments as DocumentComment[] | undefined) ?? [])
    request.onerror = () => reject(request.error ?? new Error('Could not read local comments.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Reading local comments was aborted.'))
  })
}

export async function saveDocumentComments(documentKey: string, comments: readonly DocumentComment[]): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ documentKey, comments })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save local comments.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving local comments was aborted.'))
  })
}
