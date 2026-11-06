# WP3.6 — Nesne sürükleme mimarisi ve gecikme sonuçları

Tarih: 2026-11-04

## Sonuç

Folio sürüklemesindeki ana maliyet her pointer hareketini Rust raster motorundan geçirip tam slayt ve overflow frame'lerini yeniden üretmekti. `%50–%200 zoom` ve `DPR 1–2` doğrulamalarında bu Rust raster işleri hareket başına tekrar ediyordu. Önceki WP3.5'te piksel kopyasının kaldırılması maliyeti azalttı, fakat tam render'ı hareket yolundan çıkarmadı.

Seçili nesne taşınırken artık Rust Session'dan alınan, seçili nesneleri içermeyen arka plan ve yalnızca seçili nesneleri içeren ön plan bitmap'leri kullanılıyor. Pointer hareketinde ön plan katmanı `translate3d` ile aynı pointer olayında taşınıyor. Normalize edilmiş/snap uygulanmış koordinat aynı anda Rust Session'a gönderiliyor. Hareket başına aktif ve overflow tam raster çağrısı sıfır; Rust Session geometri projection'ı her drag frame'inde doğrulama ve tutarlılık için okunuyor. Pointer-up'ta son Rust render tamamlanınca önizleme katmanı gizleniyor. Böylece kalıcı belge ve Undo/Redo otoritesi Rust Session olarak kalıyor.

Gerçek Chromium UI regresyonlarında eski konumda kopya piksel kalmadı, önizleme Rust geometrisiyle eşleşti, çoklu seçim ve metin kutusu çerçevesi taşındı, Undo/Redo tek işlem olarak geçti. Pan/El aracı akışına dokunulmadı.

## ATLAS ile mimari karşılaştırma

ATLAS kaynak kodu salt okunur incelendi. Nesne taşıma, `pointermove → selectionController.updateMoveDrag → store.execute(moveObjects) → rAF çizimi` akışını kullanıyor. Folio'nun eski akışı ise hareket anında Rust Session pointer işlemi, `renderSlide`, `renderSlideOverflow` ve Canvas piksel aktarımı bekliyordu. GPU/compositor katmanında hazır seçili nesne hareket ettirme yolu yoktu.

Bu fark, Folio'da görünür nesne konumunu her hareket için raster motorunun tamamlamasına bağlıyordu. Yeni önizleme bu beklemeyi hareketin görsel yolundan kaldırıyor; geometrinin tek otoritesi yine Rust. Geçici bitmap geometri hesaplamıyor, yalnızca Rust'tan render edilmiş pikselleri gösteriyor.

## Gerçek tarayıcı doğrulaması

Komut:

```sh
npm run test:wp36
```

Test Playwright'ın görünür Chromium penceresinde gerçek Folio UI'ını ve WASM Rust Session'ını kullanır. Son çalıştırma: 7/7 senaryo PASS (4 tek nesne koşulu, çoklu seçim, metin kutusu çerçevesi, ayrıca tüm senaryoların doğruluk/assertion toplamı). Gerçek pointer hareketleri sırasında ara Chromium ekran görüntülerini de doğrular.

### Sıcak sürükleme ölçümleri

| Koşul | İlk pointermove → görünür transform | Frame ort. / p95 | >20 ms frame | Drag sırasında tam aktif/overflow render | Eski piksel temizliği | Undo/Redo |
|---|---:|---:|---:|---:|---|---|
| %50 / DPR1 | 6.4 ms | 7.08 / 7 ms | 0 | 0 / 0 | 9/9 örnek temiz | PASS |
| %100 / DPR1 | 5.7 ms | 7.34 / 7 ms | 1 | 0 / 0 | 9/9 örnek temiz | PASS |
| %200 / DPR2 | 4.5 ms | 7.69 / 7 ms | 1 | 0 / 0 | 9/9 örnek temiz | PASS |
| %100 / DPR4 | 11.9 ms | 8.89 / 27.8 ms | 3 | 0 / 0 | 9/9 örnek temiz | PASS |

Her koşulda 12 pointermove için 12 Rust Session geometri projection'ı vardı. Önizleme katmanının transform kalıntısı ölçülen pointer koordinatına göre ortalama/p95/maksimum `0 px` oldu; bu kod yolu ölçümüdür, fiziksel panelde pikselin ışık verme anı değildir. Drag boyunca Long Task gözlenmedi.

Önizleme cache'i pointerdown'da hazırdı (`previewCacheHit: true`, pointerdown sırasında ek prewarm render süresi 0 ms). Arka plan ve seçili ön plan piksel sayıları gerçek Rust render çıktısından doğrulandı. Eski konumdaki test noktaları beyaz, yeni konumdaki örnek seçili nesne rengi çıktı; bu, eski kopyanın kalmadığını ve Chromium'un bir ara composited frame'inde nesnenin yeni konumda olduğunu doğrular.

`pointerEventToScreenshotCaptureUpperBoundMs` test otomasyonu/screenshot toplama yolunun 89–195 ms ölçümüdür; uygulama gecikmesi değildir ve ATLAS ile karşılaştırılmamalıdır. Tarayıcıda fiziksel ekran scan-out gecikmesi, yüksek hızlı kamera veya harici fotodiyotla ölçülmedi.

### ATLAS görünür Chromium ölçümü

ATLAS için görünür Chromium, DPR1, %100 zoom ve tek nesneli UI ölçümünde 12 pointer hareketi uygulandı. Test canvas piksellerini her rAF'te nesnenin sınırlı bölgesinde taradı:

- İlk pointermove → değişen canvas pikseli: `12.6 ms`
- Pointer → canvas görsel konumu farkı: ortalama `1.43 px`, p95 `9.43 px`, maksimum `9.43 px`
- Frame süresi: ortalama `7.37 ms`, p95 `13.8 ms`; 20 ms üstü frame yok
- Sürükleme sırasında Long Task yok

Ölçüm yöntemi Folio'nun `CSS transform` matrisini izleyen metriğiyle birebir aynı değildir; bu yüzden değerler doğrudan cihaz piksel gecikmesi kıyaslaması değildir. Folio tarafında eşdeğer pointer-to-canvas-pixel taraması kurulmadığından “Folio fiziksel gecikmesi ATLAS'a eşit” sonucu çıkarılmıyor. Kanıtlanan iyileşme: Folio'da ilk görünür compositor transform 4.5–11.9 ms aralığında, eski Folio yolundaki kare başı tam render'lar kaldırılmış ve ekranda ara kare doğrulanmış durumda.

## Maliyet ve kalan riskler

Rust'tan önizleme bitmap'lerini seçili nesne/slide/DPR/revision bağlamında hazırlamak gerekir. Sıcak drag öncesi son prewarm süresi DPR1'de yaklaşık `23–56 ms`, DPR2'de `95 ms`, DPR4'te `160 ms` oldu. Bu iş drag sırasında yapılmıyor; ancak yeni seçim veya belge invalidation'ından sonra ilk sürükleme öncesi prewarm maliyeti etkileşimde hissedilebilir. DPR4'te drag frame p95'i `27.8 ms` ve 3 frame `20 ms` üstüydü; yüksek DPR yükü hâlâ iyileştirme alanı.

Seçili nesneler drag başında tam slayt/DPR çözünürlüğünde Rust tarafından raster edilir. Taşma frame'i renderer'ın sınırları nedeniyle DPR2 ile sınırlıdır. Testler `%200 zoom/DPR2`, `%100 zoom/DPR4`, çoklu seçim ve metin kutusu sınır sürüklemesini kapsar. Resize/rotate mevcut Rust Session pointer yolunu kullanmaya devam eder; bu raporun compositor önizlemesi nesne taşıma yoluna uygulanmıştır. Resize/rotate için aynı gecikme ölçüm kapsamı tamamlanmadı.

## Kalıcı regresyon kapsamı

`scripts/wp36-move-preview-regression.mjs` aşağıdakileri doğrular:

- `%50/DPR1`, `%100/DPR1`, `%200/DPR2`, `%100/DPR4`
- Hareket sırasında `renderSlide` ve `renderSlideOverflow` çağrısı olmaması
- Her pointermove'da Rust Session geometrisinin preview transform'u ile tutarlılığı
- Eski piksellerin temizlenmesi ve görünür ara composited frame
- Tek ve çoklu seçim; metin kutusu çerçevesi taşıma
- Tek Undo / Redo sonucu
- DPR'a uygun Rust preview raster boyutları

ATLAS ölçüm/karşılaştırma komutu:

```sh
npm run compare:wp36:atlas
```

Diğer doğrulamalar: `npm run typecheck`, `npm run build`, `npm run test:wp35` ve `npm run regression:wp2` başarılı. `atlas/` yalnızca kaynak inceleme ve izole tarayıcı karşılaştırması için kullanıldı; `deckcraft/` değiştirilmedi.

## Değişen teknik alanlar

- `crates/folio-wasm/src/lib.rs`: Session tabanlı arka plan/seçim bitmap render'ı ve geometri projection API'leri.
- `packages/engine-adapter/src/index.ts`: yeni WASM API'lerinin TypeScript adaptörü.
- `apps/editor/src/features/engine/editorEngine.ts`: RAF input coalescing, invalidation cache'i, preview hazırlama ve Rust final render koordinasyonu.
- `apps/editor/src/ui/workspace/EditorWorkspace.tsx`: ayrı arka plan ve seçili önizleme canvas'ları, compositor transform, pointer capture.
- `scripts/wp36-move-preview-regression.mjs`: görünür Chromium performans/doğruluk regresyonu.
- `scripts/wp36-atlas-comparison.mjs`: salt okunur ATLAS görünür Chromium karşılaştırması.

WP4'e başlanmadı.
