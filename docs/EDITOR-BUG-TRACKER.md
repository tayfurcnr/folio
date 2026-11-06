# Folio Editör Bug Tracker

Audit kapsamındaki kullanıcıya görünen etkileşim sorunları ve ayrı takip gerektiren kapsam farkları.

## Düzeltilen P1 bulguları

### BUG-01 — Transform önizlemesinde selection handle'ları deforme oluyordu

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** Resize veya rotate sırasında handle'lar nesneyle birlikte büyüyüp küçülüyor, hit-area ve seçim çerçevesi kararsız görünüyordu.
- **ATLAS davranışı:** `canvas/renderer.ts` handle ölçülerini ekran alanında sabit tutar.
- **Kök neden:** Folio, seçim çerçevesi ve handle'ları aynı affine transform wrapper'ında kopyalıyordu.
- **Düzeltme:** `EditorWorkspace.tsx` preview transform'una ters lineer matris uygulayıp handle, rotate affordance ve hit-zone'ları karşı dönüştürüyor; CSS zoom ölçeği sabit fiziksel boyutu koruyor.
- **Kanıt:** `npm run test:wp37`; %50/%100/%200 zoom, DPR 1/2/4 ve 1366×768 / 1920×1080. Tutamaç ölçüsü transform öncesi, sırasında ve sonrasında karşılaştırılıyor. Ekran görüntüleri `docs/artifacts/editor-ux/` altında.
- **Kalan risk:** DPR 4'te son Rust raster maliyeti yükselebilir; drag sırasında handle boyutu sabit kalıyor.

### BUG-02 — Nesne gövdesinde move cursor görünmüyordu

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** Taşınabilir şeklin üzerinde cursor çerçeve dışındayken yanlış veya boş durum gösterebiliyordu; text box edit dışı durumda `text` gösterebiliyordu.
- **ATLAS davranışı:** Cursor nesne/handle hit-test'inden türetilir; metin imleci yalnız metin düzenlerken kullanılır.
- **Kök neden:** Folio hover cursor'ı DOM rectangle'ı üzerinden çıkarıyordu; şeklin gerçek geometrisi ve aktif edit modu ayrışıyordu.
- **Düzeltme:** Hover, `EditorEngine.hitTest` üzerinden gerçek Rust `Session::hit_test` sonucuna bağlı. Async sonuç sıralamasıyla eski pointer cevabı atılıyor. Move, rotate, resize ve locked cursor öncelikleri ayrıldı.
- **Kanıt:** `npm run test:wp37` içindeki `cursor-hover-and-fixed-controls`; normal nesne, başlık placeholder'ı, text edit, boş canvas ve şeffaf ellipse köşesi.
- **Kalan risk:** Cursor gerçek OS pointer cihazında ayrıca doğrulanmadı; Chromium mouse emülasyonu kullanıldı.

### BUG-03 — Rotate cursor ve hit alanı tutarsızdı

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** Eski özel SVG cursor büyük/pikselli görünüyordu; ek hit-zone ile görünür affordance farklı davranabiliyordu.
- **ATLAS davranışı:** Basit, nesne dönüş handle'ına bağlı bir rotation affordance kullanır.
- **Kök neden:** Folio'nun SVG cursor'u yüksek DPR ve farklı zoomlarda kaba görünüyordu; corner zone başlangıcı Rust handle koordinatıyla birebir değildi.
- **Düzeltme:** Native `grab` sonradan kaldırıldı; nesne açısından bağımsız, sabit yönlü küçük SVG rotate cursor kullanılıyor. `move` cursor'ından ve resize yönlü cursor'larından farklı. Köşe rotate hit-zone'ları ekranda sabit aralıkla duruyor ve pointer başlangıcı Rust geometri handle'ına eşleniyor.
- **Kanıt:** `npm run test:wp37` içindeki `cursor-hover-and-fixed-controls`, dört köşe çakışma kontrolü ve zoom %50/%100/%200 × DPR1/2/4 matrix'i. Test rotate cursor'ın SVG/crosshair, move cursor'ın `move` olduğunu ve Güneydoğu resize hedefinin üstünün kapanmadığını doğruluyor.
- **Kalan risk:** Dokunmatik cihaz cursor'ı bu audit'in dışında.

### BUG-04 — Köşe rotate hit-zone resize handle'ını kapatıyordu

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** Güneydoğu resize handle'ına tıklama görünmez rotate zone'una gidiyor, Rust boş hit sonucuyla seçimi temizleyebiliyordu.
- **ATLAS davranışı:** Resize ve rotate hedefleri aynı pointer noktasını çalmaz.
- **Kök neden:** `.engine-selection__rotate-hit--se` z-index'i daha yüksek ve hit alanı köşe resize handle'ıyla kesişiyordu. Ayrıca handle pozisyonu zoom değişirken doküman koordinatında köşeden kayıyordu.
- **Düzeltme:** Resize handle anchor'ları şekil köşesine sabitlendi; rotate hit-zone'ları ekranda sabit aralıkla dışarı alındı. Rotate pointer başlangıcı shape rect, flip ve rotation değerinden hesaplanan Rust handle noktasına eşleniyor.
- **Kanıt:** `npm run test:wp35`, `WP37_ONLY=cursor FOLIO_HEADLESS=1 npm run test:wp37`, `WP37_ONLY=corner-rotate FOLIO_HEADLESS=1 npm run test:wp37` ve son kodla tam `FOLIO_HEADLESS=1 npm run test:wp37` (98 senaryo). Yeni assertion `elementFromPoint` hedefinin resize handle olduğunu, Session geometrisinin değiştiğini ve tek Undo/Redo'yu doğruluyor.
- **Kalan risk:** DPR4'te final raster gecikmesi ayrı performans riski olarak izleniyor; hedef çakışması regresyonu kalmadı.

### BUG-05 — Layout'tan gelen başlık placeholder'ı tıklanamıyordu

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** “Başlık eklemek için tıklayın” / “Alt başlık eklemek için tıklayın” görünmesine rağmen tıklama metin düzenleme alanını açmıyordu.
- **ATLAS davranışı:** Placeholder alanına tıklama metin düzenlemeyi başlatır.
- **Kök neden:** Rust/WASM slide projection, layout'tan miras alınan placeholder transform'unu üretmediği için React overlay `rect:null` ile çizilmiyordu.
- **Düzeltme:** WASM projection DeckCraft resolve context'ini kullanarak miras alınan `xfrm` değerini çıkarıyor. Seçili shape geometry de aynı resolved transform'u kullanıyor.
- **Kanıt:** `WP37_ONLY=placeholders npm run test:wp37`; görünür Chromium'da title ve subtitle click, textarea focus, yazma ve Rust Session projection kontrolü. Rust testi: `default_slide_projects_inherited_placeholder_geometry`.
- **Kalan risk:** Kullanıcı tarafından tanımlanmış layout'ların çok farklı placeholder türleri ayrı örneklerle genişletilebilir.

### BUG-06 — Placeholder prompt dili uygulama diliyle uyuşmuyordu

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** Türkçe editörde varsayılan placeholder prompt'ları İngilizce görünebiliyordu.
- **ATLAS davranışı:** Aktif locale için doğru prompt gösterir; mevcut kullanıcı metnine dokunmaz.
- **Kök neden:** DeckCraft varsayılan prompt'u `Click to add...` olarak verir; Folio projection locale-aware değildi.
- **Düzeltme:** `features/localization/locale.ts` `html lang` değerini okuyor. WASM render projection yalnız varsayılan prompt'ları Türkçe/İngilizceye çeviriyor; Session belgesi ve özel prompt değişmiyor.
- **Kanıt:** Rust testi `localized_prompts_are_render_projection_only_and_respect_custom_prompts`; WP37 browser senaryosu Türkçe/İngilizce render ve `placeholder-prompts-tr.png`, `placeholder-prompts-en.png` görselleri.
- **Kalan risk:** Arayüz dili Türkçe ve İngilizceyle sınırlıdır; yeni diller için çeviri sözlüğü ve doğrulama gerekir.

### BUG-07 — Context menu düzenleme komutları motor komutlarıyla uyuşmuyordu

- **Öncelik / durum:** P1 / düzeltildi.
- **Kullanıcı etkisi:** Menüde çoğalt ve sil görünse de seçili nesne Rust Session'da değişmiyordu.
- **Kök neden:** UI `shape.duplicate` ve `shape.delete` adlı desteklenmeyen komut adlarını çağırıyordu. DeckCraft Session bu işlemleri `edit.duplicate` ve `edit.delete` olarak sunuyor.
- **Düzeltme:** Ortak command union ve context/header menüleri gerçek Session komut adlarına geçirildi; çoğaltma için Session clipboard gerektirmeyen `edit.duplicate` kullanılıyor.
- **Kanıt:** `npm run test:wp38`; görünür Chromium'da nesne çoğalt/sil ve Rust projection, Undo/Redo ile doğrulandı.
- **Kalan risk:** Seçili metin aralığı işletim sistemi panosuna düz metin ve biçimli HTML olarak kopyalanıyor; başka metin kutusuna gerçek Ctrl+C/Ctrl+V ile biçim korunuyor. Şekil/görseller Folio panosunda editable Folio paketini ve dış uygulamalar için PNG önizlemesini taşır; başka uygulamaya yapıştırılan PNG Folio içindeki gibi katman katman düzenlenebilir değildir.

### BUG-08 — Canvas'a yapıştırılan biçimli metin düz yazıya indirgeniyordu

- **Öncelik / durum:** P1 / canvas HTML yapıştırma düzeltildi.
- **Kullanıcı etkisi:** Web, Canva veya Office'ten kopyalanan metin Folio'ya taşındığında kalınlık, italik, alt çizgi, yazı tipi, punto ve renk kayboluyordu.
- **Kök neden:** Canvas yapıştırıcısı yalnızca `text/plain` verisini okuyup yeni bir text box oluşturuyordu.
- **Düzeltme:** HTML, inert `DOMParser` ile ayrıştırılıyor; script/aktif içerik dışarıda bırakılıyor ve izinli metin stilleri DeckCraft text run'larına aktarılıyor. Canvas yapıştırması tek batch insert; metin düzenlerken seçili aralığa yapıştırma tek DeckCraft text insert + aynı undo kaydındaki stil mutasyonu olarak uygulanıyor. Ctrl+C/Ctrl+V metin alanında tarayıcının işletim sistemi pano olaylarına bırakılıyor; seçili aralık düz metin ve güvenli biçimli HTML olarak kopyalanıyor.
- **Kanıt:** `scripts/wp38-ux-regression.mjs` canvas ve var olan metin aralığına HTML yapıştırmasını; biçimli seçimi Chromium sistem panosuna kopyalayıp başka kutuya Ctrl+V ile taşımayı; run stillerini ve tek adımlı Undo/Redo'yu doğruluyor. Hedefli Chromium akışı PASS; daha önce export edilen PPTX içinde `DC0000` metin rengi doğrulandı.
- **Kalan risk:** Seçili Folio nesneleri sistem panosuna PNG + Folio paketiyle yazılır; Folio'ya geri yapıştırma şekil/medyayı editable olarak geri kurar. Dış uygulamalara verilen PNG önizlemesi raster kalır.

## P2 / ayrı kapsam takibi

### GAP-01 — Canvas ve film şeridi sağ tık menüsü Folio'da yok

- **Öncelik / durum:** P1 / WP3.8'de giderildi.
- **ATLAS referansı:** `atlas/apps/editor/src/ui/contextMenu.ts`, `contextMenuEvents.ts` salt okunur incelendi.
- **Folio çözümü:** Ortak Button/tokens kullanan `EditorContextMenu`; nesne, boş canvas ve slayt kartı hedefleri; viewport'a göre konumlama; Escape, dışarı tıklama, ok/Home/End klavye navigasyonu; sağ tıkta geçerli seçimi koruma.
- **Gerçek motor eylemleri:** Nesne kes/kopyala/yapıştır/çoğalt/sil; z-order, hizalama ve kilit komutları; canvas yapıştır/tümünü seç/ızgara/fit; slayt ekle/çoğalt/sil/sırala/layout. Menü seçenekleri DeckCraft Session'daki komutlara bağlıdır; son slayt silme kapalıdır.
- **Kanıt:** `npm run test:wp38`; görünür Chromium'da nesne ve boş canvas menüleri, Session clipboard, Rust projection, undo/redo, slayt çoğalt/sil ve son slayt kuralı PASS.

### GAP-02 — Yüksek DPR'de pointer-up raster maliyeti

- **Öncelik / durum:** P2 performans takibi; drag sırasında değil, final raster geçişinde maliyet kalıyor.
- **Folio davranışı:** Move/resize/rotate sırasında full Rust render sayısı 0; pointer-up'ta active ve overflow frame render ediliyor.
- **Kanıt:** WP3.8 işlem türleri ayrılmış uzun soak görünür Chromium'da 27 sıcak Move/Resize/Rotate gesture (60 pointer örneği/gesture) çalıştı. Drag sırasında Rust raster 0; pointer-to-preview ort./p95 Move `6.05/6.6 ms`, Resize `5.73/6.4 ms`, Rotate `5.76/6.4 ms`. Zoom×DPR scale optimizasyonundan sonra `%50/DPR4` pointer-up raster tepesi `78.4→63.1 ms` oldu; preview ortalaması korundu. WASM memory page delta `0 byte`. Long task ölçümünde 7 hareket aralığı ve 13 pointer-up aralığı olayı, en uzunları `137/174 ms`; otomasyon/Chromium yükü ayrılamıyor. Daha geniş 107-senaryo regresyonda 100 sıcak gesture'ın 30'unda hareket sırasında, 40'ında pointer-up raster aralığında long task oluştu. GPU/compositor zamanı ve fiziksel fare/ekran profili ölçülmedi.
- **Durum / takip:** P2 / açık. WP3.8 raporunda kullanıcı akıcılığı BLOCKED; otomasyon overhead'inden ayrılmış uzun görev, üretim cihazı ve DPR4 buffer bellek ölçümü gerekir.
