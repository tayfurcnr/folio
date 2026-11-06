# WP3.7 — Resize / Scale / Rotate performans sonuçları

Tarih: 2026-11-05

## Sonuç

Resize ve rotate artık seçili nesnelerin Rust Session'dan hazırlanmış ön plan bitmap'lerini GPU/compositor dostu affine CSS transform ile gösteriyor. Pointer hareketi sırasında `renderSlide` ve `renderSlideOverflow` çağrılmıyor. Rust Session her pointer örneğinde geometriyi hesaplamaya ve belge/Undo otoritesi olmaya devam ediyor; geçici katman yalnızca render edilmiş pikselleri dönüştürüyor.

WP3.7 testinin ilk teşhisi, compositor preview uygulamasının resize/rotate CSS güncellemesinin Move'a özel bir koşulun içinde kalmasıydı. Bu nedenle Rust geometrisi değişirken bitmap matrisi identity kalıyordu. Koşul ortak transform yoluna taşındı. Ardışık asenkron Rust projection'larının yeni pointer önizlemesini geriye sarmaması için pointer input sequence eklendi; yalnızca güncel sequence'in projection'ı önizlemeyi güncelleyebilir. Snap/grid sonucu Rust projection'ından geldiğinde preview matrisi de o geometriye hizalanıyor.

Tek bir seçim çerçevesinin her seçili nesne için ayrı ayrı taşınması yerine ortak wrapper'a bir matrix uygulanıyor. Pointer-up'ta son Rust raster'ı hazırlanırken geçici bitmap görünür kalıyor; hazır final frame geldiğinde tek seferde değişiyor. Böylece arada eski konuma dönüş veya çift görüntü oluşmuyor. Move ve El/Pan yolları değiştirilmedi.

## ATLAS referansı

ATLAS salt okunur incelendi: `../atlas/apps/editor/src/application/selectionController.ts` içindeki `updateTransformDrag`, `scaleEntries` ve `commitEntries` akışları; `../atlas/apps/editor/src/canvas/handles.ts` içindeki `scaleTransform`, `rotateTransform` ve `scaleWithinBounds` yardımcıları. ATLAS'ta transform matematiği pointer hareketinde yerel seçime uygulanıyor ve render `requestRender` ile çizim döngüsüne bırakılıyor. Folio'da aynı geometri otoritesi Rust Session'da tutuluyor; bitmap preview raster işini pointer hareketinin görsel yolundan çıkarıyor.

Önce/sonra numeric ATLAS karşılaştırması bu WP'de yapılmadı; ölçüm önceki Folio transform preview yolunun matrix identity kaldığını belirledi ve yanlış preview nedeniyle önceki yol için karşılaştırılabilir latency baseline yok. Aşağıdaki sonuçlar Folio'nun düzeltilmiş yolunun gerçek tarayıcı ölçümleridir. Bunlar ATLAS ile eşdeğer gecikmenin kanıtı olarak sunulmuyor.

## Doğrulama komutu ve ortam

```sh
npm run test:wp37
```

Test gerçek Folio UI'ını, Chromium penceresini ve gerçek WASM/Rust Session'ı kullanır. Toplam **97 senaryo** (93 ölçümlü hareket ve doğruluk senaryoları) PASS oldu. Viewport 1366×768; zoom `%50/%100/%200`; DPR `1/2/4` kombinasyonlarının tümü; resize'ın sekiz yönü ve rotation matrisi çalıştırıldı. Soğuk başlangıçta preview cache temizlendi; sıcak başlangıçta önceden hazırlanan cache kullanıldı.

| Ölçüm | PASS sonucu |
|---|---:|
| İlk hareket → görünür değişen transform, ortalama (93 hareket) | 5.8 ms |
| Pointer → sonraki preview frame, ortalama / p95 | 5.9 / 12.1 ms |
| Frame time, ortalama / p95 | 9.5 / 13.9 ms* |
| Drag sırasında tam Rust raster | 0 |
| Pointer-up'ta tam Rust raster | 2 / hareket (aktif + overflow) |
| Drag sırasında React commit | 0 |
| Cache soğuk hazırlığı, 2 hareketin en yükseği | 8.4 ms |
| Cache sıcak hazırlığı | 0 ms ek hazırlık; cache warm hit |
| Hızlı ardışık resize → rotate ve ayrı Undo adımları | PASS |

\* Frame aggregate p95, gruplar arasında p95 değerlerinin özetidir. Ayrı ayrı 9 koşul tablosu aşağıda yer alıyor.

## Zoom / DPR matrisi

Her hücrede ortalama / p95 ms. “Final raster max” pointer-up'taki iki Rust raster'ın toplamının en yüksek tek hareket değeridir. Hareket başına iki Rust raster çağrısı yalnız bırakma sonrasında gerçekleşir.

| Zoom / DPR | İlk görsel tepki ort. | Pointer → preview ort. / p95 | Frame ort. / p95 | Final raster max | Drag raster | Drag long task sayısı |
|---|---:|---:|---:|---:|---:|---:|
| %50 / 1 | 5.70 | 5.78 / 11.3 | 8.43 / 14.0 | 20.8 | 0 | 9 |
| %100 / 1 | 5.91 | 5.80 / 12.1 | 7.65 / 14.0 | 9.1 | 0 | 0 |
| %200 / 1 | 5.17 | 5.67 / 11.8 | 7.72 / 13.9 | 11.6 | 0 | 0 |
| %50 / 2 | 6.12 | 5.69 / 12.1 | 10.94 / 7.1 | 76.1 | 0 | 9 |
| %100 / 2 | 6.80 | 6.08 / 12.3 | 8.85 / 7.1 | 27.1 | 0 | 9 |
| %200 / 2 | 5.61 | 5.55 / 6.3 | 8.66 / 7.1 | 25.9 | 0 | 9 |
| %50 / 4 | 5.97 | 6.05 / 11.1 | 14.00 / 13.9 | 85.6 | 0 | 9 |
| %100 / 4 | 5.46 | 6.30 / 12.4 | 10.69 / 13.9 | 40.8 | 0 | 9 |
| %200 / 4 | 5.47 | 5.97 / 18.2 | 10.72 / 20.8 | 44.0 | 0 | 9 |

Long task observer, sıcak başlangıçtaki 91 hareketin 63'ünde hareket aralığında en az bir `longtask` kaydetti. Soğuk iki harekette ve pointer-up sonrasında long task gözlenmedi. Bu, 60 FPS ve kusursuz takip kabulünü **PASS** saymaya izin vermez; transform bitmap'i doğru CSS matrix ile takip etse de yüksek raster/önizleme yükünde ana thread bloklanması testte sürüyor. Bazı long task'lar Playwright'ın görünür tarayıcıda context kurma, screenshot ve telemetry işlerinden etkilenebilir. Üretim kullanıcısı koşulunu ayırmak için daha uzun gerçek cihaz kaydı gerekir.

Tarayıcı physical display scan-out veya yüksek hızlı kamera/fotodiyot ölçümü yapmadı. Pointer-to-preview, event timestamp'inden matrix'i okunan ilk rAF frame'ine kadarki tarayıcı içi süredir; fiziksel panel latency'si değildir. Ayrıca input örneklerinin sentetik Playwright fare adımlarıyla üretildiğini, gerçek fiziksel fare örnekleme hızını temsil etmediğini not edin.

## Soğuk ve sıcak başlangıç

| Durum | Ölçümlü hareket | İlk görünür transform ort. | Pointer → preview ort. / p95 | Frame ort. / p95 | Cache hazırlığı | Drag raster |
|---|---:|---:|---:|---:|---:|---:|
| Soğuk, %100 / DPR1 | 2 | 5.65 ms | 5.48 / 5.9 ms | 7.53 / 13.8 ms | max 8.4 ms | 0 |
| Sıcak, zoom/DPR matrisi ve doğruluk hareketleri | 91 | 5.76 ms | 5.86 / 12.1 ms | 9.50 / 13.9 ms | 0 ms; cache hit | 0 |

Pointer-up render maliyeti yüksek DPR'de belirgin: tek harekette aktif + overflow raster toplamı en fazla `85.6 ms` (%50 / DPR4) oldu. Bu sırada preview görünür kalıyor; ancak pointer serbest bırakıldıktan sonra final Rust frame'in görünmesi gecikebilir.

## Geometri, etkileşim ve undo doğruluğu

| Senaryo | Sonuç |
|---|---|
| Tek nesne, 8 resize handle'ı | PASS — gerçek Rust projection/final geometri eşleşti |
| Tek nesne rotate | PASS — gerçek Rust açısı ve final geometri eşleşti |
| Metin kutusu resize ve rotate | PASS |
| Çoklu seçim resize ve rotate | PASS — tüm nesneler ve grup bounds Rust Session'dan projekte edildi |
| Döndürülmüş nesne resize | PASS — rotation korunup rect değişti |
| Shift oran koruma ve 15° angle snap | PASS — motor snap toleransı içinde |
| Flip sınırı / minimum boyut sınırı | PASS — flip durumu Rust projection ile doğrulandı |
| Canvas dışına taşan nesne | PASS |
| Tek resize / rotate için Undo ve Redo | PASS — başlangıç ve son geometri karşılaştırıldı |
| Pointer-up final render geçişi | PASS — preview final frame hazır olana dek görünür kaldı |
| Hızlı ardışık resize + rotate | PASS — ayrı Undo/Redo adımları |
| Move regresyonu | PASS — `npm run test:wp36`, görünür Chromium; drag render 0, multi-select ve Undo PASS |
| El/Pan | Kod yolu değiştirilmedi; WP3.7 sırasında ayrıca pan testi çalıştırılmadı |

Shift ile köşe resize'da Rust smart/grid snap oranı az miktarda değiştirebildi; test motor snap toleransını kabul ediyor ve Rust projection ile final geometri eşitliğini ayrıca doğruluyor. Selection handles aynı önizleme matrix wrapper'ını izliyor.

## Teknik kabul ve kalanlar

- **Compositor transform yolu:** PASS
- **Pointer hareketinde tam slayt/overflow raster yok:** PASS
- **Rust Session tek belge/geometri otoritesi:** PASS
- **Undo/Redo tek işlem:** PASS
- **Zoom/DPR ve belirtilen geometri doğruluğu:** PASS
- **Kullanıcı kabulü “Move kadar akıcı”, fiziksel latency ve long task'sız akış:** Bu tarayıcı ölçümüyle kanıtlanmış değil. Drag long task sayısı ve yüksek DPR pointer-up raster maliyeti var; kullanıcı kabulü için fiziksel fare ve gerçek cihazla devam ölçümü gerekir.

## Değiştirilen/eklenen WP3.7 dosyaları

- `apps/editor/src/ui/workspace/EditorWorkspace.tsx`
- `apps/editor/src/features/engine/editorEngine.ts`
- `apps/editor/src/features/engine/browserTestHooks.ts`
- `apps/editor/src/App.tsx`
- `apps/editor/src/styles/app.css`
- `crates/folio-wasm/src/lib.rs` — `textBox` slide projection field
- `packages/engine-adapter/src/index.ts` — matching optional projection type
- `scripts/wp37-transform-regression.mjs`
- `package.json` — `npm run test:wp37`

Ek doğrulamalar: `npm run typecheck`, `npm run build` ve `git diff --check` PASS. `atlas/` yalnızca salt okunur kaynak incelemesinde kullanıldı. `deckcraft/` değiştirilmedi. WP4'e başlanmadı.

## Selection & Interaction sistemi ek kapsamı

Cursor, tooltip ve metin modu davranışları aynı gerçek UI/WASM testine eklendi. Hedefli testler:

- Resize size tooltip: PASS; preview affine matrix'inden güncel `W × H` hesaplanıyor.
- Rotate tooltip: PASS; Rust transform preview matrix'inden 0–359° değer gösteriliyor.
- Resize cursor yönü: handle ve nesne rotasyonuna göre 45° adımlarda güncelleniyor. Handle ekran boyutu zoom'a ters orantılı kalıyor.
- Rotate cursor: özel SVG cursor; simge mevcut nesne açısına göre çevriliyor.
- Dört köşe çevresindeki rotate hit-zone'ları: PASS. UI hit-zone başlangıçta Rust'ın bilinen rotate tutamacına eşleniyor; sonraki pointer koordinatları başlangıç açı farkını koruyor. Test Rust geometrisini ve tek Undo/Redo'yu doğruladı.
- Canvas hover: boş alanda `default`, shape üzerinde `move`, text box veya metin içeriğinde `text`. Hover, Rust projection bounds'ını kullanır; pointer hover yeni Rust raster'ı başlatmaz.
- Text editing mode: PASS. Seçili metinde Enter ve çift tıklama `text.edit` başlatır; textarea'da Escape Rust Session `text.exit` çağırıp seçim moduna döner. Düzenleme alanındaki caret tıklamaları textarea'da kalır ve HTML textarea shape rotation'ını izler.
- Alt merkezden resize: PASS. Alt basılıyken grid snap atlanır; model merkezi 1.1 document unit toleransıyla korunur (motorun Cpt yuvarlaması en fazla birimlik sapma üretebilir).

Cursor'ın boş yazılı normal şekilleri text box sanmaması için Rust slide projection'ına `textBox` bilgisi eklendi; adapter tipi geriye uyumlu opsiyonel alan olarak tanımlandı.
