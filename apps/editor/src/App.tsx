import { useEffect, useState } from 'react'
import type { WorkspaceSection } from './app/sections'
import { EditorHeader } from './ui/header/EditorHeader'
import { NavigationRail } from './ui/navigation/NavigationRail'
import { WorkspacePanel } from './ui/panels/WorkspacePanel'
import { EditorWorkspace } from './ui/workspace/EditorWorkspace'
import { CommentsChatPanel } from './ui/panels/CommentsChatPanel'

export function App() {
  const [activeSection, setActiveSection] = useState<WorkspaceSection | null>('templates')
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light')
  const [rulersVisible, setRulersVisible] = useState(true)
  const [filmstripVisible, setFilmstripVisible] = useState(true)
  const [zoom, setZoom] = useState(60)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [activeSlide, setActiveSlide] = useState(1)
  const selectSection = (section: WorkspaceSection) => setActiveSection((active) => active === section ? null : section)
  useEffect(() => { document.documentElement.dataset.colorMode = colorMode }, [colorMode])

  return <main className={`editor-shell${activeSection ? '' : ' editor-shell--panel-closed'}`} data-color-mode={colorMode}>
    <EditorHeader colorMode={colorMode} rulersVisible={rulersVisible} commentsOpen={commentsOpen} onToggleComments={() => setCommentsOpen((open) => !open)} onColorModeChange={setColorMode} onToggleRulers={() => setRulersVisible((visible) => !visible)} />
    <NavigationRail active={activeSection} onSelect={selectSection} />
    {activeSection && <WorkspacePanel section={activeSection} />}
    <EditorWorkspace zoom={zoom} onZoomChange={setZoom} rulersVisible={rulersVisible} filmstripVisible={filmstripVisible} activeSlide={activeSlide} onSelectSlide={setActiveSlide} onToggleFilmstrip={() => setFilmstripVisible((visible) => !visible)} />
    {commentsOpen && <CommentsChatPanel activeSlide={activeSlide} onSelectSlide={setActiveSlide} onClose={() => setCommentsOpen(false)} />}
  </main>
}
