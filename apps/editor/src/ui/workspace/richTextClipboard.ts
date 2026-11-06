type RunProps = {
  font?: string
  size?: number
  bold?: boolean
  italic?: boolean
  underline?: string
  fill?: { kind: 'solid'; color: { base: { kind: 'rgb'; rgb: { r: number; g: number; b: number; a: number } }; mods: [] } }
}

type ClipboardRun = { text: string; props: RunProps }
export type RichTextClipboardPayload = { readonly text: string; readonly paragraphs: readonly { readonly runs: readonly ClipboardRun[] }[] }
export type RichTextParagraphStyle = { readonly runs: readonly { readonly text: string; readonly bold: boolean; readonly italic: boolean; readonly underline: boolean; readonly font?: string | null; readonly size?: number | null; readonly color?: string | null }[] }
export type FolioClipboardPayload = { readonly shapes: readonly unknown[]; readonly media: readonly { readonly id: number; readonly name: string; readonly contentType: string; readonly bytes: readonly number[]; readonly link?: string | null }[] }

const MAX_CLIPBOARD_CHARS = 100_000
const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'P', 'PRE'])
const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'HEAD', 'META', 'LINK', 'TITLE'])
const FOLIO_CLIPBOARD_MARKER = 'folio-clipboard-v1'

/** Convert untrusted clipboard HTML into allow-listed DeckCraft text runs. */
export function richTextPayloadFromClipboard(html: string, plainText: string): RichTextClipboardPayload | null {
  if (!html || html.length > MAX_CLIPBOARD_CHARS * 8) return null
  const root = new DOMParser().parseFromString(html, 'text/html').body
  const paragraphs: ClipboardRun[][] = [[]]
  let length = 0
  let foundFormatting = false

  const appendText = (value: string, props: RunProps) => {
    if (!value) return
    length += value.length
    if (length > MAX_CLIPBOARD_CHARS) throw new Error('Clipboard text exceeds the supported limit.')
    const lines = value.replace(/\r\n?/g, '\n').split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const text = lines[index]
      const current = paragraphs[paragraphs.length - 1]
      if (text) {
        const previous = current[current.length - 1]
        if (previous && JSON.stringify(previous.props) === JSON.stringify(props)) previous.text += text
        else current.push({ text, props: { ...props } })
      }
      if (index < lines.length - 1) paragraphs.push([])
    }
  }

  const visit = (node: Node, inherited: RunProps = {}) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendText(node.textContent ?? '', inherited)
      return
    }
    if (!(node instanceof Element) || IGNORED_TAGS.has(node.tagName)) return

    const tag = node.tagName
    const isBlock = BLOCK_TAGS.has(tag)
    if (isBlock && paragraphs.at(-1)?.length) paragraphs.push([])

    const props: RunProps = { ...inherited }
    const style = node.getAttribute('style') ?? ''
    const bold = tag === 'B' || tag === 'STRONG' || /font-weight\s*:\s*(?:bold|[6-9]00)/i.test(style)
    const italic = tag === 'I' || tag === 'EM' || /font-style\s*:\s*italic/i.test(style)
    const underline = tag === 'U' || /text-decoration(?:-line)?\s*:[^;]*underline/i.test(style)
    if (bold) props.bold = true
    if (italic) props.italic = true
    if (underline) props.underline = 'sng'

    const elementStyle = (node as HTMLElement).style
    const font = elementStyle.fontFamily || (tag === 'FONT' ? node.getAttribute('face') ?? '' : '')
    if (font) {
      const firstFont = font.split(',')[0].trim().replace(/^['"]|['"]$/g, '').slice(0, 128)
      if (firstFont && !/[;{}<>]/.test(firstFont)) props.font = firstFont
    }
    const rawSize = elementStyle.fontSize || (tag === 'FONT' ? node.getAttribute('size') ?? '' : '')
    const size = parseFontSize(rawSize)
    if (size) props.size = size
    const color = parseColor(elementStyle.color || (tag === 'FONT' ? node.getAttribute('color') ?? '' : ''))
    if (color) props.fill = { kind: 'solid', color: { base: { kind: 'rgb', rgb: { ...color, a: 255 } }, mods: [] } }
    if (bold || italic || underline || font || size || color) foundFormatting = true

    if (tag === 'BR') {
      paragraphs.push([])
      return
    }
    for (const child of Array.from(node.childNodes)) visit(child, props)
    if (isBlock && node.nextSibling && paragraphs.at(-1)?.length) paragraphs.push([])
  }

  try { for (const node of Array.from(root.childNodes)) visit(node) }
  catch { return null }

  while (paragraphs.length > 1 && paragraphs.at(-1)?.length === 0) paragraphs.pop()
  if (!foundFormatting || !paragraphs.some((paragraph) => paragraph.length)) return null

  const normalizedPlain = plainText.replace(/\r\n?/g, '\n').trim()
  const richPlain = paragraphs.map((paragraph) => paragraph.map((run) => run.text).join('')).join('\n').trim()
  if (!richPlain || (normalizedPlain && richPlain.replace(/\s+/g, ' ') !== normalizedPlain.replace(/\s+/g, ' '))) return null

  return { text: richPlain, paragraphs: paragraphs.map((runs) => ({ runs })) }
}

/** Serialize only a selected text range to safe inline HTML for the operating-system clipboard. */
export function richTextHtmlForSelection(paragraphs: readonly RichTextParagraphStyle[], text: string, selectionStart: number, selectionEnd: number): string | null {
  const start = Math.max(0, Math.min(selectionStart, selectionEnd))
  const end = Math.min(text.length, Math.max(selectionStart, selectionEnd))
  if (start === end || !paragraphs.length) return null
  const projectedText = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
  if (projectedText !== text) return null

  let documentOffset = 0
  const html = paragraphs.map((paragraph, paragraphIndex) => {
    const paragraphText = paragraph.runs.map((run) => run.text).join('')
    const paragraphStart = documentOffset
    const paragraphEnd = paragraphStart + paragraphText.length
    const from = Math.max(start, paragraphStart)
    const to = Math.min(end, paragraphEnd)
    let runOffset = paragraphStart
    const body = paragraph.runs.map((run) => {
      const runStart = runOffset
      const runEnd = runStart + run.text.length
      runOffset = runEnd
      const pieceStart = Math.max(from, runStart)
      const pieceEnd = Math.min(to, runEnd)
      if (pieceStart >= pieceEnd) return ''
      const styles: string[] = []
      if (run.bold) styles.push('font-weight:700')
      if (run.italic) styles.push('font-style:italic')
      if (run.underline) styles.push('text-decoration:underline')
      if (run.font && /^[\p{L}\p{N} _-]{1,128}$/u.test(run.font)) styles.push(`font-family:${run.font}`)
      if (typeof run.size === 'number' && Number.isFinite(run.size) && run.size >= 1 && run.size <= 400) styles.push(`font-size:${run.size}pt`)
      if (run.color && /^#[\da-f]{6}$/i.test(run.color)) styles.push(`color:${run.color}`)
      const value = escapeHtml(text.slice(pieceStart, pieceEnd))
      return styles.length ? `<span style="${styles.join(';')}">${value}</span>` : value
    }).join('')
    documentOffset = paragraphEnd + (paragraphIndex < paragraphs.length - 1 ? 1 : 0)
    return `<p>${body || (from < end && to === from ? '<br>' : '')}</p>`
  }).join('')
  return html ? `<meta charset="utf-8">${html}` : null
}

export function addFolioClipboardMarker(html: string, payload: FolioClipboardPayload): string | null {
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    if (!bytes.length || bytes.length > 16 * 1024 * 1024) return null
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    const encoded = btoa(binary)
    return `<meta name="${FOLIO_CLIPBOARD_MARKER}" content="${encoded}">${html || '<p>Folio object</p>'}`
  } catch {
    return null
  }
}

export function folioClipboardPayloadFromHtml(html: string): FolioClipboardPayload | null {
  if (!html || html.length > 24 * 1024 * 1024) return null
  try {
    const encoded = new DOMParser().parseFromString(html, 'text/html').querySelector(`meta[name="${FOLIO_CLIPBOARD_MARKER}"]`)?.getAttribute('content')
    if (!encoded || encoded.length > 23 * 1024 * 1024 || !/^[\da-z+/=]+$/i.test(encoded)) return null
    const binary = atob(encoded)
    if (binary.length > 16 * 1024 * 1024) return null
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<FolioClipboardPayload>
    if (!Array.isArray(value.shapes) || value.shapes.length === 0 || value.shapes.length > 1_000 || !Array.isArray(value.media) || value.media.length > 1_000) return null
    if (value.media.some((item) => !item || !Number.isSafeInteger(item.id) || typeof item.name !== 'string' || typeof item.contentType !== 'string' || !Array.isArray(item.bytes) || item.bytes.some((byte: unknown) => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255))) return null
    return value as FolioClipboardPayload
  } catch {
    return null
  }
}

/** Convert a validated rich clipboard payload into a centered DeckCraft text shape. */
export function richTextShapeFromClipboard(html: string, plainText: string, slideWidth: number, slideHeight: number): unknown | null {
  const rich = richTextPayloadFromClipboard(html, plainText)
  if (!rich) return null
  const lineCount = rich.paragraphs.length
  const longestLine = Math.max(...rich.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text.length).join('').length))
  const width = Math.min(slideWidth * 0.8, Math.max(180, Math.min(700, longestLine * 9)))
  const height = Math.min(slideHeight * 0.7, Math.max(48, lineCount * 36))
  return {
    name: 'Pasted text',
    kind: { type: 'shape' },
    geom: { kind: 'preset', name: 'rect' },
    xfrm: { x: (slideWidth - width) / 2, y: (slideHeight - height) / 2, w: width, h: height },
    fill: { kind: 'none' },
    textBox: true,
    text: {
      body: { autofit: { kind: 'none' }, wrap: true, insetL: 0, insetT: 0, insetR: 0, insetB: 0 },
      paragraphs: rich.paragraphs,
    },
  }
}

function parseFontSize(value: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px|pt)?\s*$/i.exec(value)
  if (!match) return null
  const amount = Number(match[1])
  const points = match[2]?.toLowerCase() === 'px' ? amount * 0.75 : amount
  return Number.isFinite(points) && points >= 1 && points <= 400 ? points : null
}

function parseColor(value: string): { r: number; g: number; b: number } | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(value.trim())
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join('') : hex[1]
    return { r: Number.parseInt(digits.slice(0, 2), 16), g: Number.parseInt(digits.slice(2, 4), 16), b: Number.parseInt(digits.slice(4, 6), 16) }
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i.exec(value.trim())
  if (!rgb) return null
  const channels = rgb.slice(1, 4).map(Number)
  if (channels.some((channel) => channel < 0 || channel > 255)) return null
  return { r: channels[0], g: channels[1], b: channels[2] }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}
