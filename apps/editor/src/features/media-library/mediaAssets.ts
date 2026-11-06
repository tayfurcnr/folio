export type MediaAsset = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly size: number
  readonly file: File
}

type StoredMediaAsset = {
  readonly id: string
  readonly name: string
  readonly type: string
  readonly size: number
  readonly lastModified: number
  readonly blob: Blob
}

const databaseName = 'folio-media-library'
const storeName = 'assets'
let databasePromise: Promise<IDBDatabase> | undefined

function database(): Promise<IDBDatabase> {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Kütüphane deposu açılamadı.'))
  }).catch((error: unknown) => {
    databasePromise = undefined
    throw error
  })
  return databasePromise!
}

function asAsset(record: StoredMediaAsset): MediaAsset {
  return { id: record.id, name: record.name, type: record.type, size: record.size, file: new File([record.blob], record.name, { type: record.type, lastModified: record.lastModified }) }
}

export async function loadMediaAssets(): Promise<MediaAsset[]> {
  const db = await database()
  const records = await new Promise<StoredMediaAsset[]>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll()
    request.onsuccess = () => resolve(request.result as StoredMediaAsset[])
    request.onerror = () => reject(request.error ?? new Error('Kütüphane dosyaları okunamadı.'))
  })
  return records.sort((a, b) => a.name.localeCompare(b.name, 'tr')).map(asAsset)
}

export async function addMediaAssets(files: readonly File[]): Promise<MediaAsset[]> {
  const db = await database()
  const records = await Promise.all(files.map(async (file) => {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return { id, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, blob: file } satisfies StoredMediaAsset
  }))
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    records.forEach((record) => store.put(record))
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Kütüphane dosyaları kaydedilemedi.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Kütüphane kaydı iptal edildi.'))
  })
  return loadMediaAssets()
}

export async function removeMediaAsset(id: string): Promise<MediaAsset[]> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Kütüphane öğesi kaldırılamadı.'))
    transaction.onabort = () => reject(transaction.error ?? new Error('Kütüphane işlemi iptal edildi.'))
  })
  return loadMediaAssets()
}
