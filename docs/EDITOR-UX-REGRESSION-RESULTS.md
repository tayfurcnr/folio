# Folio Editör UX Regresyon Sonuçları

Tarih: 2026-11-06
Sonuç: P0/P1 etkileşim kusurları için regresyonlar PASS. P2 kapsam farkları ve DPR 4 performans sınırı audit'te açık tutuluyor.

## Komut sonuçları

| Komut | Sonuç | Kanıt |
|---|---|---|
| `npm run test:wp35` | PASS | 25 tarayıcı senaryosu. Resize/rotate tek Undo/Redo, grid/snap, hand pan, Fit bildirimi, caret, kütüphane, 1366×768/1920×1080, DPR 1/2, zoom %50/%100/%200 ve 100/500/1.000 nesne. 0 browser error. |
| `npm run test:wp36` | PASS | Görünür Chromium. Move 4 zoom/DPR koşulu, multi-select ve text-frame move. Drag sırasında full Rust raster 0; 12 Rust preview projection; ilk pointer move'tan görünür transform'a 5.7–12.4 ms; CSS takip farkı 0 px; Undo PASS. Ekran tarama gecikmesi ölçülmedi. |
| `npm run test:wp37` | PASS | Güncel WASM ile 108 senaryo / 102 performans hareketi. Resize ve rotate %50/%100/%200 × DPR 1/2/4, cold/warm, 8 şekil resize handle'ı, multi-select, text, flip, overflow, modifier, cursor, placeholder, hızlı transform. Browser error 0; drag sırasında full Rust render 0. DPR4'te long task ve frame p95 riski sürüyor. |
| `npm run test:wp38` | PASS | Görünür Chromium; TR↔EN arayüz dili, placeholder render projeksiyonu, sunum modu, nesne/canvas/slayt sağ tık menüsü, clipboard, tema kataloğu ve uygulaması, slayt düz/saydam, gradient, desen ve görsel arka planları, tüm slaytlara uygulama/sıfırlama, nesne alt text/dekoratif metadata, Undo/Redo ve son slayt silme kuralı. Browser error 0. |
| `npm run regression:wp2` | PASS | Folio'nun release WASM çıktısı ile Chromium. Pointer, 960×540 RGBA render, undo/redo, 100/1.000 batch ve sentetik PPTX round-trip. Browser console/exception error 0. PPTX testi Microsoft PowerPoint uyumluluğunu kanıtlamaz. |
| `npm run typecheck` | PASS | Editor ve engine-adapter TypeScript kontrolleri. |
| `npm run build` | PASS | WASM otomatik derlendi; Vite production build 477 modül üretti. Rollup büyük JS chunk uyarısı verdi. |
| `WP37_ONLY=cursor npm run test:wp37` | PASS | Görünür Chromium, 10 zoom/DPR/viewport kombinasyonu. Resize hedefi `elementFromPoint` ile gerçek handle olarak doğrulandı; Rust geometry değişti, tek Undo/Redo geri aldı. |
| `WP37_ONLY=placeholders npm run test:wp37` | PASS | Görünür Chromium'da title/subtitle tıklama, textarea focus, yazma ve Rust projection doğrulandı. |
| `WP37_ONLY=corner-rotate FOLIO_HEADLESS=1 npm run test:wp37` | PASS | Dış köşe rotate hit-zone Rust Session rotation'ını değiştirdi; Undo/Redo PASS. |
| `WP37_ONLY=text-resize-live FOLIO_HEADLESS=1 npm run test:wp37` | PASS | Metin kutusu genişletme ve daraltma; glyph puntosu/ölçüsü korunuyor, daraltınca metin sarılıyor, araç çubuğu sürükleme boyunca gizlenip bırakınca dönüyor. Bir harekette 8 canlı text preview projeksiyonu. |
| `WP37_ONLY=resize-n-z50-dpr1 npm run test:wp37` | PASS | Tam koşudaki kuzey resize vakası izole edildi; gerçek mouse hareketi Rust geometry'yi `[444,234,72,72]` konumundan `[444,180,72,126]` ölçüsüne taşıdı, Undo/Redo PASS. |

## Etkileşim bulgusu ve düzeltme

Gerçek pointer ile southeast resize handle'ına basıldığında DOM hedefi görünmez `engine-selection__rotate-hit--se` alanıydı. Rust pointer sonucu `hit:null` dönüyor, seçim temizleniyor ve resize geometrisi değişmiyordu. Rotate zone'ları fiziksel ekranda handle'dan ayırdım, resize anchor pozisyonlarını şekil kenarında sabitledim ve rotate pointer-down/drag konumunu shape rect, rotation ve flip bilgisinden çıkarılan Rust handle noktasına eşledim.

Bir sonraki regression turunda tarayıcının kullandığı `public/wasm` çıktısının Rust kaynağından eski olduğu görüldü. UI preview hareket ediyordu ancak eski WASM pointer-down çağrısında `null` döndürdüğü için gerçek transform başlamıyordu. Editör `predev`/`prebuild` adımları ve WP3.7 regresyon komutu artık WASM'ı kaynakla birlikte derliyor; tam 108 senaryolu koşu güncel WASM ile PASS.

Kalıcı WP3.7 regresyonu, 10 viewport/zoom/DPR kombinasyonunda southeast handle'ın üstünü örten elementi denetliyor; gerçek mouse drag ile Session geometry değişikliğini ve bir adımlı Undo/Redo'yu doğruluyor.

Metin kutusu tutamaçları Canva'nın metin davranışına uyar: yalnızca sol/sağ pill tutamaçları görünür; punto korunur ve satırlar yeniden akar. Rust Session gizli köşe ve dikey resize hit alanlarını da reddeder. `manual_text_box_resize_keeps_the_dragged_frame_and_undoes_as_one_step` yan resize geometrisi ve Undo/Redo'yu; `WP37_ONLY=text-resize-live` glyph ölçüsü, daraltmada sarım ve araç çubuğunun sürükleme sırasında gizlenip bırakınca geri gelmesini doğrular. Canva'nın resmi kılavuzu da kutuyu daraltınca satırların sarıldığını, font boyutunun değişmediğini ve Alt/Option ile kenardan iki yana simetrik resize yapılabildiğini belirtir: https://www.canva.com/help/wrap-text/. `WP37_ONLY=placeholders` sistem başlığının canlı metin önizlemesini ve görünmeyen köşe hit'lerinin geometriyi değiştirmediğini doğrular.

WP3.5 performans sürüklemesi ve grid/snap regresyonu artık seçili nesnenin açık `Taşı` kontrolünü kullanıyor. %50 zoomda nesne kenarına birkaç CSS piksel uzaklıktaki eski test noktası kuzey resize tutamacına denk geliyordu; test yanlış transform'u ölçüyordu. Düzeltilen gerçek taşıma akışı ve tam 25 senaryolu WP3.5 paketi geçti.

## Drag performans ölçümleri

### WP3.5 tam sahne taraması

- 1366×768 / 1920×1080; DPR 1/2; zoom %50/%100/%200; 1, 100, 500 ve 1.000 nesne senaryoları geçti.
- Her drag sırasında 1 active raster + 1 overflow raster, 1 thumbnail güncellemesi, 1 active projection; React commit sayısı 5–6.
- FPS 35.9–60; ölçülen frame p95 16.7–100 ms. En ağır frame'ler DPR2, büyük overflow buffer veya çok nesneli senaryolarda görüldü.
- `drag.inputToFrame` ortalama örnekleri yaklaşık 0.21–0.83 ms; bu süre fiziksel ekran gecikmesi değildir.

### WP3.6 görünür Chromium move testi

- Drag sırasında active/overflow full Rust raster çağrısı 0; seçili geometri projection'ı 12 kez.
- Pointer event ile CSS transform artığı ölçümlerde 0 px; endpoint lag 1.41–5.66 px.
- İlk pointer move'dan görünür transform'a 5.7–12.4 ms. `pointerEventToScreenshotCaptureUpperBoundMs` 88–148 ms değerleri ekran gecikmesi değil, tarayıcı screenshot yakalama üst sınırıdır.
- Uzun görev gözlenmedi. Gerçek ekran scanout ölçülmedi.

### WP3.7 resize/rotate tam matris

- 102 performans hareketinin hiçbirinde drag sırasında full Rust render yok; final render pointer-up sonrasında.
- DPR1 warm senaryolarında ilk hareketten transform'a çoğunlukla 14.9–21.1 ms; DPR2/4 ve yüksek zoomda 18.2–36.7 ms aralığı gözlendi.
- DPR4 warm testlerde pointer-to-preview p95 49.2–82.4 ms, frame p95 bazı kombinasyonlarda 100–116.7 ms ve pointer-up raster max 91.4 ms'ye ulaştı. Testteki long-task sayımları warm gesture'larda yüksek (toplam 149); headless tarayıcı/context/screenshot overhead'inden etkilenebilir.
- Bu sonuçlar transform geometrisi ve tek undo davranışını doğrular. DPR4'te doğal his ve üretim performansını PASS saymak için yeterli değildir.

Görünür Chromium'da ayrıca %200 zoom / DPR4 resize ve rotate birer kez çalıştırıldı: ilk hareketten görünür transform'a 5.4–5.9 ms; ölçülen pointer-to-preview ortalama 5.55–5.60 ms, örnek p95 5.9–6.0 ms; frame ortalaması 10.53–10.78 ms. Drag sırasında full Rust render 0. Pointer-up'ta active+overflow final raster toplamı 34.3–35.8 ms. Bu tek hareketlik örnek normal drag tepkisinin hızlı olduğunu gösterir; istatistiksel p95 veya fiziksel ekran gecikmesi sayılmaz.

## Görsel inceleme

Ekran görüntüleri gerçek editör arayüzünden alındı ve ayrıca gözle incelendi:

- [1366×768, zoom %50](artifacts/editor-ux/selection-transform-preview-1366-z50.png)
- [1366×768, zoom %100](artifacts/editor-ux/selection-transform-preview-1366.png)
- [1366×768, zoom %200](artifacts/editor-ux/selection-transform-preview-1366-z200.png)
- [1920×1080, zoom %100](artifacts/editor-ux/selection-transform-preview-1920.png)
- [Türkçe placeholder'lar](artifacts/editor-ux/placeholder-prompts-tr.png)
- [İngilizce placeholder'lar](artifacts/editor-ux/placeholder-prompts-en.png)

Resize handle'ları tüm ölçeklerde 12 CSS px; transform öncesi/preview/sonrası ölçümleri 1.5 px toleransında eşleşti. Placeholder görselleri Türkçe ve İngilizce metni gösteriyor. Click-to-add regression'ı ayrıca tıklamanın textarea'yı açtığını ve yazının Rust projection'a ulaştığını doğruluyor.

## P2 ve kalan sınırlar

- Bağlam menüsü WP3.8 ile nesne, boş canvas ve slayt kartında uygulanmış, `npm run test:wp38` ile görünür Chromium'da doğrulanmıştır.
- Slayt başlığına çift tıklayarak yeniden adlandırma, gizle/göster, Undo/Redo, gizli kart görünümü ve sunum modunda gizli slaytı atlama WP3.8 ile görünür Chromium'da doğrulanmıştır.
- Slayt şeridindeki uygulama içi menüden bölüm oluşturma, ad değiştirme, blok hâlinde yeniden sıralama, slaytları koruyarak kaldırma, silme onayını iptal etme ve ekleme/adlandırma/taşıma/kaldırma Undo/Redo WP3.8 ile görünür Chromium'da doğrulanmıştır.
- DPR4 ve ağır overflow senaryolarında preview/final raster gecikmesi yüksek; performans riski kapanmış değil.
- OS IME, üretim fontları, gerçek PowerPoint uyumluluğu, fiziksel ekran scanout ve uzun süreli bellek testi bu audit ile doğrulanmadı.
- `atlas/` ve `deckcraft/` salt okunur referans olarak kullanıldı; bu görev sırasında bu dizinlere yazılmadı.

## 2026-11-06 seçili metin aralığı biçimlendirme tekrarı

- `npm run test:wp38:text-range` gerçek Folio UI, Chromium ve Rust/WASM Session üzerinde PASS: `[0,6]–[0,10]` seçimi toolbar tıklamasından sonra korundu; `Plain ` ve ` range` kalınlaşmadı, yalnızca `bold` aralığı kalınlaştı. Undo/Redo aynı karakter aralığına uygulandı.
- Aynı regresyon tam `FOLIO_HEADLESS=1 npm run test:wp38` akışına da eklendi ve tüm paket PASS oldu. Önceki bir tekrarda ruler'dan tab stop silme assertion'ı timeout vermişti; izole ruler denemesi ve tam tekrar başarılı olduğundan bu tek timeout tekrarlanabilir hata olarak sınıflandırılmadı.
- `npm run typecheck`, iki WP3.8 script'inde `node --check` ve `git diff --check` PASS.

## 2026-11-06 sunumda sayfaya atlama

- Sunum görünümüne “Sayfaya git” denetimi ve Canva ile aynı `Ctrl+Alt+G` / `Option+Command+G` kısayol akışı eklendi. Sayfa numaraları gizli slaytları saymıyor.
- `FOLIO_HEADLESS=1 node scripts/wp38-presenter-regression.mjs` PASS: 3 slaytlı sunumda ortadaki gizli slayt atlandı; düğmeyle 1. sayfaya, kısayolla 2. görünür sayfaya gidildi. Ayrı sunucu penceresi, not güncelleme ve uzaktan ok tuşu kontrolleri de geçti.
- `npm run typecheck`, `node --check scripts/wp38-presenter-regression.mjs` ve `git diff --check` PASS. Tam `npm run test:wp38` bu değişiklikte çalıştırılmadı.
