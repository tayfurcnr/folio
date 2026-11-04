import logoUrl from '../../../../../logo/folio_logo.svg?url'
import appIconUrl from '../../../../../logo/folio-icon.svg?url'
import { Icon } from '../components/Icon'
import { Button } from '../components/Button'
import { EditorMenus } from './EditorMenus'

type Props = { readonly colorMode: 'light' | 'dark'; readonly rulersVisible: boolean; readonly onColorModeChange: (mode: 'light' | 'dark') => void; readonly onToggleRulers: () => void }

export function EditorHeader({ colorMode, rulersVisible, onColorModeChange, onToggleRulers }: Props) {
  return <header className="topbar">
    <div className="topbar__left">
      <a className="brand" href="#editor" aria-label="Folio editör ana sayfa">
        <img className="brand__full" src={logoUrl} alt="Folio" />
        <img className="brand__icon" src={appIconUrl} alt="" />
      </a>
      <EditorMenus colorMode={colorMode} rulersVisible={rulersVisible} onColorModeChange={onColorModeChange} onToggleRulers={onToggleRulers} />
      <div className="topbar__history" role="group" aria-label="Geri al ve ileri al">
        <Button variant="secondary" size="icon" className="topbar__history-button topbar__history-button--undo" disabled aria-label="Geri al kullanılamıyor" title="Geri alma motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="undo-2" />} />
        <Button variant="secondary" size="icon" className="topbar__history-button topbar__history-button--redo" disabled aria-label="İleri al kullanılamıyor" title="İleri alma motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="redo-2" />} />
      </div>
      <div className="topbar__document">
      <span className="topbar__document-separator" aria-hidden="true" />
      <div className="topbar__title" aria-label="Sunum adı: Yapay Zeka ile Etkili Sunumlar" title="Sunum adı">
        <Icon name="file" /><span>Yapay Zeka ile Etkili Sunumlar</span>
      </div>
      <Button variant="ghost" size="icon" className="topbar__rename" disabled aria-label="Sunum adını değiştirme motor bağlantısını bekliyor" title="Sunum adı düzenleme motor bağlantısıyla kullanılabilir olacak" icon={<Icon name="pencil" />} />
      </div>
    </div>
    <div className="topbar__right">
      <Button variant="secondary" size="sm" className="collaborators" aria-label="Ekip iş birliği henüz kullanılabilir değil" title="Ekip iş birliği henüz kullanılabilir değil" disabled icon={<Icon name="users-round" />}><span>Ekip</span></Button>
      <Button variant="secondary" size="icon" className="topbar__icon-button" disabled aria-label="Yorumlar kullanılamıyor" title="Yorumlar henüz kullanılabilir değil" icon={<Icon name="message-circle" />} />
      <Button variant="secondary" size="sm" className="topbar__share" disabled icon={<Icon name="share-2" />}>Paylaş</Button>
      <Button variant="accent" size="sm" className="topbar__present" disabled icon={<Icon name="play" />}>Sunumu Yap</Button>
    </div>
  </header>
}
