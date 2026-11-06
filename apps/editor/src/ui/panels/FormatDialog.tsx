import { useState } from 'react'
import { Button } from '../components/Button'

type DialogKind = 'paragraph' | 'tabs' | 'font' | 'columns'
type TabStop = { pos: number; align: 'l' | 'ctr' | 'r' | 'dec' }

export function FormatDialog({ kind, params, t, onClose, onApply }: {
  readonly kind: DialogKind
  readonly params: Record<string, unknown>
  readonly t: (source: string) => string
  readonly onClose: () => void
  readonly onApply: (name: string, params: Record<string, unknown>) => void
}) {
  const [align, setAlign] = useState(String(params.align ?? 'left'))
  const [indentLeft, setIndentLeft] = useState(String(params.indentLeft ?? 0))
  const [indentRight, setIndentRight] = useState(String(params.indentRight ?? 0))
  const [special, setSpecial] = useState(String(params.special ?? 'none'))
  const [specialBy, setSpecialBy] = useState(String(params.specialBy ?? 0))
  const [spaceBefore, setSpaceBefore] = useState(String(params.spaceBefore ?? 0))
  const [spaceAfter, setSpaceAfter] = useState(String(params.spaceAfter ?? 0))
  const [lineKind, setLineKind] = useState(String(params.lineKind ?? 'multiple'))
  const [lineValue, setLineValue] = useState(String(params.lineValue ?? 1))
  const [defaultTab, setDefaultTab] = useState(String(params.defaultTab ?? 72))
  const [tabs, setTabs] = useState<TabStop[]>(Array.isArray(params.tabs) ? (params.tabs as TabStop[]) : [])
  const [newTab, setNewTab] = useState('72')
  const [newAlign, setNewAlign] = useState<TabStop['align']>('l')
  const [font, setFont] = useState(String(params.family ?? 'Arial'))
  const [fontSize, setFontSize] = useState(String(params.size ?? 18))
  const [bold, setBold] = useState(params.bold === true)
  const [italic, setItalic] = useState(params.italic === true)
  const [underline, setUnderline] = useState(String(params.underline ?? 'none'))
  const [strike, setStrike] = useState(String(params.strike ?? 'none'))
  const [baseline, setBaseline] = useState(String(params.baseline ?? 'none'))
  const [caps, setCaps] = useState(String(params.caps ?? 'none'))
  const [spacing, setSpacing] = useState(String(params.spacing ?? 0))
  const [color, setColor] = useState(typeof params.color === 'string' && /^#[0-9a-f]{6}$/i.test(params.color) ? params.color : '#202020')
  const [columnCount, setColumnCount] = useState(String(params.count ?? 1))
  const [columnSpacing, setColumnSpacing] = useState(String(params.spacing ?? 0))
  const title = kind === 'paragraph' ? t('Paragraf seçenekleri') : kind === 'tabs' ? t('Sekme durakları') : kind === 'font' ? t('Yazı tipi ayarları') : t('Metin sütunları')
  const apply = () => {
    if (kind === 'paragraph') onApply('format.paragraphDialog', { align, indentLeft: Number(indentLeft), indentRight: Number(indentRight), special, specialBy: Number(specialBy), spaceBefore: Number(spaceBefore), spaceAfter: Number(spaceAfter), ...(lineKind === 'exactly' ? { lineSpacingPt: Number(lineValue) } : { lineSpacing: Number(lineValue) }) })
    else if (kind === 'tabs') onApply('format.tabs', { set: tabs, defaultTab: Number(defaultTab) })
    else if (kind === 'font') onApply('format.fontDialog', { family: font, size: Number(fontSize), bold, italic, underline, strike, baseline, caps, spacing: Number(spacing), color })
    else onApply('format.columns', { count: Number(columnCount), spacing: Number(columnSpacing) })
  }
  return <div className="template-preview-modal format-dialog-backdrop" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="template-preview-modal__panel format-dialog">
      <header className="template-preview-modal__header"><div><strong>{title}</strong><span>{kind === 'paragraph' ? t('Seçili metnin hizasını ve aralıklarını düzenleyin.') : kind === 'tabs' ? t('Metin kutusundaki sekme duraklarını düzenleyin.') : kind === 'font' ? t('Seçili metnin karakter biçimini düzenleyin.') : t('Metni sütunlara bölün ve aralığı ayarlayın.')}</span></div><Button variant="ghost" size="icon" aria-label={t('Kapat')} onClick={onClose}>×</Button></header>
      {kind === 'paragraph' ? <div className="format-dialog__fields">
        <label>{t('Hizalama')}<select aria-label={t('Hizalama')} value={align} onChange={(event) => setAlign(event.currentTarget.value)}><option value="left">{t('Sol')}</option><option value="center">{t('Orta')}</option><option value="right">{t('Sağ')}</option><option value="justify">{t('Yasla')}</option><option value="distributed">{t('Dağıtılmış')}</option></select></label>
        <label>{t('Sol girinti (pt)')}<input aria-label={t('Sol girinti (pt)')} type="number" value={indentLeft} onChange={(event) => setIndentLeft(event.currentTarget.value)} /></label>
        <label>{t('Sağ girinti (pt)')}<input aria-label={t('Sağ girinti (pt)')} type="number" value={indentRight} onChange={(event) => setIndentRight(event.currentTarget.value)} /></label>
        <label>{t('Özel girinti')}<select aria-label={t('Özel girinti')} value={special} onChange={(event) => setSpecial(event.currentTarget.value)}><option value="none">{t('Yok')}</option><option value="first">{t('İlk satır')}</option><option value="hanging">{t('Asılı')}</option></select></label>
        <label>{t('Girinti miktarı (pt)')}<input aria-label={t('Girinti miktarı (pt)')} type="number" min="0" value={specialBy} onChange={(event) => setSpecialBy(event.currentTarget.value)} /></label>
        <label>{t('Önceki boşluk (pt)')}<input aria-label={t('Önceki boşluk (pt)')} type="number" value={spaceBefore} onChange={(event) => setSpaceBefore(event.currentTarget.value)} /></label>
        <label>{t('Sonraki boşluk (pt)')}<input aria-label={t('Sonraki boşluk (pt)')} type="number" value={spaceAfter} onChange={(event) => setSpaceAfter(event.currentTarget.value)} /></label>
        <label>{t('Satır aralığı türü')}<select aria-label={t('Satır aralığı türü')} value={lineKind} onChange={(event) => setLineKind(event.currentTarget.value)}><option value="multiple">{t('Katlı')}</option><option value="exactly">{t('Tam')}</option></select></label>
        <label>{t('Satır aralığı değeri')}<input aria-label={t('Satır aralığı değeri')} type="number" min="0.1" step="0.1" value={lineValue} onChange={(event) => setLineValue(event.currentTarget.value)} /></label>
      </div> : kind === 'tabs' ? <div className="format-dialog__fields">
        <label>{t('Varsayılan sekme aralığı (pt)')}<input aria-label={t('Varsayılan sekme aralığı (pt)')} type="number" min="1" value={defaultTab} onChange={(event) => setDefaultTab(event.currentTarget.value)} /></label>
        <div className="format-dialog__tab-list" aria-label={t('Sekme durakları')}>{tabs.map((tab, index) => <div key={`${tab.pos}-${index}`}><span>{tab.pos} pt · {t(({ l: 'Sol', ctr: 'Orta', r: 'Sağ', dec: 'Ondalık' } as const)[tab.align] ?? 'Sol')}</span><Button variant="ghost" size="sm" aria-label={`${t('Sekme durağını kaldır')} ${tab.pos}`} onClick={() => setTabs((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</Button></div>)}{tabs.length === 0 && <span>{t('Sekme durağı eklenmedi')}</span>}</div>
        <label>{t('Konum (pt)')}<input aria-label={t('Konum (pt)')} type="number" min="0" value={newTab} onChange={(event) => setNewTab(event.currentTarget.value)} /></label>
        <label>{t('Sekme hizalaması')}<select aria-label={t('Sekme hizalaması')} value={newAlign} onChange={(event) => setNewAlign(event.currentTarget.value as TabStop['align'])}><option value="l">{t('Sol')}</option><option value="ctr">{t('Orta')}</option><option value="r">{t('Sağ')}</option><option value="dec">{t('Ondalık')}</option></select></label>
        <Button variant="secondary" size="sm" onClick={() => { const pos = Number(newTab); if (Number.isFinite(pos) && pos >= 0) setTabs((current) => [...current.filter((tab) => tab.pos !== pos), { pos, align: newAlign }].sort((a, b) => a.pos - b.pos)) }}>{t('Sekme durağı ekle')}</Button><Button variant="ghost" size="sm" onClick={() => setTabs([])}>{t('Tümünü temizle')}</Button>
      </div> : kind === 'font' ? <div className="format-dialog__fields">
        <label>{t('Yazı tipi')}<input aria-label={t('Yazı tipi')} value={font} onChange={(event) => setFont(event.currentTarget.value)} /></label>
        <label>{t('Yazı boyutu')}<input aria-label={t('Yazı boyutu')} type="number" min="1" max="4000" step="0.5" value={fontSize} onChange={(event) => setFontSize(event.currentTarget.value)} /></label>
        <label>{t('Alt çizgi türü')}<select aria-label={t('Alt çizgi türü')} value={underline} onChange={(event) => setUnderline(event.currentTarget.value)}><option value="none">{t('Yok')}</option><option value="sng">{t('Tek')}</option><option value="dbl">{t('Çift')}</option><option value="heavy">{t('Kalın')}</option><option value="dotted">{t('Noktalı')}</option><option value="dash">{t('Kesikli')}</option><option value="wavy">{t('Dalgalı')}</option></select></label>
        <label>{t('Üstü çizili')}<select aria-label={t('Üstü çizili')} value={strike} onChange={(event) => setStrike(event.currentTarget.value)}><option value="none">{t('Yok')}</option><option value="sng">{t('Tek')}</option><option value="dbl">{t('Çift')}</option></select></label>
        <label>{t('Taban çizgisi')}<select aria-label={t('Taban çizgisi')} value={baseline} onChange={(event) => setBaseline(event.currentTarget.value)}><option value="none">{t('Normal')}</option><option value="super">{t('Üst simge')}</option><option value="sub">{t('Alt simge')}</option></select></label>
        <label>{t('Büyük harf biçimi')}<select aria-label={t('Büyük harf biçimi')} value={caps} onChange={(event) => setCaps(event.currentTarget.value)}><option value="none">{t('Normal')}</option><option value="small">{t('Küçük büyük harf')}</option><option value="all">{t('Tümü büyük harf')}</option></select></label>
        <label>{t('Karakter aralığı (pt)')}<input aria-label={t('Karakter aralığı (pt)')} type="number" min="-1584" max="1584" step="0.5" value={spacing} onChange={(event) => setSpacing(event.currentTarget.value)} /></label>
        <label>{t('Yazı rengi')}<input aria-label={t('Yazı rengi')} type="color" value={color} onChange={(event) => setColor(event.currentTarget.value)} /></label>
        <label className="format-dialog__check"><input aria-label={t('Kalın')} type="checkbox" checked={bold} onChange={(event) => setBold(event.currentTarget.checked)} />{t('Kalın')}</label>
        <label className="format-dialog__check"><input aria-label={t('İtalik')} type="checkbox" checked={italic} onChange={(event) => setItalic(event.currentTarget.checked)} />{t('İtalik')}</label>
      </div> : <div className="format-dialog__fields">
        <label>{t('Sütun sayısı')}<select aria-label={t('Sütun sayısı')} value={columnCount} onChange={(event) => setColumnCount(event.currentTarget.value)}>{Array.from({ length: 16 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>{t('Sütun aralığı (pt)')}<input aria-label={t('Sütun aralığı (pt)')} type="number" min="0" max="1584" value={columnSpacing} onChange={(event) => setColumnSpacing(event.currentTarget.value)} /></label>
      </div>}
      <footer className="template-preview-modal__footer"><span className="template-preview-modal__spacer" /><Button variant="secondary" size="sm" onClick={onClose}>{t('İptal')}</Button><Button variant="accent" size="sm" onClick={apply}>{t('Uygula')}</Button></footer>
    </section>
  </div>
}
