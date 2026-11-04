# FOLIO — WP2: DeckCraft Rust/WASM Adapter ve Motor Altyapısı

## 1. Görev

WP1 kapsamında oluşturulmuş yeni `ATLAS/folio/` projesine DeckCraft Rust/WASM motor altyapısını entegre et.

**Bu aşamada gerçek canvas editörü geliştirme.** Önce motorun sağlam, tip güvenli ve test edilebilir bir TypeScript API üzerinden kullanılmasını sağla.

WP1'in tamamlanmış ve doğrulanmış çıktısını başlangıç noktası kabul et. Mevcut proje yapısını incelemeden dosyaların üzerine yazma.

## 2. Kesin kurallar

- `ATLAS/atlas/` değiştirilmeyecek.
- `ATLAS/deckcraft/` değiştirilmeyecek.
- Bütün yeni kod yalnızca `ATLAS/folio/` altında yazılacak.
- Mevcut çalışan `folio-wasm` PoC temel alınacak.
- DeckCraft Rust motoru yeniden yazılmayacak.
- DeckCraft kaynak kodu Folio'ya kopyalanmayacak.
- Eski TypeScript DocumentStore kullanılmayacak.
- React UI, Rust Session'a doğrudan erişmeyecek.
- WP1 tasarımı ve React bileşenleri değiştirilmeden korunacak.
- `frontend-design` skill'i projede korunacak; ancak bu pakette UI geliştirmesi öncelik olmayacak.

## 3. PoC kaynakları

Önce aşağıdaki kaynakları incele:

`ATLAS/deckcraft/poc/folio-wasm/`

Özellikle:

- `Cargo.toml`
- `Cargo.lock`
- `src/lib.rs`
- `web/smoke.js`
- `web/batch-smoke.js`
- `web/memory-smoke.js`
- `scripts/verify.sh`
- `scripts/verify-electron.sh`
- `RESULTS.md`
- `BATCH-RESULTS.md`
- `MEMORY-INVESTIGATION.md`
- `STAGE-3-GO-NO-GO.md`

Daha önce kanıtlanmış işlevleri yeniden uygulamak yerine mevcut kodu üretime uygun şekilde uyarlayarak kullan.

## 4. Rust adapter

Önerilen konum:

`folio/crates/folio-wasm/`

Mevcut PoC'den şu özellikleri taşı:

- Engine/session oluşturma
- Session yaşam döngüsü
- Komut çalıştırma
- Pointer olayları
- Klavye olayları
- Render
- Snapshot
- Undo/redo
- PPTX import/export
- Batch insertion

Üretim API'sini oluştururken PoC'ye ait tanılama işlevlerini ayrı tut.

Örneğin:

- Bellek tanılama
- Benchmark fonksiyonları
- Test-only helper'lar
- Font coverage inceleme araçları

Bunlar gerekirse test build'lerinde kullanılabilir ancak varsayılan üretim API'sine dahil edilmemeli.

## 5. Cargo bağımlılıkları

DeckCraft için Cargo Git dependency kullanılacak.

İlk sabit commit:

`19dceffd0bf3cbc79f9aaaf23fe3e05932fb434d`

Mevcut PoC'deki `krilla` patch ve lockfile kararlarını kontrol ederek koru.

- Upstream otomatik güncellenmeyecek.
- `Cargo.lock` sürüm kontrolünde tutulacak.
- DeckCraft kaynakları değiştirilmeyecek.
- Fork veya submodule oluşturulmayacak.
- Var olan PoC derleme davranışı korunacak.

## 6. TypeScript engine adapter

Önerilen paket:

`folio/packages/engine-adapter/`

Bu paket WASM modülüne erişimin tek noktası olacak.

React bileşenleri doğrudan wasm-bindgen çıktısını import etmeyecek.

Adapter için tip güvenli API oluştur.

Önerilen temel işlemler:

```ts
interface EngineAdapter {
  initialize(): Promise<EngineInfo>;

  createSession(): Promise<SessionId>;
  closeSession(id: SessionId): void;

  execute(
    id: SessionId,
    command: EngineCommand
  ): Promise<CommandResult>;

  pointer(
    id: SessionId,
    input: PointerInput
  ): Promise<EngineUpdate>;

  key(
    id: SessionId,
    input: KeyInput
  ): Promise<EngineUpdate>;

  getDocumentSummary(
    id: SessionId
  ): Promise<DocumentSummary>;

  getSlideProjection(
    id: SessionId,
    slideId: SlideId
  ): Promise<SlideProjection>;

  getSelectionProjection(
    id: SessionId
  ): Promise<SelectionProjection>;

  renderSlide(
    id: SessionId,
    slideId: SlideId,
    scale: number
  ): Promise<RenderFrame>;

  undo(id: SessionId): Promise<EngineUpdate>;
  redo(id: SessionId): Promise<EngineUpdate>;

  importPptx(
    id: SessionId,
    bytes: Uint8Array
  ): Promise<ImportResult>;

  exportPptx(
    id: SessionId
  ): Promise<Uint8Array>;
}
```

Bu sözleşme hedef API'dir. Mevcut PoC'deki fonksiyonlarla karşılaştırıp eksik uygulamaları tamamla.

Gerçek DeckCraft API'sinde olmayan davranışları destekleniyormuş gibi sunma.

## 7. Tek belge otoritesi

**Rust Session, belgenin tek otoritesi olacak.**

React tarafında ikinci bir belge modeli oluşturulmayacak.

React yalnızca:

- Seçim projection'ları
- Slayt listesi
- UI state
- Belge revizyonu
- Undo/redo kullanılabilirliği
- Render invalidation bilgileri

gibi ihtiyaç duyulan verileri tutabilecek.

Tam belge JSON'unu her pointer olayında veya her frame'de React'e aktarma.

Küçük projection DTO'ları tasarla.

## 8. Hata yönetimi

Rust kaynaklı hatalar yapılandırılmış şekilde TypeScript'e aktarılmalı.

Örnek:

```ts
type EngineError = {
  code: string;
  message: string;
  retryable: boolean;
  operationId?: string;
};
```

String hata mesajlarını React tarafında parse etmeye dayalı bir mimari oluşturma.

Beklenmeyen hatalar uygulamayı belirsiz durumda bırakmamalı.

## 9. Batch insertion

Mevcut PoC'nin `insertShapesBatch` işlevini koru.

PoC'de doğrulanan davranışlar:

- Tek komutta çoklu nesne ekleme
- Tek undo adımı
- Redo ile geri getirme
- Clipboard ve duplicate offset korunması
- Text-edit sırasında batch reddi

Mevcut yaklaşımın journal/recovery açığını belgele.

Batch payload'ı journal'a kaydedilmediği için bu aşamada üretim recovery desteği tamamlandı kabul edilmesin.

DeckCraft çekirdeğine müdahale etmeden çözüm tasarımını hazırla.

## 10. Testler

Şu senaryoları otomatik test et:

- WASM yükleme
- Engine initialize
- Session create/close
- Slayt oluşturma
- Şekil ekleme
- Komut çalıştırma
- Undo/redo
- Pointer/key
- Render
- Batch insertion
- PPTX round-trip
- Hata yönetimi
- Session izolasyonu
- İki farklı session arasında veri sızıntısı olmaması

PoC'nin mevcut testlerini koru.

WASM derlemesini ve TypeScript adapter testlerini çalıştır.

## 11. WP2'de yapılmayacaklar

- React arayüzünü yeniden tasarlama.
- Canvas editörünü tamamen bağlama.
- AI Chat geliştirme.
- Floating toolbar geliştirme.
- Electron ürün paketleme.
- DeckCraft çekirdeğini değiştirme.
- Eski ATLAS'ı değiştirme.

## 12. Kabul kriterleri

- [x] Rust adapter Folio altında çalışıyor; native ve wasm32 kontrolleri geçiyor.
- [x] DeckCraft sabit Cargo dependency ve `krilla` patch ile kullanılıyor; `Cargo.lock` tutuluyor.
- [x] Tek WASM erişim noktası olan typed TypeScript adapter eklendi.
- [x] Session lifecycle, projections, pointer/key, render, undo/redo, PPTX ve batch API kapsandı.
- [x] Rust errors yapılandırılmış code/message/retryable alanları ile aktarılıyor; adapter operation ID ekliyor.
- [x] Native Rust testleri ve adapter testleri geçti.
- [x] Üretim-dışı diagnostic PoC API'leri export edilmedi.
- [x] Batch journal/recovery açığı ile üretim NO-GO riskleri belgelendi.

## 13. Doğrulama ve sınırlar

WP2 uygulama raporu ve komut kayıtları için [`WP2-IMPLEMENTATION.md`](WP2-IMPLEMENTATION.md) belgesine bakın.

WP2, WP3 canvas bağlantısını veya üretim hazırlığını tamamlamaz. Authentic PowerPoint doğrulaması, gerçek işletim sistemi IME denemeleri, üretim font manifest'i ve temsilî bellek testleri release gate olarak açık kalır.
- [x] PoC'nin doğrulanmış temel işlevleri korunuyor.
- [x] TypeScript engine adapter çalışıyor.
- [x] React doğrudan WASM ayrıntılarına bağımlı değil.
- [ ] Tek belge otoritesi Rust Session.
- [ ] Komutlar ve hatalar tip güvenli şekilde iletiliyor.
- [ ] Render çıktısı alınabiliyor.
- [ ] Undo/redo çalışıyor.
- [ ] Batch insertion korunuyor.
- [ ] Cargo build başarılı.
- [ ] TypeScript build/typecheck başarılı.
- [ ] Otomatik testler başarılı.
- [ ] Eski ATLAS ve DeckCraft değişmemiş.

## 13. Rapor

Tamamlandığında:

1. Oluşturulan Rust/TS dosyalarını listele.
2. PoC'den hangi parçaların yeniden kullanıldığını açıkla.
3. EngineAdapter API sözleşmesini raporla.
4. Build/test sonuçlarını göster.
5. WASM boyutunu ve yükleme davranışını ölç.
6. Kalan teknik riskleri belirt.
7. WP3'ün kullanacağı bağlantı noktalarını açıkla.

**Son talimat: WP2'yi doğrudan uygula. Yeni Folio arayüzünü bozmadan çalışan DeckCraft Rust/WASM motor altyapısını oluştur.**