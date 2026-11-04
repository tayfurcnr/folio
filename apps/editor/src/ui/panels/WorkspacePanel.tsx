import { useState } from 'react'
import type { WorkspaceSection } from '../../app/sections'
import { workspaceSections } from '../../app/sections'
import { templateCards } from '../../features/templates/templateCards'
import { Icon, type IconName } from '../components/Icon'
import { Button } from '../components/Button'
import { CategoryTabs } from '../components/CategoryTabs'
import { PanelSearch } from '../components/PanelSearch'

type Props = { readonly section: WorkspaceSection }
const iconBySection = Object.fromEntries(workspaceSections.map((section) => [section.id, section.icon])) as Record<WorkspaceSection, IconName>
const panelCopy: Record<WorkspaceSection, { title: string; description: string }> = {
  templates: { title: 'Şablonlar', description: 'Sunumunuzun düzenini belirleyin.' },
  theme: { title: 'Tema', description: 'Renk ve yazı tipi seçimlerinizi yönetin.' },
  components: { title: 'Bileşenler', description: 'Slaytlarınız için içerik türlerine göz atın.' },
  media: { title: 'Kütüphane', description: 'Sunumunuzda kullanacağınız dosyalar.' },
  tools: { title: 'Araçlar', description: 'Slayt içeriği ekleme ve çizim araçları.' },
  layers: { title: 'Katmanlar', description: 'Slayttaki nesnelerin sırası ve görünürlüğü.' },
  actions: { title: 'Eylemler', description: 'Slayt geçişleri ve animasyonlar.' },
  assistant: { title: 'Yapay Zekâ', description: 'Sunumunuz üzerinde çalışmak için asistan.' },
}

export function WorkspacePanel({ section }: Props) {
  const copy = panelCopy[section]
  return <aside className="workspace-panel" aria-label={`${copy.title} paneli`}>
    <header className="panel-heading"><span className="panel-heading__icon"><Icon name={iconBySection[section]} /></span><div><h2>{copy.title}</h2><p>{copy.description}</p></div><Button variant="ghost" size="icon" className="panel-heading__more" aria-label="Daha fazla seçenek" title="Bu seçenek motor bağlantısıyla kullanılabilir olacak" disabled icon={<Icon name="ellipsis" />} /></header>
    <div className="panel-body"><PanelContent section={section} /></div>
  </aside>
}

function PanelContent({ section }: Props) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('Tümü')
  if (section === 'tools') return <ToolsPanel />
  if (section === 'assistant') return <AssistantPanel />
  if (section === 'templates') return <TemplatesPanel query={query} setQuery={setQuery} tab={tab} setTab={setTab} />
  if (section === 'media') return <LibraryPanel query={query} setQuery={setQuery} tabs={['Tümü', 'Görseller', 'Videolar', 'Ses', 'Tablolar', 'Belgeler']} tab={tab} setTab={setTab} empty="Kütüphanede henüz dosya yok." />
  if (section === 'components') return <ComponentsPanel query={query} setQuery={setQuery} />
  if (section === 'theme') return <ThemePanel />
  if (section === 'layers') return <UnavailablePanel icon="layers" title="Katman listesi kullanılamıyor" description="Katmanlar, sunum motoru bağlandığında burada listelenecek." />
  return <UnavailablePanel icon="fast-forward" title="Eylemler henüz bağlı değil" description="Animasyon ve geçiş kontrolleri motor desteği doğrulandığında açılacak." />
}

function TemplatesPanel({ query, setQuery, tab, setTab }: { readonly query: string; readonly setQuery: (value: string) => void; readonly tab: string; readonly setTab: (value: string) => void }) {
  const categories = ['Tümü', 'İş', 'Pazarlama', 'Eğitim', 'Rapor', 'Teklif', 'Kreatif']
  const [showCategories, setShowCategories] = useState(true)
  const normalizedQuery = query.trim().toLocaleLowerCase('tr-TR')
  const filtered = templateCards.filter((item) => (tab === 'Tümü' || item.category === tab)
    && `${item.title} ${item.category} ${item.description}`.toLocaleLowerCase('tr-TR').includes(normalizedQuery))
  return <>
    <PanelSearch value={query} onChange={setQuery} placeholder="Şablonlarda ara…" ariaLabel="Şablonlarda ara" filter={{ ariaLabel: 'Şablon kategorilerini göster veya gizle', expanded: showCategories, title: 'Kategorileri göster veya gizle', onToggle: () => setShowCategories((visible) => !visible) }} />
    {showCategories && <CategoryTabs className="template-panel__categories" label="Şablon kategorisi" value={tab} onChange={setTab} items={categories.map((label) => ({ value: label, label }))} />}
    <h3 className="template-section-title"><Icon name="star" /> Öne çıkan şablonlar</h3>
    <div className="template-grid">{filtered.map((item) => <article className="template-preview-card" key={item.id}>
      <div className={`template-preview-art template-preview-art--${item.tone}`} aria-label={`${item.title} için statik tasarım önizlemesi`}>
        <span className="template-preview-art__title" /><span className="template-preview-art__line" /><span className="template-preview-art__block" /><span className="template-preview-art__accent" />
      </div>
      <div className="template-preview-card__copy"><div><strong>{item.title}</strong><span>{item.category} · {item.slideCount} slayt</span></div><Button variant="secondary" size="sm" disabled className="template-preview-card__add" aria-label={`${item.title} şablonunu ekle`} title="Şablon ekleme motor bağlantısını bekliyor">Ekle</Button></div>
    </article>)}</div>
    {filtered.length === 0 && <p className="template-empty">Bu aramayla eşleşen şablon bulunamadı.</p>}
    <p className="panel-note">Şablonlar mevcut Folio kataloğundan gösterilir. Sunuma ekleme motor bağlantısını bekliyor.</p>
  </>
}

function LibraryPanel({ query, setQuery, tabs, tab, setTab, empty }: { readonly query: string; readonly setQuery: (value: string) => void; readonly tabs: string[]; readonly tab: string; readonly setTab: (value: string) => void; readonly empty: string }) {
  const [showCategories, setShowCategories] = useState(true)
  return <><PanelSearch value={query} onChange={setQuery} placeholder="Kütüphanede ara…" ariaLabel="Kütüphanede ara" disabled filter={{ ariaLabel: 'Kütüphane türü filtrelerini göster veya gizle', expanded: showCategories, title: 'Tür filtrelerini göster veya gizle', onToggle: () => setShowCategories((visible) => !visible) }} />{showCategories && <CategoryTabs className="library-panel__categories" label="Kütüphane kategorisi" value={tab} onChange={setTab} items={tabs.map((label) => ({ value: label, label }))} />}<UnavailablePanel icon="search" title={empty} description="Bu görünüm yalnızca arayüz önizlemesidir; henüz dosya veya belge verisi yüklenmiyor." /></>
}

function ToolsPanel() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [showCategories, setShowCategories] = useState(true)
  const groups = [
    { icon: 'paintbrush' as const, title: 'Çizim araçları', description: 'Kalem, işaretleyici, fosforlu kalem ve silgi', category: 'draw' },
    { icon: 'shapes' as const, title: 'Şekiller', description: 'Temel şekiller ve serbest çizim', category: 'visual' },
    { icon: 'chevron-right' as const, title: 'Çizgiler', description: 'Çizgi ve bağlantılar', category: 'visual' },
    { icon: 'type' as const, title: 'Denklem ve sembol', description: 'Metin, simge ve matematik', category: 'text' },
    { icon: 'star' as const, title: 'WordArt ve SmartArt', description: 'Görsel metin ve diyagramlar', category: 'visual' },
    { icon: 'table' as const, title: 'Tablolar', description: 'Tablo ve veri düzenleri', category: 'data' },
  ]
  const categories = [{ value: 'all', label: 'Tümü' }, { value: 'text', label: 'Metin' }, { value: 'visual', label: 'Görsel' }, { value: 'data', label: 'Veri' }, { value: 'draw', label: 'Çizim' }]
  const filteredGroups = groups.filter((group) => (category === 'all' || group.category === category) && `${group.title} ${group.description}`.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')))
  const quickTools: [IconName, string][] = [['type', 'Metin'], ['image', 'Görsel'], ['video', 'Video'], ['chart-column', 'Grafik'], ['table', 'Tablo'], ['sticky-note', 'Not']]
  return <div className="tools-panel-content">
    <PanelSearch value={query} onChange={setQuery} placeholder="Araçlarda ara…" ariaLabel="Araçlarda ara" filter={{ ariaLabel: 'Araç kategorilerini göster veya gizle', expanded: showCategories, title: 'Kategorileri göster veya gizle', onToggle: () => setShowCategories((visible) => !visible) }} />
    {showCategories && <CategoryTabs className="tools-panel__categories" label="Araç kategorisi" value={category} onChange={setCategory} items={categories} />}
    <div className="tools-panel-quick" role="group" aria-label="Hızlı araçlar">
      {quickTools.map(([icon, label]) => <Button variant="secondary" size="md" className="tools-panel-quick__button" iconEffect="shake" disabled key={label} title={`${label} ekleme motor bağlantısını bekliyor`} icon={<Icon name={icon} />}><span>{label}</span></Button>)}
    </div>
    <div className="tool-groups">{filteredGroups.map((group) => <details className="tool-group" key={group.title}><summary><Icon name={group.icon} /><span>{group.title}</span><Icon name="chevron-right" className="tool-group__chevron" /></summary><div className="tool-group__detail"><p>{group.description}</p><span>Motor bağlantısı bekleniyor</span></div></details>)}{filteredGroups.length === 0 && <p className="panel-note">“{query}” için araç bulunamadı.</p>}</div>
  </div>
}

function ComponentsPanel({ query, setQuery }: { readonly query: string; readonly setQuery: (value: string) => void }) {
  const categories = [['type', 'Metin'], ['shapes', 'Şekiller'], ['table', 'Tablolar'], ['chart-column', 'Grafikler'], ['star', 'İkonlar'], ['layout-template', 'Diyagramlar']] as const
  const [category, setCategory] = useState('all')
  const [showCategories, setShowCategories] = useState(true)
  const filtered = categories.filter(([icon]) => category === 'all' || icon === category).filter(([, label]) => label.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')))
  return <><PanelSearch value={query} onChange={setQuery} placeholder="Bileşen ara…" ariaLabel="Bileşen ara" filter={{ ariaLabel: 'Bileşen kategorilerini göster veya gizle', expanded: showCategories, title: 'Kategorileri göster veya gizle', onToggle: () => setShowCategories((visible) => !visible) }} />{showCategories && <CategoryTabs className="component-panel__categories" label="Bileşen kategorisi" value={category} onChange={setCategory} items={[{ value: 'all', label: 'Tümü' }, ...categories.map(([icon, label]) => ({ value: icon, label }))]} />}<div className="component-categories">{filtered.map(([icon, label]) => <Button variant="secondary" size="md" key={label} className="component-category" disabled title="Bileşen ekleme motor bağlantısını bekliyor" icon={<Icon name={icon} />}><span>{label}</span><Icon name="chevron-right" className="component-categories__arrow" /></Button>)}</div><p className="panel-note">Bileşen ekleme, motor bağlantısından sonra kullanılabilir.</p></>
}

function ThemePanel() {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('all')
  const [showCategories, setShowCategories] = useState(true)
  const tabs = [{ value: 'all', label: 'Tümü' }, { value: 'colors', label: 'Renkler' }, { value: 'fonts', label: 'Yazı tipleri' }, { value: 'style', label: 'Stil' }]
  const palettes = [['Coral', '#ff6f3c', '#1f2a37', '#fad9cc', '#f4f5f7'], ['Sage', '#c8d7cc', '#52645a', '#e9e7e2', '#faf8f4'], ['Lavender', '#d8d4ee', '#514e6c', '#fce8df', '#f4f5f7']]
  const filteredPalettes = palettes.filter(([name]) => name!.toLocaleLowerCase('tr-TR').includes(query.trim().toLocaleLowerCase('tr-TR')))
  return <>
    <PanelSearch value={query} onChange={setQuery} placeholder="Temalarda ara…" ariaLabel="Temalarda ara" filter={{ ariaLabel: 'Tema kategorilerini göster veya gizle', expanded: showCategories, title: 'Kategorileri göster veya gizle', onToggle: () => setShowCategories((visible) => !visible) }} />
    {showCategories && <CategoryTabs className="theme-panel__categories" label="Tema kategorisi" value={tab} onChange={setTab} items={tabs} />}
    {tab === 'all' || tab === 'colors' ? <><h3 className="section-title">Renk paletleri</h3><div className="palette-list">{filteredPalettes.map(([name, ...colors]) => <Button variant="secondary" size="sm" className="palette-option" disabled key={name} title="Palet seçimi motor bağlantısını bekliyor"><span>{name}</span><span className="palette-swatches">{colors.map((color) => <i key={color} style={{ background: color }} />)}</span></Button>)}</div>{filteredPalettes.length === 0 && <p className="panel-note">“{query}” için tema bulunamadı.</p>}</> : <UnavailablePanel icon={tab === 'fonts' ? 'type' : 'palette'} title={`${tabs.find((item) => item.value === tab)?.label} ayarları bağlı değil`} description="Bu alan sunum motoru bağlandığında kullanılabilir olacak." />}
    <p className="panel-note">Tema uygulama belge içeriğini değiştirir; motor bağlandığında kullanılabilir olur.</p>
  </>
}

function AssistantPanel() {
  return <div className="assistant-panel"><div className="assistant-panel__empty"><span className="assistant-mark"><Icon name="sparkles" /></span><h3>Sunumunuzda birlikte çalışalım</h3><p>Yapay zekâ bağlantısı yapılandırılmadı. Bu panel hazır olduğunda istek ve yanıtlar burada görünür.</p></div><div className="assistant-suggestions"><h3>Örnek istekler</h3>{['Sunum taslağı oluştur', 'Metni iyileştir', 'Tasarımı düzenle', 'Sunumu özetle'].map((label) => <Button variant="secondary" size="sm" disabled key={label} className="assistant-suggestion" title="Yapay zekâ bağlantısı bekleniyor">{label}<Icon name="chevron-right" /></Button>)}</div><label className="assistant-composer"><textarea rows={3} disabled placeholder="Bir istek yazın…" /><div><Button variant="ghost" size="icon" disabled className="assistant-composer__control" aria-label="Dosya ekle" title="Dosya ekleme henüz kullanılamıyor" icon={<Icon name="plus" />} /><span>Bağlantı yok</span><Button variant="accent" size="icon" disabled className="assistant-composer__send" aria-label="Gönder" title="Yapay zekâ bağlantısı bekleniyor" icon={<Icon name="play" />} /></div></label></div>
}

function UnavailablePanel({ icon, title, description }: { readonly icon: IconName; readonly title: string; readonly description: string }) {
  return <div className="empty-panel"><span><Icon name={icon} /></span><h3>{title}</h3><p>{description}</p></div>
}
