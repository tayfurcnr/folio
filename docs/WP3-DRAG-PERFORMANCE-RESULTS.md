# Folio canvas sürükleme performansı

Tarih: 2026-11-04

## Sonuç

Sürükleme sırasında tam belge projection'ı ve selection projection'ı her pointermove için üretmek, güncellenen frame'i tüm React uygulama ağacına yayınlamak ve DPR 2'de gereğinden yüksek çözünürlükte iki frame çizmek ana UI darboğazlarıydı. Sürükleme artık Rust Session'a ait pointer olaylarını animation frame sınırında birleştiriyor; güncel Rust frame'lerini doğrudan canvas'a aktarıyor. Tam slayt projection'ı, React belge state'i ve thumbnail yalnızca bırakma sırasında yenileniyor. Drag görüntüsü geçici olarak DPR 1 çözünürlüğünde çiziliyor; bırakınca tam DPR render geri geliyor.

Normal sunumda ve 1.000 nesnede FPS yükseldi. 1.000 nesneli slayt DPR 2'de 17 FPS civarından 56–58 FPS'e çıktı. Tasarım, rail, film şeridi veya canvas yerleşimi değiştirilmedi. Rust Session belge otoritesi olmaya devam ediyor.

## Ölçüm yöntemi

- Headless Chromium 153, Playwright/CDP ve gerçek Folio React arayüzü kullanıldı. Nesne, gerçek UI'daki `Dikdörtgen` düğmesiyle eklendi; drag, canvas'a gönderilen gerçek tarayıcı pointer olaylarıyla yapıldı.
- `?perf=1` ile uygulama içindeki performans ölçümleri alındı: pointer handler, operation queue, EngineAdapter/WASM pointer çağrısı, Rust projection API'leri, renderer çağrıları, pixel copy, `putImageData`, React Profiler ve thumbnail render sayıları.
- FPS ve frame aralıkları `requestAnimationFrame` zaman damgalarından, sürükleme aralığında ölçüldü. Kare gecikmesi 25 ms üzerindeyse düşen/geciken kare olarak sayıldı.
- Normal sunum: gerçek varsayılan Session slaydı ve UI ile eklenen dikdörtgen. Çok nesneli sunum: 1.000 ek şekil gerçek Folio WASM Session'ına eklendi; ölçülen dikdörtgen daha sonra UI'dan eklendi ve görünür üst katmandan taşındı. Böylece hedefin başka nesnelerin altında kalması önlendi.
- Her senaryo DPR 1 ve 2, zoom %50/%100/%200 ile çalıştırıldı. Before ve after aynı senaryo ve aynı input temposunu kullandı. Normal sunum testinde 30 adımlı Playwright mouse drag; çok nesneli testte 90 CDP mousemove olayı 12 ms aralıklarla gönderildi.
- Büyük sunumun ilk taslak ölçümünde hedef, 1.000 şekilden önce eklenmişti ve seçilen dikdörtgen hareket etmiyordu. O ölçüm geçersiz sayıldı; aşağıdaki sonuçlar hedef en son eklenip konumu değiştiği Session projection'ında doğrulanan tekrar testidir.

## Before / after

| Sunum | DPR | Ortalama frame süresi | p95 frame süresi | FPS | Geciken kare |
|---|---:|---:|---:|---:|---:|
| Normal | 1 | 17.8–18.6 → 16.7–16.9 ms | 33.3–33.4 → 16.7–16.8 ms | 53.6–56.3 → 59–60 | 5–9 → 0–1 |
| Normal | 2 | 23.7–24.0 → 16.7–17.2 ms | 50.0 → 16.7–16.8 ms | 41.7–42.2 → 58.1–60 | 30–31 → 0–1 |
| 1.000 nesne | 1 | 25.9–29.2 → 16.7–17.7 ms | 49.9–50.1 → 16.7–33.3 ms | 34.3–38.6 → 56.6–60 | 22–24 → 0–4 |
| 1.000 nesne | 2 | 56.4–60.0 → 17.4–17.6 ms | 83.3–83.4 → 16.7–16.8 ms | 16.7–17.7 → 56.7–57.5 | 20–21 → 1–2 |

Aralıklar zoom %50, %100 ve %200 sonuçlarını kapsar. DPR 2'deki kazancın önemli bölümü drag sırasında backing frame'i DPR 1'e indirmekten gelir; fare bırakılınca tam çözünürlük geri yüklenir.

## İşlem bazında ölçüm

| İşlem | Before | After |
|---|---|---|
| React pointer handler | Ortalama ~0.02 ms; p95 ≤0.1 ms | Ortalama ~0.01–0.03 ms; p95 ≤0.1 ms |
| Engine operation queue beklemesi | Genelde <0.1 ms | Genelde <0.1 ms; yüksek yükte ölçülen ortalama <0.1 ms |
| WASM `Session.pointer` çağrısı | Normal ~0.18–0.20 ms; 1.000 nesne ~0.69–0.77 ms | Normal ~0.19–0.21 ms; 1.000 nesne ~0.94–1.10 ms |
| Tam active slide projection | 30 adımlı drag'de 32 çağrı; 1.000 nesnede frame başına yaklaşık 10–21 ms | Drag sırasında 0; pointer-down ve pointer-up refresh'lerinde toplam 2 çağrı |
| Selection projection | Her drag girdisi ve frame refresh'inde tekrar | Drag sırasında tekrar yok; başlama/bırakma refresh'lerinde toplam 2 çağrı |
| Rust `renderSlide` / drag frame | DPR 1'de ~6–8 ms; DPR 2'de ~17–19 ms | DPR 1'de ~6–9 ms; drag'da DPR 2 de ~7–8 ms |
| Rust `renderSlideOverflow` / drag frame | DPR 1'de ~3–4 ms; DPR 2'de ~9–10 ms | DPR 1'de ~3–5 ms; drag'da DPR 2 de ~4 ms |
| Active + overflow pixel kopyası | DPR 2'de toplam ~10.7–11.2 ms/frame | DPR 2'de toplam ~3.0–3.3 ms/frame |
| Active + overflow `putImageData` | DPR 2'de toplam ~3.3–3.8 ms/frame | DPR 2'de toplam ~0.9–1.1 ms/frame |
| React commit sayısı, normal 30-adım drag | 94 commit; toplam actual render süresi ~209–281 ms | 6 commit; toplam ~28–29 ms |
| React commit sayısı, 1.000 nesne | 78–148 commit; toplam ~261–343 ms | 6 commit; toplam ~19–30 ms |
| Thumbnail render | Drag boyunca 0; son thumbnail eski konumda kalabiliyordu | Bırakmada 1 render; ara hareketlerde 0 |

Active slide ve overflow renderer çağrıları değişen her ekranda görünür görüntüyü üretmek için drag karelerinde devam eder. Değişiklik, bu karelerin DPR 2'de aşırı büyük üretilmesini, belge/selection projection'larının ve React commit'lerinin tekrarlanmasını önler. Thumbnail yalnızca işlem tamamlanınca yenilenir.

## Undo/Redo ve doğrulama

- `node /tmp/folio-drag-undo-proof.mjs`: gerçek canvas drag sonrası Rust projection `[416,266,240,120] → [492,312,240,120]`; tek Undo başlangıç geometrisini, Redo taşınan geometriyi geri verdi. Render edilmiş canvas piksel özeti de hareket ve Undo arasında değişti. DPR 2 / zoom %50.
- Aynı test 1.000 ek şekilli Session'da DPR 2 / zoom %100 çalıştırıldı: `[360,210,240,120] → [437,252.5,240,120] → Undo [360,210,240,120] → Redo [437,252.5,240,120]`. Konsol/page hatası yok.
- Ölçüm matrisindeki tüm 24 senaryoda Rust pointer/drag, render ve projection çağrıları gerçek Folio WASM Session'ına gitti; console error, page error veya başarısız network isteği gözlenmedi.
- Kontroller: `npm run typecheck`, `npm run build`, `git diff --check`.

## Kod değişiklikleri

- `EditorEngine` drag olaylarının son konumunu her `requestAnimationFrame` sınırında Rust Session'a iletir; pointer-up bekleyen son konumu önce uygular, ardından Rust Session'dan tam refresh alır.
- Drag frame'leri, ayrı frame aboneliği üzerinden canvas'a çizilir. Bu yayın `useSyncExternalStore` ile tüm uygulamayı yeniden render etmez.
- Drag sırasında aktif slide/selection projection ve thumbnail yenilenmez; tam belge state'i bırakmada bir kez projekte edilir. Böylece tek drag tek undo işlemi olarak kalır.
- Drag render ölçeği geçici olarak DPR 1'dir. Pointer-up sonrası normal `renderSlide` ve `renderSlideOverflow` DPR ölçeğinde tekrar çizilir.
- `atlas/` ve `deckcraft/` dizinlerinde değişiklik yapılmadı; Rust/WASM mimarisi veya render motoru değiştirilmedi.
