# FOLIO — WP4: Yapay Zekâ Chat Paneli, Floating Toolbar ve Panel Etkileşimleri

## 1. Görev

WP1–WP3 aşamalarında oluşturulan Folio editörüne:

1. shadcn/ui AI Chat tabanlı Yapay Zekâ panelini,
2. Arc UI Selection Toolbar referanslı nesne üstü floating toolbar'ı,
3. Sekizli navigasyonun desteklenen gerçek panel etkileşimlerini

entegre et.

**Mevcut Folio tasarımını değiştirme.**

WP1 sonrası sağ üst yorum düğmesiyle açılan örnek yorum paneli [`UI-DECISIONS.md`](./UI-DECISIONS.md) kapsamında zaten arayüz kabuğuna eklenmiştir. Bu panel AI chat değildir. WP4'te geliştirilecek AI chat, sol Yapay Zekâ panelinde kalmalı; sağ yorum paneliyle ve ekip yorum servisiyle karıştırılmamalıdır. Yorum panelinin gerçek ekip verisi/persistence bağlantısı ayrıca servis ve host gerektirir.

Bu görev yeni bir arayüz tasarlamak değil, mevcut arayüze profesyonel etkileşim bileşenleri eklemektir.

## 2. Tasarım ve skill kuralları

`folio/.agents/skills/frontend-design/SKILL.md` dosyasını oku ve uygula.

Ayrıca:

- `folio/docs/DESIGN.md`
- Folio `tokens.css`
- Mevcut UI bileşenleri
- WP1 görsel karşılaştırma sonuçları

tasarımın kaynakları olacak.

Skill ilkelerini mevcut tasarımın dışına çıkmadan uygula.

## 3. AI Chat bileşeni

Referans:

https://ui.shadcn.com/docs/ai-elements/aria/chat

Bu referansı inceleyerek Folio'nun sol Yapay Zekâ paneline uyumlu hale getir.

### UI

- Sohbet mesaj akışı
- Kullanıcı/asistan mesajları
- Otomatik scroll
- Prompt input
- Dosya ekleme alanı
- Önerilen promptlar
- Hızlı aksiyonlar
- Mesaj yükleme ve hata durumları
- Erişilebilir klavye davranışı

### Folio görünümü

- Mevcut panel genişliğine uyumlu
- Beyaz yüzeyler
- Açık gri ikincil yüzeyler
- Pastel turuncu vurgu
- Yumuşak köşeler
- Minimal ikon kullanımı
- Mevcut tipografi

Chat tam ekran ayrı bir uygulamaya dönüşmesin.

Sol içerik paneli içinde kalsın.

### AI mimarisi

Aşağıdaki sorumlulukları birbirinden ayır:

```text
AI Chat UI
    ↓
AI Provider Adapter
    ↓
AI Action Planner
    ↓
EngineAdapter
    ↓
Rust Session
```

AI provider yapılandırılmamışsa sahte model yanıtı üretme.

İleride gerçek API anahtarları güvenli sunucu/host tarafında yönetilebilecek şekilde tasarla; gizli anahtarları frontend bundle'ına koyma.

### AI action planner

AI'nin belgeyi doğrudan değiştirmesine izin verme.

Yapılandırılmış, doğrulanabilir komut önerileri üretmeye uygun bir katman hazırla.

- Komut doğrulama
- Kullanıcı onayı
- Önizleme
- Uygulama
- Undo/redo
- Hata geri bildirimi

Toplu nesne ekleme işlemlerinde Rust adapter'ın batch API'sinden yararlanılabilsin.

Gerçek AI sağlayıcısı mevcut değilse provider katmanını açıkça yapılandırılmamış bırak; yalnızca çalışan UI ve entegrasyon sözleşmesini tamamla.

## 4. Floating selection toolbar

Referans:

https://uiarc.dev/components/blocks/selection-toolbar

Arc UI'nin genel etkileşim yaklaşımını referans al.

Önce lisans ve kullanım koşullarını doğrula.

Pro bileşeninin lisanslı kaynak kodu mevcut değilse kopyalama.

Gerekirse React + Floating UI/Radix bileşenleriyle Folio'ya özel uygulama oluştur.

### Konumlandırma

Toolbar:

- Seçili nesnenin üstünde açılacak.
- Seçim bounds'una bağlanacak.
- Nesne taşınınca takip edecek.
- Zoom/pan sırasında konumlanacak.
- Üstte alan yoksa alta geçecek.
- Viewport sınırlarından taşmayacak.
- Çoklu seçimde union bounds kullanacak.
- Resize handle'ları kapatmayacak.
- Açılır menülerde focus yönetimini koruyacak.

### Metin nesnesinde

- Font
- Boyut
- Bold/italic
- Metin rengi
- Hizalama
- Link
- Çoğalt
- Sil

### Şekil nesnesinde

- Dolgu rengi
- Kenarlık rengi
- Kenarlık kalınlığı
- Opaklık
- Öne/arkaya taşı
- Çoğalt
- Sil

### Medya nesnesinde

- Uygun boyut/yerleşim işlemleri
- Kırpma (motor destekliyorsa)
- Hizalama
- Çoğalt
- Sil

### Çoklu seçimde

- Grupla
- Hizala
- Dağıt
- Çoğalt
- Sil

Yalnızca mevcut Rust motorunun desteklediği komutları etkinleştir.

Desteklenmeyen kontrolleri gizle veya doğru disabled durumunda göster.

## 5. Motor bağlantısı

Selection state Rust Session projection'ından gelecek.

React ikinci seçim otoritesi oluşturmayacak.

Floating toolbar eylemleri:

`EngineAdapter.execute(...)`

üzerinden çalışacak.

Renk seçme, font boyutu veya drag gibi etkileşimlerde doğru undo transaction sınırları uygulanmalı.

Toolbar'ın tıklanması canvas seçimini istemeden kaldırmamalı.

Metin düzenleme sırasında focus/caret korunmalı.

## 6. Sekiz panel

Sol navigasyondaki bölümler:

1. Şablonlar
2. Tema
3. Bileşenler
4. Medya
5. Araçlar
6. Katmanlar
7. Eylemler
8. Yapay Zekâ

Mevcut Folio panel görünümlerini koru.

Her panel için motorun desteklediği işlevleri bağla.

### Örnekler

- Bileşenler: gerçek şekil/metin ekleme
- Katmanlar: gerçek seçim ve sıra
- Tema: gerçek desteklenen tema değişiklikleri
- Araçlar: motor tarafından desteklenen çizim komutları
- Eylemler: desteklenen animasyon/geçiş komutları
- Medya: desteklenen medya ekleme
- Şablonlar: gerçek şablon uygulama

Eksik motor komutlarını sahte UI davranışıyla taklit etme.

## 7. Performans ve erişilebilirlik

- Toolbar konumu pointer hareketlerinde gecikmemeli.
- Gereksiz React render döngüleri oluşmamalı.
- Zoom/pan durumları doğrulanmalı.
- AI Chat uzun mesaj geçmişinde akıcı kalmalı.
- Menü ve popup'lar klavyeyle erişilebilir olmalı.
- Reduced-motion tercihi desteklenmeli.
- 1366×768 ekranda toolbar ve chat doğru görünmeli.
- 1920×1080 ekranda çalışma alanı dengeli kalmalı.

## 8. Testler

- AI panel aç/kapat
- Mesaj gönderme UI durumları
- Provider yokken doğru disabled/hata davranışı
- Floating toolbar seçime bağlı görünürlük
- Nesne taşıma sırasında konum
- Zoom/pan testi
- Viewport kenarı testi
- Tekli/çoklu selection
- Text selection/focus
- Toolbar komutları ve undo/redo
- Panel geçişleri
- Canvas'a tıklandığında toolbar kapanması
- Klavye erişilebilirliği
- Görsel regresyon

## 9. Kabul kriterleri

- [ ] AI Chat, Folio temasına uyarlanmış.
- [ ] Gerçek shadcn/ui referansı doğrulanmış.
- [ ] Sahte AI yanıtları yok.
- [ ] AI provider ve action planner sınırları tanımlı.
- [ ] Floating toolbar seçili nesnenin üstünde açılıyor.
- [ ] Zoom/pan sırasında konumunu koruyor.
- [ ] Sadece gerçek motor komutlarını çalıştırıyor.
- [ ] React'te ikinci seçim otoritesi yok.
- [ ] Sekiz panelin desteklenen işlevleri motorla bağlı.
- [ ] Mevcut Folio görünümü korunuyor.
- [ ] `frontend-design` skill'i uygulanmış.
- [ ] Build/typecheck/test başarılı.
- [ ] Eski ATLAS ve DeckCraft değişmemiş.

## 10. Rapor

1. Kullanılan UI bileşenleri ve kaynakları.
2. AI Chat entegrasyon durumu.
3. Floating toolbar mimarisi.
4. Rust komutlarına bağlanan kontroller.
5. Henüz desteklenmeyen işlevler.
6. Görsel karşılaştırmalar.
7. Erişilebilirlik ve responsive sonuçları.
8. WP5 için kalan dosya/host bağımlılıkları.

**Son talimat: WP4'ü doğrudan uygula. Folio'nun mevcut tasarımını koruyarak AI Chat ve canvas üzerinde bağlamsal floating toolbar'ı tamamla.**
