# WP3.8 — UX tamamlanma ve doğrulama raporu

Tarih: 2026-11-05
Kapsam: Rotate cursor, Move/Resize/Rotate performansını yeniden ölçme, Rust Session bağlı context menu'ler, TR/EN yerelleştirme.

## Sonuç

Cursor, sağ tık menüleri ve yerelleştirme başlıkları gerçek Folio arayüzünde uygulanıp Chromium'da doğrulandı. Eski ATLAS yalnızca salt okunur davranış referansı olarak kullanıldı. WP3.6/WP3.7 raster-preview mimarisi ve El/Pan kod yolu değiştirilmedi.

Performansın ölçülen drag-preview yolu PASS: matrislerde pointer hareketi sırasında tam Rust raster çağrısı yok; compositor preview hareket ediyor ve tek undo/Rust geometry doğrulanıyor. Ancak önizleme cache'inin soğuk hazırlığı, DPR2/4 frame p95 değerleri, long task'lar ve pointer-up raster maliyeti yüksek çıkabiliyor. Harici ekran/gerçek fare gecikmesi ölçülemediği için doğal fiziksel kullanıcı akıcılığı kabulü **BLOCKED**. WP3.8 bütünüyle tamamlanmış sayılmıyor.

## 1. Rotate cursor ve rotation UX — PASS

- **Önce:** Rotation tutamacı Move ile karışabilecek `grab` cursor'ı kullanıyordu.
- **ATLAS incelemesi:** `atlas/apps/editor/src/application/selectionController.ts` ve `atlas/apps/editor/src/canvas/handles.ts` salt okunur incelendi. Rotation ayrı bir kontrol ve köşe hit-zone'larıyla yapılır.
- **Değişiklik:** Rotate tutamacı için sabit yönlü, küçük SVG cursor; nesne açısına göre döndürülmüyor. Move `move`, resize handle'ları yönlü resize cursor'ı kullanıyor. Rotate görsel/hit alanı resize handle alanından ayrıldı. Canvas klavyeyle odaklanabilir yapıldı.
- **Test:** Güncel `npm run test:wp37` (görünür Chromium; 107 senaryo / 102 ölçümlü transform hareketi) PASS; doğruluk senaryolarında cursor hover ve sabit kontroller doğrulandı. Önceki hedefli `WP37_ONLY=cursor` PASS. %50/%100/%200 zoom, DPR1/2/4 ve 1366×768/1920×1080; cursor farkı, handle hedefi ve CSS boyutu kapsandı.
- **Sınır:** Fiziksel ekran çözünürlüğü/scan-out testi yapılmadı; DPR testleri Chromium emülasyonudur.

## 2. Move / Resize / Rotate performansı — ölçüm PASS, akıcılık kabulü BLOCKED

### Ölçüm yöntemi

Görünür Chromium penceresinde gerçek Folio React UI'ı, gerçek Rust/WASM Session ve Playwright pointer hareketleri kullanıldı. İlk görsel tepki, pointer timestamp'inden transform matrix'inin ilk değiştiği animation frame'e; pointer-to-preview ise sonraki ölçümlü frame'e kadardır. Gerçek fiziksel panel gecikmesi ölçülmüş sayılmaz. DPR1/2/4 × zoom%50/%100/%200 matrisi, 20 soğuk/sıcak hareket çalıştırıldı. Bu WP3.8 tekrarı 20 hareketlik önceki matris koşusundan ayrı tutuldu.

| İşlem | İlk hareket → görünür transform | Pointer → preview ort. / p95 | Frame ort. / p95 | Drag sırasında tam Rust raster |
|---|---:|---:|---:|---:|
| Move, uzun soak sıcak 9 koşul | 6.12 ms | 6.05 / 6.6 ms | 6.95 / 7 ms | 0 |
| Resize, soğuk 100%/DPR1 | 26.8 ms | 5.64 / 6 ms | 7.01 / 7 ms | 0 |
| Resize, uzun soak sıcak 9 koşul | 27.11 ms | 5.73 / 6.4 ms | 7.22 / 7 ms | 0 |
| Rotate, soğuk 100%/DPR1 | 5.7 ms | 5.89 / 6.3 ms | 7.04 / 7 ms | 0 |
| Rotate, uzun soak sıcak 9 koşul | 5.70 ms | 5.76 / 6.4 ms | 7.23 / 7 ms | 0 |

Enstrümantasyonun son sürümüyle uzun soak görünür Chromium'da 29 gesture çalıştırdı: 27 sıcak Move/Resize/Rotate ve 2 soğuk Resize/Rotate; her hareket 60 pointer örneğiyle yaklaşık bir saniye sürdü. Zamanlanan drag'larda ekran görüntüsü alınmadı. İşlem türlerine göre sıcak pointer-to-preview/p95 Move `6.05/6.6 ms`, Resize `5.73/6.4 ms`, Rotate `5.76/6.4 ms`; frame ort./p95 sırasıyla `6.95/7`, `7.22/7`, `7.23/7 ms` oldu. İlk transform frame ortalaması Move `6.12 ms`, Resize `27.11 ms`, Rotate `5.70 ms`; soğuk Resize/Rotate'da `26.8/5.7 ms` idi. Pointer handler `0.063–0.19/0.2–0.4 ms`, Rust pointer adapter `0.139–0.216/0.5–0.7 ms`, queue `0.005–0.07/0.1 ms`, projection `0.033–0.048/0.1–0.2 ms` aralığında ölçüldü. Preview hareketi sırasında Rust raster çağrısı 0; sıcak cache hazırlığı 0 ms. Pointer-up başına iki final raster (slayt + overflow); DPR4 pointer-up tepesi `%50/DPR4`'te `63.1 ms`. Sıcak raster ortalama active/overflow Move `17.53/8.79 ms`, Resize `18.03/9.02 ms`, Rotate `18.28/9.01 ms`; işlemlerin en yüksek raster süreleri `59.3/63.1/61.9 ms`. Thumbnail refresh her gesture sonrası bir kez yapıldı (`9` çağrı/işlem türü, toplam `2.9–3.4 ms`); WASM memory page artışı `0 byte`. React commit ortalaması Move `0`, Resize/Rotate `2`; Profiler render süresi ort./p95 Move `4.77/17.3`, Resize `6.48/13.7`, Rotate `6.63/14.5 ms`. Long task sayıları 27 sıcak gesture'ın `7` hareket aralığında, `13` pointer-up aralığında; en uzun ölçümler `137/174 ms`. rAF telemetry overhead `0.133/0.5 ms` ort./p95. Zamanlanan drag'larda screenshot yoktu ama otomasyon input'u ve Chromium process yükü uygulama işinden tam ayrılamadı; bu long task'lar doğrudan kullanıcı donması diye nitelenemez. Canvas aktarımı main-thread maliyetidir; compositor GPU işi ayrıca ölçülmedi.

**Ölçek optimizasyonu önce/sonra:** Render ve preview scale şimdi `min(4, max(1, DPR × zoom))` olarak hesaplanıyor; önce DPR 4 her zoom'da 4× ölçek üretiyordu. Bu, `%50/DPR4`'te 3840×2160 yerine 1920×1080 backing raster kullanır (piksel sayısında %75 azalma). Aynı görünür soak'ta `%50/DPR4` pointer-up raster tepe ölçümü `78.4 → 63.1 ms` oldu (`−19.5%`); `%100/%200 DPR4` değerleri pratikte değişmedi. Move/Resize/Rotate pointer-preview ortalamaları önce/sonra sırasıyla `6.05→6.05`, `5.72→5.73`, `5.70→5.76 ms`; performans iyileştirmesi drag takip gecikmesini değiştirmedi. Raster kazancı var fakat finalizasyon hâlâ `63.1 ms` tepeye ulaşıyor ve long-task ayrıştırması açık olduğundan kabul BLOCKED kalıyor.

Move karşılaştırma noktası: WP3.5 akışında her pointermove tam slayt/overflow render maliyeti taşıyordu; WP3.6 sonrasında 0 drag raster ve 0 px CSS residual raporlanmıştı. Şimdiki matris, compositor preview ve Rust Session davranışının korunduğunu gösteriyor. WP3.7 önceki tek koşullu DPR4 pointer-up örnekleri `34–36 ms` idi; tekrarlanan WP3.8 koşuları `62.6–152.8 ms` aralığında değişti. Raster kalitesi düşürülmedi ya da final raster atlanmadı: bu, bırakma anında Rust Session'ın nihai geometrisini ve tam çözünürlüklü canvas'ı yeniden eşleştirmek için gereken adımdır. Ölçüm, bu sonlandırma maliyetinin kabul edilebilir olduğunu kanıtlamıyor; uygulama kodu / test harness yükü ayrıştırması ve WASM memory/GPU maliyeti eksik.

**Darboğaz değerlendirmesi:** Pointer'ın görsel takip yolunda Rust tam render'ı kaldırılmış; preview matrix hızlı yanıt veriyor. Kalan ölçülen maliyet pointer-up'taki final Rust raster ve DPR4'teki yüksek çözünürlüklü bitmap/overflow işleri. Uzun görev kayıtları test harness yükünü de içerebildiğinden, bunların gerçek kullanıcı CPU bloklanmasıyla payı bu turda güvenilir biçimde ayrıştırılamadı. Bu nedenle performans kullanıcı kabulü için 0 ms fiziksel gecikme veya 60 FPS garantisi verilmiyor.

| Performans kabulü | Sonuç | Kanıt / açık nokta |
|---|---|---|
| Move / Resize / Rotate görsel preview hareket yolunda tam Rust render yok | PASS | Görünür Chromium matrix testleri; 0 drag raster |
| Tek Undo ve Rust geometri otoritesi korunuyor | PASS | WP3.6/WP3.7 gerçek Session Undo/Redo senaryoları |
| Pointer / ilk preview / frame sürelerinin matris ölçümü | PASS | `npm run test:wp36` + `npm run test:wp37`; aşağıdaki komutlar |
| Fiziksel fare kullanıcı akıcılığı, test yükünden ayrılmış long-task ölçümü | BLOCKED | Harici yüksek hızlı video/fotodiyot ve otomasyon dışı uzun ölçüm yok |
| DPR4 pointer-up raster maliyetinin kabul edilebilirliği | BLOCKED | Ölçek optimizasyonu sonrası uzun soak tepe 63.1 ms (%50/DPR4); test yükünden ayrılmış kullanıcı ölçümü yok |
| React commit, WASM memory ve compositor maliyetlerinin ayrıştırılması | BLOCKED | React render/commit, WASM page delta ve Canvas aktarımı ölçüldü; GPU/compositor süresi doğrudan ölçülemez, automation CPU payı ayrışmıyor |

Tarayıcı `requestAnimationFrame` / CSS matrix metrikleri fiziksel panel latency'si değildir. Playwright fare adımları gerçek HID örneklemesini temsil etmez. DPR×zoom raster ölçeği dışında renderer refactor'u yapılmadı; pointer-up'ta raster atlanmadı ve El/Pan değişmedi. Kullanıcı akıcılığı ve maliyet ayrıştırma ölçütleri açık kalıyor.

## 3. Sağ tık menüleri — PASS

- **Önce:** Folio'da canvas/slayt context menu yoktu. ATLAS `ui/contextMenu.ts` ve `ui/contextMenuEvents.ts` salt okunur referans alındı.
- **Değişiklik:** `EditorContextMenu.tsx` ortak Folio Button/Icon ve mevcut token'larla nesne, boş canvas ve slayt kartı menülerini sağlar. Menü viewport içinde kalır; Escape, dışarı tıklama, ok/Home/End klavye hareketleri ve canvas'ta Shift+F10/ContextMenu tuşları çalışır. Sağ tık seçimi korur; başka nesneye tıklanınca Rust Session'a seçilir.
- **Gerçek Session eylemleri:** Nesne Kes/Kopyala/Yapıştır/Çoğalt/Sil, öne/arkaya alma, hizalama ve kilit; canvas Yapıştır/Tümünü seç/Izgara/Ekrana sığdır; slayt ekle/çoğalt/sil/sırala/düzen. Sıralama kenarlarında geçersiz yön devre dışıdır; son slayt silinemez.
- **Kök neden düzeltmesi:** Eski UI `shape.duplicate` ve `shape.delete` çağırıyordu; DeckCraft komutları `edit.duplicate` ve `edit.delete`. Adapter komut union'u ve üst/context menüleri gerçek API adlarına geçirildi. Bu nedenle daha önce pasif görünen çoğalt/sil komutları gerçek Rust Session'a gidiyor.
- **Test:** `npm run test:wp38` PASS — görünür Chromium'da dil, seçili nesne çoğalt/sil + Undo/Redo, Session kopyala/yapıştır, boş canvas, klavye/dışarı tıklama ve slayt çoğalt/sil/son-slayt kuralı. Browser console/page errors yok.
- **Sınırlar:** Clipboard testleri Rust Session içi clipboard'ı doğrular; işletim sistemi clipboard entegrasyonu kanıtı değildir. Menülerde yalnız DeckCraft komut dispatcher'ında bulunan işlemler gösterilir.

## 4. TR/EN yerelleştirme — PASS

- `features/localization/locale.tsx` merkezi sözlük ve `LocaleProvider` sağlar. Başlangıçta `folio.locale` localStorage değeri; yoksa tarayıcı dili seçilir. `document.documentElement.lang` eşzamanlanır.
- TR/EN seçicisi mevcut Görünüm menüsündedir; ek rail veya navigasyon öğesi yoktur. Değişiklik React'i yeniden başlatmadan header, menü, rail, paneller, status, tooltip ve context menu metinlerini günceller.
- Rust Session'a locale set edilir; varsayılan placeholder prompt'ları yalnız render projection'ında çevrilir. Testte başlık ve slayt projeksiyonu dil değişiminden önce/sonra karşılaştırıldı; kullanıcı içeriği değişmedi. Yorum panelinin sabit örnek yazıları çevrilir; kullanıcının gönderdiği metin aynen kalır.
- **Test:** `npm run test:wp38` PASS — Türkçe tarayıcı fallback, TR→EN→TR, localStorage, html lang, placeholder canvas piksel çıktısı, rail/menu/context menu etiketleri, İngilizce sunum modu ve çıkış kontrolü, Rust document projection kararlılığı.
- **Sınır:** Bu sürüm yalnız Türkçe ve İngilizceyi içerir; diğer diller sözlük eklenmesini bekler.

## Tam regresyon komutları

| Komut | Sonuç |
|---|---|
| `npm run test:wp35` | PASS — 25 gerçek tarayıcı senaryosu; UI, text, media ve performans ölçümleri |
| `npm run test:wp36` | PASS — görünür Chromium, tek/çoklu seçili move ve Undo/Redo |
| `WP36_MATRIX=1 node scripts/wp36-move-preview-regression.mjs` | PASS — 9 zoom/DPR koşulu, `%50/%100/%200 × DPR1/2/4` |
| `npm run test:wp37` | PASS — görünür Chromium, 107 senaryo / 102 ölçümlü transform hareketi; 100 sıcak gesture'da 25 drag ve 46 pointer-up long task kaydı (otomasyonla karışık) |
| `WP37_ONLY=matrix-perf WP37_SOAK=1 npm run test:wp37` | PASS — görünür Chromium, 27 sıcak Move/Resize/Rotate + 2 soğuk gesture, her biri 60 pointer örneği; bu tekrar pointer-to-preview ort./p95 5.84/6.6 ms, frame ort./p95 7.16/7 ms ve pointer-up raster tepesi 62.1 ms ölçtü |
| `npm run test:wp38` | PASS — WP3.8 context menu, i18n ve sunum modu regresyonu |
| `npm run regression:wp2` | PASS — Folio release WASM, gerçek Chromium headless; pointer, RGBA render, Undo/Redo, batch 100/1000, synthetic PPTX round-trip |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |

## 2026-11-05 overflow raster optimizasyonu ve arka plan regresyonu

Pointer-up final render'ında slayt dışına taşma bitmap'i artık yalnızca Rust projection geometrisi slayt sınırına yaklaşınca veya taşınca üretiliyor. Döndürülmüş bounds hesaba katılıyor; bilinmeyen bounds güvenli tarafta kalıp overflow render'ı tetikliyor. Slayt içinde 64 design-unit emniyet payı kullanılıyor. Taşma gerekmeyen durumda overflow canvas temizlenip gizleniyor; eski bitmap ekranda kalmıyor. Bu karar geçici görsel önizlemeyi veya Rust Session otoritesini değiştirmiyor.

`WP37_ONLY=matrix-perf WP37_SOAK=1 npm run test:wp37` görünür Chromium'da 29 gesture ile tekrarlandı (27 sıcak, 2 soğuk). Önceki koşuda pointer-up raster tepesi `62.1 ms`, yeni koşuda `22.5 ms` oldu (bu koşuda yaklaşık `%63.8` düşük). Sıcak gesture'larda aktif raster ort./p95 `9.274/22.3 ms`; güvenli biçimde slayt içindeki 27 hareketin tamamında gereksiz overflow raster'ı atlandı. Pointer-to-preview `5.82/6.5 ms`, frame `7.12/7 ms` ölçüldü. Hedefli taşma testi overflow canvas'ın üretilip görünür olmasını, içerideki geometri ise raster atlanıp canvas gizlenmesini assertion ile doğruladı. WP3.5'in büyük 100/500/1000 nesne senaryoları da overflow boyutlarının bulunmasını raporladı; bu testte büyük sahne overflow'u için ayrıca assertion yok.

Bu soak'ta 10 drag ve 8 pointer-up long task ölçüldü; en uzunları `122/136 ms`. Bu nedenle overflow raster optimizasyonu pointer-up tepesini düşürse de kullanıcı akıcılığı kabulini açmıyor; fiziksel giriş/ekran gecikmesi ayrıca ölçülmedi ve WP3.8 **BLOCKED** kalıyor.

Arka plan regresyon doğrulamasında eski WP3.5 harness'i `renderOverflowCalls > 0` şartı yüzünden yeni compositor preview mimarisinde hatalı FAIL veriyordu: normal tek nesne slayt içinde olduğundan overflow bitmap'i kasıtlı olarak yok. Test beklentisi gerçek davranışa uyarlandı: performans matrisi sırasında drag'de tam raster yok; pointer-up'da tek final active raster; iç geometride overflow raster yok ve canvas gizli. Büyük 100/500/1000 nesne sahnelerinde taşan geometri overflow raster'ını üretmeye devam ediyor.

| Tekrar | Sonuç |
|---|---|
| `npm run test:wp35` | PASS — 25 senaryo; headless Chromium; 1366×768 ve 1920×1080, DPR1/2, zoom%50/100/200, 100/500/1000 nesne; in-bounds raster şartları ve büyük sahnelerde Undo/Redo |
| `npm run test:wp38` | PASS — context menu, gerçek Session duplicate/delete/clipboard ve TR/EN |
| `npm run test:wp37` | PASS — 107 senaryo / 102 transform hareketi; in-bounds/out-of-bounds overflow görünürlüğü |
| `npm run typecheck && npm run build` | PASS |
| `git diff --check`; `node --check scripts/wp37-transform-regression.mjs` | PASS |
| `npm run test:wp36` | PASS — görünür Chromium move preview, multi-select ve Undo/Redo |
| `WP36_MATRIX=1 node scripts/wp36-move-preview-regression.mjs` | PASS — görünür Chromium DPR/zoom matrisi ve pointer görüntü kanıtı |
| `npm run regression:wp2` | PASS — gerçek Folio release WASM; 5 motor grubu, synthetic PPTX round-trip |

WP3.5 matrisinde ölçülen FPS emüle edilmiş Chromium koşuludur; test sırasında görülen `30–53.3 FPS` aralığı otomasyon/headless yükünü de içerir, fiziksel kullanıcı deneyimi ölçümü değildir. `atlas/` ve `deckcraft/` değişmedi.

### Tam WP3.8 kabul denetimi ve en güncel görünür Chromium koşusu

WP3.8'in bütün zorunlu komutları bu çalışma ağacında tekrarlandı: `npm run test:wp35`, `npm run test:wp36`, `WP36_MATRIX=1 node scripts/wp36-move-preview-regression.mjs`, `npm run test:wp37`, `WP37_ONLY=matrix-perf WP37_SOAK=1 npm run test:wp37`, `npm run regression:wp2`, `npm run test:wp38`, `npm run typecheck`, `npm run build`. Değişiklik öncesi hepsi PASS. Preview ölçeği değişikliğinden sonra WP36 ana/matrix testleri, WP37 tam/soak testleri, typecheck/build PASS. `git diff --check`, iki regresyon script'inde `node --check` PASS; `git status --short -- atlas deckcraft` boş.

Preview ölçeği sınırlandırma değişikliği: transient selected-object bitmap scale `min(2, DPR) × zoom` oldu; final document render scale'i değişmedi. Böylece DPR4/%50 preview `1920×1080` (8.3 MB RGBA) yerine `960×540` (2.1 MB, %75 daha az piksel) üretir. Görünür Chromium WP36 matrisinde 9 koşul PASS, drag raster çağrısı 0, seçili pikseller/Undo/Redo doğrulandı. DPR4 ölçümleri önceki görünür matrix'e göre: `%50` hazırlık `105.95 → 43.55 ms`, bitmap `1920×1080 → 960×540`; `%100` `60.25 → 51.15 ms`, `1920×1080` aynı; `%200` yeni koşuda `87.35 ms`, `3840×2160` aynı. `%200` 27.8 ms frame p95 yine gözlendi. Bu iki test koşusu farklı sistem yüklerinde olduğu için süre farkları kesin benchmark iddiası değildir; raster boyutu değişimi doğrudan kanıtlanmıştır. WP37 soak/full testler preview kalite boyutu assertion'larıyla PASS, fakat long task'lar sürdüğü için P1 performans kabul kriteri tümüyle PASS değil. Düşük DPR/zoom bitmap'inin yüksek görünüm zoom'unda compositor ile büyütülmesi daha yumuşak kenar oluşturabilir; şu an E2E opaque pixel/overlay testleri PASS, görsel kalite gerçek cihazda ayrıca değerlendirilmelidir.

| WP3.8 konusu | Durum | Kanıt |
|---|---|---|
| Rotate cursor/hit-zone ve rotation UX | PASS (Chromium emülasyonu) | WP3.7 cursor senaryoları, zoom/DPR/viewport kontrolleri; fiziksel cihaz testi yok |
| Context menu gerçek kullanıcı akışları | PASS | WP3.8 Playwright: shape/canvas/slide, duplicate/delete, Undo/Redo, clipboard, keyboard/dismiss |
| TR/EN yerelleştirme | PASS | WP3.8 Playwright: tarayıcı fallback, localStorage, canlı TR↔EN, Rust placeholder ve içerik korunumu |
| Drag compositor yolu / Rust otoritesi / undo | PASS | WP36 visible matrix + WP37 gerçek Session transform/regresyonları |
| Cache cold-start ve tüm DPR4/frame koşullarında kullanıcı akıcılığı | BLOCKED | Raster/pixel sayısı azaldı; DPR4/%50 preparation 43.55 ms, DPR4/%200 87.35 ms; bazı frame p95 27.8 ms ve WP37 long task'ları sürüyor |
| Gerçek fiziksel fare/display latency ve otomasyondan ayrık long task ölçümü | BLOCKED | Tarayıcı ölçümleri var, fiziksel scan-out/high-speed capture yok; otomasyon CPU etkisi tümüyle ayrıştırılmadı |

Bu sebeple dört ana başlık uygulanmış ve çoğu fonksiyonel kabulü geçmiştir; ancak brief'in “akıcılık doğrulanmadan tamamlandı deme” koşulu nedeniyle WP3.8 tamamlanmış sayılmıyor. Gerçek cihazda soğuk seçim/transform hazırlığını ve renderer/harness yükü ayrımını çözmek gerekir.

### Cold/warm transform matrisi — 2026-11-05

WP37 harness'i genişletildi: matrix-perf artık dokuz zoom/DPR koşulunun her birinde Move, Resize ve Rotate için hem cold hem warm başlangıç çalıştırıyor. Cold vakalarda cache miss/preparation, warm vakalarda cache hit assertion'ı uygulanıyor. İzole görünür Chromium koşusu `WP37_ONLY=matrix-perf WP37_SOAK=1 npm run test:wp37` ile 54 gesture çalıştırdı; PASS, `correctnessCases: []`.

| Cold/warm | Gestures | Pointer-to-preview avg/p95 | Frame avg/p95 | Max preview preparation | Drag/pointer-up long task |
|---|---:|---:|---:|---:|---:|
| Cold | 27 | 5.84 / 6.6 ms | 7.07 / 7 ms | 159 ms | 6 / 10; max 108 / 122 ms |
| Warm | 27 | 5.82 / 6.6 ms | 7.08 / 7 ms | 73.9 ms (refresh/prewarm sample) | 5 / 11; max 125 / 132 ms |

İşlem bazında cold max preparation Move `159 ms`, Resize `146.2 ms`, Rotate `139.2 ms`; warm max Move `69.6 ms`, Resize `72.7 ms`, Rotate `73.9 ms`. Drag sırasında tam Rust raster `0`, WASM memory delta `0`; pointer-up raster max `22.2 ms`. Bu, warm drag takibinin hızlı olduğunu doğrular, ama cold preview hazırlığının hâlâ ana iş parçacığını uzun süre meşgul edebildiğini gösterir. Scale cap raster boyutunu azaltmış olsa da renderer’ın senkron 4-layer hazırlığı cold gecikmesini çözmedi. WP3.8 performans/kullanıcı akıcılığı kabulü **BLOCKED** kalır.

WP2 PPTX testi DeckCraft export/import synthetic round-trip'tir; Microsoft PowerPoint uyumluluğu kanıtı değildir. `atlas/` ve `deckcraft/` değiştirilmedi; WP4'e başlanmadı.

### Arka plan regresyonu ve transient preview ölçek sınırı — 2026-11-05

Kullanıcının talebi üzerine tarayıcı regresyonları görünür Chromium'da arka plan süreçleri olarak, birbirini ölçüm açısından etkilememeleri için sırayla çalıştırıldı. Güncel çalışma ağacındaki sonuçlar:

| Komut | Sonuç |
|---|---|
| `npm run regression:wp2` | PASS — gerçek release WASM, pointer/render/undo/batch/PPTX synthetic round-trip |
| `npm run test:wp35` | PASS — 25 senaryo; DPR2 yüksek zoom'da 40.3–44.6 FPS ve 1920×1080/DPR2/%100'de 41.7 FPS görüldü; bu değerler emüle edilmiş Chromium ölçümüdür |
| `npm run test:wp36` | PASS — görünür Chromium, compositor Move preview, multi-selection ve Undo/Redo |
| `WP36_MATRIX=1 node scripts/wp36-move-preview-regression.mjs` | PASS — 9 zoom/DPR koşulu; her drag'de Rust tam raster 0, piksel ve geometri kontrolleri geçti |
| `npm run test:wp37` | PASS — 107 senaryo / 102 transform hareketi |
| `WP37_ONLY=matrix-perf WP37_SOAK=1 npm run test:wp37` | PASS — 54 transform hareketi; 27 cold + 27 warm |
| `npm run test:wp38` | PASS — 7 locale/context-menu/presentation kontrolleri, browser error yok |
| `npm run typecheck`, `npm run build`, syntax kontrolleri, `git diff --check` | PASS |

54-hareket matrisinde cap öncesi transient raster ölçeği `min(2, DPR) × zoom` ile 4×'e çıkabiliyordu. Soğuk preview hazırlığı en fazla `162 ms`, DPR2/%200 ve DPR4/%200 koşullarındaki hareket long task'ları `98/113 ms` ölçülmüştü. `previewRenderScale()` yalnız geçici seçili-nesne bitmap'ini en fazla 3× ile sınırlar; tam belge render ölçeği değişmez. Bu üst sınır 4×'ten 3×'e geçtiği DPR2/4 × %200 koşullarında geçici raster piksel sayısını %43.75 azaltır. WP36 dokuzlu matrisi yeni boyut assertion'larıyla PASS oldu: bu koşullarda bitmap `3840×2160` yerine `2880×1620`; Rust Session geometrisi, eski konumun temizlenmesi ve Undo/Redo korundu.

Aynı WP37 soğuk/sıcak matrisinin yeni tekrarı PASS: 54/54 hareket; cold pointer-to-preview ort./p95 `5.85/6.6 ms`, frame ort./p95 `7.08/7 ms`, en yüksek preview preparation `126.2 ms`, hareket sırasında 6 long task ve en yüksek `98 ms`; warm `5.83/6.6 ms`, frame `7.07/7 ms`, max preparation `55.9 ms`, hareket sırasında 4 long task ve en yüksek `85 ms`. DPR2/%200 cold max preparation `125.4 ms`, hareket long task max `98 ms`; DPR4/%200 sırasıyla `126.2 ms` ve `87 ms`. Drag sırasında tam Rust raster çağrısı 0 kaldı. Önce/sonra tepe hazırlık süresi `162 → 126.2 ms` (yaklaşık `%22` düşük); tekrarlı ölçüm Chromium/host yükünü de içerdiğinden kesin benchmark garantisi değildir. Ölçek ve piksel boyutu düşüşü doğrudan doğrulandı.

3× cap sonrasında tam `npm run test:wp37` doğruluğu da PASS oldu: 107 senaryo, 102 ölçümlü transform hareketi; cursor/handle, metin düzenleme ve inherited placeholder click-to-edit senaryoları geçti. 100 sıcak harekette `25` drag ve `26` pointer-up long task; en uzunları `88/112 ms`. `npm run test:wp38` tekrarında 7 kontrol PASS ve Chromium error yok. Son `npm run typecheck`, `npm run build`, test script syntax ve `git diff --check` PASS; `git status --short -- atlas deckcraft` boş.

Scale değişikliğinden sonra son `npm run test:wp35` da 25 senaryoda PASS oldu; bu harness headless Chromium kullanıyor. Tekrardaki ağır örnekler 100 nesne/DPR2 `%100` için `36.8 FPS`, ortalama frame `27.17 ms`, p95 `100 ms`; 1000 nesne/DPR2 `%100` için `42.7 FPS`, ortalama `23.42 ms`, p95 `33.4 ms`. Bu test özellikle raster/projection sahne yükünü gösterir; gerçek ekran akıcılığının doğrudan ölçümü değildir. Aynı son kaynak ağacında `npm run regression:wp2` da PASS oldu; PPTX sonucu sentetik DeckCraft round-trip'tir.

Bu küçük optimizasyon yüksek DPR/yüksek zoom'da preview hazırlığını azalttı, fakat cold transform öncesinde 126 ms'ye ulaşan hazırlık ve 98 ms long task kaldı. Ayrıca WP3.5 emüle edilmiş matrisinde DPR2/yüksek zoom FPS 40.3–44.6 aralığına indi. Gerçek HID/display latency ölçülmedi. Dolayısıyla ölçüm raporu güncellendi ama performans kabulü **BLOCKED** kalıyor; bu değerler PASS olarak sunulmuyor. `atlas/` ve `deckcraft/` salt okunur kaldı, WP4'e başlanmadı.

## 2026-11-05 doğrulama tekrarı

İşlem ağacındaki güncel kodla tüm istenen regresyon komutları yeniden çalıştırıldı. `npm run test:wp35`, `npm run test:wp36`, `WP36_MATRIX=1 node scripts/wp36-move-preview-regression.mjs`, `npm run test:wp37`, uzun WP3.7 soak, `npm run test:wp38`, `npm run regression:wp2`, `npm run typecheck`, `npm run build` ve `git diff --check` PASS.

WP36 matrisinin eski raster boyutu assertion'ı zoom etkisini hesaba katmıyordu: `%50 × DPR2`'de doğru 960×540 çıktıyı yanlışlıkla DPR altı sayıyordu. Regresyon beklentisi etkin `min(4, max(1, DPR × zoom))` formülüne bağlandı. Güncel 9 zoom/DPR koşulunun tamamı PASS; drag sırasında `renderSlide` / overflow raster çağrısı 0 ve Undo/Redo doğrulandı.

Güncel WP3.7 tam koşusu 107 senaryo ve 102 transform hareketi çalıştırdı. 100 sıcak hareketin ortalama/p95 pointer-to-preview süresi `5.67/11.9 ms`, frame süresi `8.69/13.9 ms`; pointer-up raster tepesi `65.1 ms`. Hareket aralığında 25, pointer-up aralığında 46 long task kaydedildi; en yüksek süreler `139/163 ms` idi. Bu sonuçlar otomasyon yükünden bütünüyle ayrışmadığı için gerçek kullanıcı akıcılığını PASS kanıtlamıyor.

Uzun soak tekrarı 29 hareket (27 sıcak, 2 soğuk; 60 pointer örneği/hareket) çalıştırdı. Sıcak hareketlerde pointer-to-preview ort./p95 `5.84/6.6 ms`, frame `7.16/7 ms`, aktif/overflow Rust raster ortalaması `17.619/8.881 ms`, pointer-up raster tepesi `62.1 ms` oldu. Drag sırasında tam Rust raster 0; WASM memory artışı 0 byte. Drag aralığında 8, pointer-up aralığında 13 long task; en yüksekleri `143/168 ms`. Preview takibi hızlı, fakat son raster/long-task maliyetleri ve otomasyon payı açık olduğundan performans kullanıcı kabulü **BLOCKED** kalıyor.

WP3.5 regresyonunun aynı günkü performans ölçümlerinde bazı ağır DPR2 koşulları da 60 FPS altında kaldı: 1920×1080, zoom `%200`, normal sunum `38.0 FPS` (`26.33 ms` ortalama frame, `15` geç kare); 1366×768, zoom `%200`, normal sunum `44.3 FPS`; 1000 nesne, 1366×768, DPR2, zoom `%100` `39.3 FPS` (`25.46 ms` ortalama frame). Pointer-to-paint bu 1000 nesne koşulunda `1.055 ms` ölçüldü; renderer/frame yükü ayrıca kullanıcı akıcılığını etkiliyor. Bu koşullar da kullanıcı kabulinin BLOCKED kalmasını destekliyor.

### Click-to-add taraması

Gerçek Folio başlangıç slaydındaki Rust/WASM layout placeholder'ları Chromium 151'de pointer ile tarandı. Başlık ve alt başlık iç bölgelerinde 60 koordinatın tamamı doğru shape'i seçti ve metin textarea'sını odakladı; yazılan başlık/alt başlık Rust projection'a geçti. Ayrıca 1366×768 görünümde DPR 1/2/4 ve yakın zoom `%57`, `%97`, `%200` koşullarının 9/9'unda başlık placeholder'ına tıklama doğru shape'i seçip düzenlemeyi açtı. Console/page error yok. Placeholder dikdörtgeninin en dışındaki 3 px şerit nesneyi seçiyor, fakat düzenlemeyi açmıyor; metin alanının iç bölgesi tıklanabilir. Bu davranış bilerek düzenleme alanı dışında bırakılmadıysa ayrıca UX kararı gerektirir; mevcut tarama iç bölgedeki “Click to add” prompt sorununu yeniden üretmedi.
