# FOLIO — WP3: Rust/WASM Bağlantılı Gerçek Sunum Editörü

## 1. Görev

WP1'de oluşturulan React arayüzünü, WP2'de hazırlanan Rust/WASM EngineAdapter ile birleştir.

Bu aşamanın hedefi gerçek çalışan Folio sunum editörünün temelini oluşturmaktır.

**Yeni belge motoru yazma. Var olan DeckCraft Rust Session'ı kullan.**

## 2. Mimari kurallar

- Eski `atlas/` ve `deckcraft/` değiştirilmeyecek.
- Bütün değişiklikler `folio/` altında kalacak.
- Mevcut tasarım korunacak.
- Rust Session belgenin tek otoritesi olacak.
- React belge verisini doğrudan değiştirmeyecek.
- Her mutasyon EngineAdapter komutundan geçecek.
- Eski DocumentStore taşınmayacak.
- Sahte düzenleme davranışları olmayacak.
- `frontend-design` skill'i ve Folio tasarım token'ları korunacak.

## 3. Canvas mimarisi

Önerilen yapı:

```text
CanvasWorkspace
├── Rulers
├── CanvasViewport
│   ├── SlideRenderLayer
│   ├── SelectionOverlay
│   ├── InteractionLayer
│   └── CanvasControls
└── SlideFilmstrip
```

Rust motoru CPU tabanlı RGBA render sağlayacak.

Render akışı:

```text
Rust Session
    ↓
DeckCraft Render
    ↓
WASM RGBA Buffer
    ↓
TypeScript EngineAdapter
    ↓
Canvas 2D
```

Yeni WebGL/WebGPU renderer geliştirme.

Önce kanıtlanmış PoC render yaklaşımını kullan.

## 4. Canvas koordinat sistemi

Doğru şekilde yönet:

- Slide local coordinates
- Canvas viewport coordinates
- CSS pixels
- Device pixel ratio
- Zoom
- Pan
- Pointer coordinates

CSS ile slayt koordinatlarını karıştırma.

Pointer hit-test ve motor pointer event'leri tek dönüşüm sisteminden geçsin.

Zoom değişiminde hit-test bozulmasın.

## 5. Gerçek editör işlemleri

Rust Session üzerinden aşağıdakileri çalıştır:

### Slayt yönetimi

- Yeni sunum
- Slayt oluştur
- Slayt seç
- Slayt sil
- Slayt çoğalt
- Slayt sıralama

Her eylem DeckCraft'ın gerçek API desteğine göre uygulanmalı.

### Nesne yönetimi

- Metin ekle
- Şekil ekle
- Nesne seç
- Çoklu seçim
- Nesne taşı
- Resize
- Rotate (destekleniyorsa)
- Nesne sil
- Çoğalt
- Katman sırası değiştir (destekleniyorsa)

### Metin düzenleme

- Metin içeriği değiştirme
- Caret
- Selection
- Yazı tipi
- Font boyutu
- Temel biçimlendirme
- Türkçe karakterler
- Clipboard kısayolları

Tarayıcı `beforeinput` ve composition olaylarını Rust komutlarına doğru ilet.

OS seviyesinde IME desteğini doğrulamadan tamamlandı kabul etme.

### Undo/redo

- Ctrl+Z
- Ctrl+Y
- Ctrl+Shift+Z
- Undo/redo butonları
- History durumu

Her kullanıcı işlemi, motorun desteklediği doğru işlem sınırında undo geçmişine kaydedilmeli.

Sürükleme sırasında her pointer hareketini ayrı undo adımına dönüştürme.

## 6. Selection overlay

Seçim ve bounds bilgisi Rust Session'dan gelecek.

React sadece görselleştirecek.

- Tekli seçim
- Çoklu seçim
- Seçim sınırı
- Resize handle
- Seçim temizleme
- Canvas dışına çıkma
- Zoom/pan uyumluluğu

İkinci bir React selection otoritesi oluşturma.

WP4 floating toolbar bu seçim projection'ını kullanacak.

## 7. Slayt şeridi

WP1'de oluşturulan alt film şeridini gerçek motor verisine bağla.

- Gerçek slide listesi
- Gerçek aktif slide
- Slayt thumbnail render
- Ekle/sil/çoğalt
- Sıralama
- Yatay kaydırma

Slayt şeridi canvas'ın tam altında kalacak.

## 8. Performans

- Gereksiz tam belge snapshot alma.
- Render cache ve revision mantığını kullan.
- Pointer hareketleri sırasında gereksiz React rerender yapma.
- WASM byte buffer yaşam döngüsünü doğru yönet.
- DPR ve zoom değişiminde yeniden render davranışını kontrol et.
- Yüzlerce nesnede seçim ve taşıma gecikmesini ölç.
- WASM lineer bellek kapasitesi ile canlı heap ölçümünü ayır.

Batch insertion yaklaşımını toplu nesne oluşturma için koru.

## 9. UI komut bağlantıları

Üst menülerdeki desteklenen gerçek eylemleri motor komutlarına bağla:

- Yeni
- Geri al
- Yinele
- Kes
- Kopyala
- Yapıştır
- Çoğalt
- Sil
- Tümünü seç

Gerçek dosya kaydetme ve dışa aktarma WP5 kapsamında tamamlanacak.

Sol panellerden temel şekil/metin ekleme işlemleri motor komutlarına bağlansın.

Desteklenmeyen özellikler çalışıyormuş gibi sunulmasın.

## 10. Testler

En az aşağıdakileri doğrula:

- Yeni sunum oluşturma
- 10/50/100 slayt oluşturma ve render
- 100/500/1.000 nesneli testler
- Şekil ekleme/silme
- Pointer selection
- Drag/resize
- Zoom 50%/100%/200%
- Çoklu seçim
- Klavye kısayolları
- Undo/redo
- Türkçe metin
- Clipboard
- Film şeridi işlemleri
- 1366×768 ve 1920×1080 görünümleri

Gerçek tarayıcıda test et.

Sadece Rust unit test'lerinin geçmesi yeterli değil.

## 11. WP3 kabul kriterleri

- [ ] Folio React editörü Rust Session ile çalışıyor.
- [ ] Gerçek slaytlar oluşturuluyor.
- [ ] Nesneler Rust motoruyla ekleniyor.
- [ ] Render Canvas 2D üzerinden görüntüleniyor.
- [ ] Pointer selection çalışıyor.
- [ ] Drag/resize çalışıyor.
- [ ] Undo/redo gerçek motor üzerinden çalışıyor.
- [ ] Slayt şeridi motor verisiyle çalışıyor.
- [ ] React'te ikinci belge otoritesi yok.
- [ ] Zoom/pan/koordinat dönüşümleri tutarlı.
- [ ] Temel Türkçe metin senaryoları test edildi.
- [ ] Mevcut Folio tasarımı korunuyor.
- [ ] Build/typecheck/test başarılı.
- [ ] Eski ATLAS ve DeckCraft değişmemiş.

## 12. Rapor

1. Bağlanan Rust komutları.
2. Çalışan editör işlevleri.
3. Eksik/unsupported işlevler.
4. Render ve etkileşim performansı.
5. Bellek ölçümleri.
6. Ekran görüntüleri.
7. Test sonuçları.
8. WP4 için selection/command API hazırlığı.

**Son talimat: WP3'ü uygula ve Folio'yu gerçek Rust/WASM motoruyla temel düzenleme yapabilen çalışan bir editöre dönüştür.**