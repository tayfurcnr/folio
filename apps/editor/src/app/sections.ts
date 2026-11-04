export const workspaceSections = [
  { id: 'templates', label: 'Şablonlar', icon: 'layout-template' },
  { id: 'theme', label: 'Tema', icon: 'palette' },
  { id: 'components', label: 'Bileşenler', icon: 'shapes' },
  { id: 'media', label: 'Medya', icon: 'images' },
  { id: 'tools', label: 'Araçlar', icon: 'paintbrush' },
  { id: 'layers', label: 'Katmanlar', icon: 'layers' },
  { id: 'actions', label: 'Eylemler', icon: 'fast-forward' },
  { id: 'assistant', label: 'Yapay Zekâ', icon: 'sparkles' },
] as const

export type WorkspaceSection = typeof workspaceSections[number]['id']
