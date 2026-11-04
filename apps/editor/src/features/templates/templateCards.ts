/** Presentation-only metadata from the existing ATLAS template catalog; slide data is intentionally excluded. */
export type TemplateCard = {
  readonly id: string
  readonly title: string
  readonly category: string
  readonly description: string
  readonly tone: 'business' | 'marketing' | 'education' | 'report' | 'proposal' | 'creative'
  readonly slideCount: number
}

export const templateCards: readonly TemplateCard[] = [
  { id: 'business', title: 'Başlık Sunumu', category: 'İş', description: 'Kurumsal tanıtım ve ekip sunumu', tone: 'business', slideCount: 6 },
  { id: 'marketing', title: 'Pazarlama', category: 'Pazarlama', description: 'Kampanya ve büyüme planı', tone: 'marketing', slideCount: 6 },
  { id: 'education', title: 'Eğitim', category: 'Eğitim', description: 'Ders ve öğrenme yolculuğu', tone: 'education', slideCount: 6 },
  { id: 'report', title: 'Rapor', category: 'Rapor', description: 'Dönem sonuçları ve bulgular', tone: 'report', slideCount: 6 },
  { id: 'proposal', title: 'Teklif', category: 'Teklif', description: 'İhtiyaç, çözüm ve öneri', tone: 'proposal', slideCount: 6 },
  { id: 'creative', title: 'Yaratıcı', category: 'Kreatif', description: 'Fikir ve görsel anlatım', tone: 'creative', slideCount: 6 },
]
