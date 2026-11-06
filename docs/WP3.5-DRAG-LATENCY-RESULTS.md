# WP3.5 — Nesne sürükleme gecikmesi

Tarih: 2026-11-04

## Sonuç

Doğal canvas `pointerdown → drag → pointerup` hareketinde Folio ve salt okunur incelenen ATLAS, 1 ve 100 nesneli karşılaştırmada DPR 1 / %100 zoom koşulunda benzer canvas güncelleme gecikmesi verdi. Folio'nun asıl ek gecikmesi, her aktif ve taşma frame'i için Rust/WASM'den dönen `Uint8Array` verisinin `paintFrame` içinde ikinci kez tamamen kopyalanmasıydı. Kopya, frame başına yaklaşık 2.9–3.3 ms tutuyordu.

`paintFrame` artık WASM'den gelen JavaScript `ArrayBuffer` üzerinde `Uint8ClampedArray` görünümü oluşturuyor; `ImageData` aynı pikselleri kullanıyor. Paylaşılan bellekli buffer gelirse eski kopyalama yolu güvenli yedek olarak kalıyor. Engine, Rust Session, undo, canvas çizim mimarisi ve El aracı/pan değiştirilmedi.

100 nesnede Folio'nun ölçülen canvas paint p95'i 20.1 ms'den 13.9 ms'ye, 1.000 nesnede 21.8 ms'den 19.5 ms'ye indi. Canlı canvas'a ulaşan piksel güncelleme görünümü ortalaması 2.94–3.26 ms'den 0.01–0.03 ms'ye indi. Gerçek tarayıcı sürükleme denemesinde ortalama FPS benzer kaldı; bu değişiklik FPS artışı garantilemiyor. Kazanç, piksel kopyalama maliyetini kaldırmak ve bir sonraki render işine yaklaşık 2–3 ms bırakmak.

Zoom %50 / DPR 2 / 1.000 nesnede aktif ve overflow Rust render'ları en yüksek maliyet olmaya devam ediyor; paint p95'i 28.8 ms ölçüldü. Kopya kaldırıldıktan sonra kalan bu darboğazı piksel aktarımı çözmüyor.

## Kök neden ve akış

Gerçek tarayıcıda sürükleme sırasında:

- Pointer handler ortalama 0.04–0.12 ms; Engine operation queue beklemesi ortalama 0.06–0.40 ms; Rust Session pointer çağrısı ortalama 0.6–1.9 ms sürdü. Bunlar ana gecikme değildi.
- Tam slayt projection'ı drag sırasında yenilenmedi; hareket başı ve bırakma sonunda toplam iki kez çağrıldı. Thumbnail yalnız bırakma sonunda bir kez yenilendi.
- React, her pointermove'da yeniden render olmadı. Hareketli piksel frame'leri doğrudan iki canvas'a yazıldı.
- Her hareket frame'i için `renderSlide` ve `renderSlideOverflow` çalıştı. 1.000 nesnede DPR 1 / %100 zoom'da bu çağrıların ortalaması sırasıyla yaklaşık 8.8 ms ve 4.4 ms idi. Eski piksel kopyaları iki frame için ortalama 3.26 ms daha ekliyordu.
- Rust/WASM adapter'ı `Uint8Array::from(frame.pixels.as_slice())` ile JS belleğinde sahip olunan bir `Uint8Array` döndürüyor. Bu sebeple aynı buffer üzerinde clamped view oluşturmak WASM bellek ömrüne bağlı değil; yeni bir tam piksel buffer'ı ayırmıyor.

ATLAS tarafında nesne taşıma `pointermove → selectionController.updateMoveDrag → store.execute(moveObjects) → rAF çizimi` hattında ilerliyor. Pan akışına dokunulmadı.

## ATLAS ve Folio gerçek Chromium karşılaştırması

Koşullar: aynı Chromium 1243 binary'si, Playwright, 1470×900 viewport, DPR 1, %100 zoom, fare ile 18 gerçek pointermove (16 ms hedef aralık), sürükleme başında 50 ms bekleme ve bir ısınma sürüklemesinden sonra ölçüm. ATLAS nesneleri gerçek editör UI'ındaki dikdörtgen aracıyla; Folio hedef nesnesi gerçek UI ile, ek sahne nesneleri gerçek Folio WASM Session'ına eklendi.

“Canvas paint → sonraki rAF” gecikmesi, event'ten sonra canvas çizimi yapan ilk frame'i izleyen ilk rAF timestamp'ine kadar ölçüldü. Bu, ekran kartı scan-out timestamp'i değil; canvas güncellemesinin tarayıcı frame döngüsüne katılmasını ölçen üst sınırdır. Folio'da ayrıca doğrudan `putImageData` sonuna kadar olan `drag.inputToFrame` metriği kaydedildi.

| Düzenleyici / nesne sayısı | Canvas paint → sonraki rAF ort. / p95 | FPS | Frame p95 | Uzun görev |
|---|---:|---:|---:|---:|
| ATLAS, 1 | 16.28 / 16.50 ms | 60.00 | 16.70 ms | 0 |
| Folio önce, 1 hareketli nesne (+2 layout placeholder) | 16.16 / 16.40 ms | 59.96 | 16.70 ms | 0 |
| Folio sonra, 1 hareketli nesne (+2 layout placeholder) | 16.18 / 16.40 ms | 60.39 | 16.80 ms | 0 |
| ATLAS, 100 | 16.12 / 16.30 ms | 59.07 | 16.80 ms | 0 |
| Folio önce, 100 | 17.84 / 33.00 ms | 58.39 | 16.80 ms | 0 |
| Folio sonra, 100 | 16.27 / 16.40 ms | 59.48 | 16.80 ms | 0 |
| Folio önce, 1.000 | 17.13 / 32.80 ms | 58.70 | 16.80 ms | 0 |
| Folio sonra, 1.000 | 16.14 / 16.50 ms | 58.05 | 16.80 ms | 0 |

ATLAS 1.000 nesneli senaryoda ölçülmedi. ATLAS 100 nesne oluşturma gerçek UI üzerinden yaklaşık 20 saniye sürdü. FPS ölçümleri birkaç puan oynayabildi; ana karşılaştırma gecikme dağılımı ve iş maliyetidir. Folio'nun “önce” ve “sonra” denemeleri ayrı tarayıcı context'lerinde, aynı viewport/zoom/DPR/input temposuyla yapıldı.

## Folio önce / sonra — piksel ve render maliyetleri

DPR 1 / %100 zoom / 18 hareketli pointermove. Nesne sayısı, Rust Session projection'ındaki toplam şekil sayısıdır.

| Nesne | Piksel kopyası önce → görünüm sonra | `drag.inputToFrame` ort. önce → sonra | Paint p95 önce → sonra | FPS önce → sonra |
|---:|---:|---:|---:|---:|
| 3 (1 hareketli dikdörtgen + 2 layout placeholder) | 2.94 → 0.01 ms | 11.76 → 10.04 ms | 14.5 → 14.7 ms | 59.96 → 60.39 |
| 100 | 3.04 → 0.02 ms | 13.06 → 10.24 ms | 20.1 → 13.9 ms | 58.39 → 59.48 |
| 1.000 | 3.26 → 0.03 ms | 15.00 → 12.55 ms | 21.8 → 19.5 ms | 58.70 → 58.05 |

`drag.inputToFrame`, pointer handler'ın aldığı son drag koordinatından Rust render'ları ve canvas `putImageData` tamamlanana kadarki süreyi ölçer. Önceki/sоnraki gerçek canvas paint + rAF tablosundaki değerler frame sınırına duyarlıdır; ortalama FPS'te tüm nesne sayılarında tutarlı artış yok.

## DPR / zoom stres doğrulaması

`node scripts/wp35-drag-latency-regression.mjs` testi, gerçek Folio UI'da 1.000 şekilli Rust Session kurar ve her senaryoda 18 fare hareketi uygular. Altı koşulun tamamı PASS oldu; Rust geometrisi değişti, tek Undo başlangıca döndürdü, Redo taşınan geometriyi geri getirdi. Pointer capture boyunca hedef `CANVAS` kaldı. Her koşulda iki projection ve bir thumbnail render görüldü; hareket sırasında projection/thumbnail döngüsü yoktu. Browser/console hatası yoktu.

| DPR | Zoom | Active render ort. | Overflow render ort. | Paint p95 | Rust pointer ort. |
|---:|---:|---:|---:|---:|---:|
| 1 | %50 | 14.20 ms | 10.38 ms | 23.6 ms | 1.42 ms |
| 1 | %100 | 8.74 ms | 4.48 ms | 17.8 ms | 1.61 ms |
| 1 | %200 | 8.84 ms | 4.49 ms | 13.9 ms | 1.27 ms |
| 2 | %50 | 18.23 ms | 13.73 ms | 28.8 ms | 1.22 ms |
| 2 | %100 | 10.53 ms | 5.44 ms | 16.4 ms | 1.59 ms |
| 2 | %200 | 10.21 ms | 5.79 ms | 16.6 ms | 1.21 ms |

Altı koşulda piksel view üretimi active ve overflow frame başına 0.00–0.03 ms oldu; projection iki, thumbnail bir çağrıda kaldı. En yüksek p95, %50 zoom / DPR 2'de daha geniş görünür overflow alanının render edilmesiyle oluştu.

## Kalıcı regresyon testi

Çalıştırma:

```sh
node scripts/wp35-drag-latency-regression.mjs
```

Test gerçek Chromium, gerçek Folio React arayüzü ve gerçek Rust/WASM Session kullanır. 1.000 şekilli belgeyi UI + Rust `insertShapesBatch` ile kurar; `%50/%100/%200 × DPR 1/2` kombinasyonlarında pointer hedefini, frame render'larını, projection/thumbnail invalidation'ını, piksel view süresini, p95 paint süresini ve tek Undo/Redo adımını doğrular. Test raporunda her senaryonun ölçümleri JSON olarak yazdırılır.

## Değişen dosya ve kontrol

- `apps/editor/src/ui/workspace/EditorWorkspace.tsx`: WASM'in sahip olduğu JS `ArrayBuffer` için ikinci tam pixel kopyası yerine `Uint8ClampedArray` görünümü. `SharedArrayBuffer` durumunda güvenli kopya yedeği.
- `scripts/wp35-drag-latency-regression.mjs`: altı DPR/zoom kombinasyonunda gerçek browser regresyonu.
- `npm run typecheck`: PASS.
- `node scripts/wp35-drag-latency-regression.mjs`: PASS, 6/6 senaryo.

`atlas/` yalnızca kaynak karşılaştırması ve ayrı yerel Chromium ölçümü için okundu/çalıştırıldı; kaynak dosyalarına değişiklik yapılmadı. `deckcraft/` kullanılmadı veya değiştirilmedi.
