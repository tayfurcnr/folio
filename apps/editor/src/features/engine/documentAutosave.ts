const DATABASE_NAME = 'folio-editor-autosave'
const STORE_NAME = 'presentations'
const CURRENT_PRESENTATION = 'current'

type AutosaveRecord = { readonly key: string; readonly bytes?: ArrayBuffer; readonly documentId?: string; readonly title?: string; readonly updatedAt?: number }
type SharedOwnerRecord = { readonly key: string; readonly token: string }
export type SavedShareLink = { readonly documentId: string; readonly shareId: string; readonly role: 'edit' | 'comment' | 'view'; readonly token: string; readonly createdAt: number }
type SharedLinkRecord = SavedShareLink & { readonly key: string }

export type AutosavedDocument = { readonly bytes: Uint8Array; readonly documentId?: string; readonly title?: string; readonly updatedAt?: number }
export type RecentPresentation = { readonly documentId: string; readonly title: string; readonly updatedAt: number }

const documentKey = (documentId: string) => `document:${documentId}`
const ownerKey = (documentId: string) => `collaboration-owner:${documentId}`
const shareKey = (documentId: string, shareId: string) => `collaboration-link:${documentId}:${shareId}`

let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'))
  if (databasePromise) return databasePromise
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open local presentation storage.'))
    request.onblocked = () => reject(new Error('Local presentation storage is blocked by another tab.'))
  }).catch((error: unknown) => {
    databasePromise = null
    throw error
  })
  databasePromise = opening
  return opening
}

export async function loadAutosavedPresentation(): Promise<AutosavedDocument | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(CURRENT_PRESENTATION) as IDBRequest<AutosaveRecord | undefined>
    request.onsuccess = () => {
      const current = request.result
      if (!current) { resolve(null); return }
      const resolveRecord = (record: AutosaveRecord | undefined) => {
        const bytes = record?.bytes
        if (!record || !bytes) { resolve(null); return }
        resolve({ bytes: new Uint8Array(bytes), documentId: record.documentId ?? current.documentId,
          title: record.title ?? current.title, updatedAt: record.updatedAt ?? current.updatedAt })
      }
      if (current.bytes) { resolveRecord(current); return }
      if (!current.documentId) { resolveRecord(undefined); return }
      const archived = transaction.objectStore(STORE_NAME).get(documentKey(current.documentId)) as IDBRequest<AutosaveRecord | undefined>
      archived.onsuccess = () => resolveRecord(archived.result)
      archived.onerror = () => reject(archived.error ?? new Error('Could not read the current presentation snapshot.'))
    }
    request.onerror = () => reject(request.error ?? new Error('Could not read the local presentation.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Reading the local presentation was aborted.'))
  })
}

export async function loadRecentPresentation(documentId: string): Promise<AutosavedDocument | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(documentKey(documentId)) as IDBRequest<AutosaveRecord | undefined>
    request.onsuccess = () => {
      const record = request.result
      resolve(record?.bytes ? { bytes: new Uint8Array(record.bytes), documentId: record.documentId,
        title: record.title, updatedAt: record.updatedAt } : null)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not read the recent presentation.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Reading the recent presentation was aborted.'))
  })
}

export async function listRecentPresentations(): Promise<RecentPresentation[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<AutosaveRecord[]>
    request.onsuccess = () => resolve(request.result
      .filter((record) => record.key.startsWith('document:') && record.documentId)
      .map((record) => ({ documentId: record.documentId!, title: record.title || 'Sunum', updatedAt: record.updatedAt || 0 }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10))
    request.onerror = () => reject(request.error ?? new Error('Could not list recent presentations.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Listing recent presentations was aborted.'))
  })
}

export async function saveAutosavedPresentation(bytes: Uint8Array, documentId?: string, title = 'Sunum'): Promise<void> {
  const database = await openDatabase()
  const snapshot = bytes.slice().buffer
  const now = Date.now()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    const record = { key: CURRENT_PRESENTATION, ...(documentId ? { documentId, title, updatedAt: now } : { bytes: snapshot }) } satisfies AutosaveRecord
    store.put(record)
    if (documentId) store.put({ ...record, key: documentKey(documentId), bytes: snapshot })
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the local presentation.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving the local presentation was aborted.'))
  })
}

export async function saveSharedOwnerToken(documentId: string, token: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ key: ownerKey(documentId), token } satisfies SharedOwnerRecord)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the collaboration owner key.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving the collaboration owner key was aborted.'))
  })
}

export async function loadSharedOwnerToken(documentId: string): Promise<string | null> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).get(ownerKey(documentId)) as IDBRequest<SharedOwnerRecord | undefined>
    request.onsuccess = () => resolve(typeof request.result?.token === 'string' ? request.result.token : null)
    request.onerror = () => reject(request.error ?? new Error('Could not read the collaboration owner key.'))
  })
}

export async function saveSharedLink(link: SavedShareLink): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put({ ...link, key: shareKey(link.documentId, link.shareId) } satisfies SharedLinkRecord)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the collaboration link.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving the collaboration link was aborted.'))
  })
}

export async function listSharedLinks(documentId: string): Promise<SavedShareLink[]> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly')
    const request = transaction.objectStore(STORE_NAME).getAll() as IDBRequest<Array<SharedLinkRecord | AutosaveRecord | SharedOwnerRecord>>
    request.onsuccess = () => resolve(request.result
      .filter((record): record is SharedLinkRecord => record.key.startsWith(`collaboration-link:${documentId}:`))
      .map(({ documentId: id, shareId, role, token, createdAt }) => ({ documentId: id, shareId, role, token, createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt))
    request.onerror = () => reject(request.error ?? new Error('Could not list collaboration links.'))
  })
}

export async function removeSharedLink(documentId: string, shareId: string): Promise<void> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).delete(shareKey(documentId, shareId))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not remove the collaboration link.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Removing the collaboration link was aborted.'))
  })
}
