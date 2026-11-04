# FOLIO — WP5: Electron, Dosya Yönetimi, Recovery ve Üretim Hazırlığı

## 1. Görev

WP1–WP4 aşamalarında geliştirilen Folio'yu web ve Electron masaüstü ortamlarında çalışabilen, dosya yönetimi ve veri güvenilirliği doğrulanmış bir ürün haline getir.

Bu pakette ürünün üretim hazırlık kriterlerini tamamla.

## 2. Mimari kurallar

- Eski `atlas/` değiştirilmeyecek.
- Eski `deckcraft/` değiştirilmeyecek.
- Bütün ürün geliştirmeleri `folio/` altında yapılacak.
- React arayüzü ortak kalacak.
- Rust/WASM EngineAdapter ortak kullanılacak.
- DeckCraft çekirdeği varsayılan olarak değiştirilmeyecek.
- Tek belge otoritesi Rust Session olacak.
- Mevcut Folio tasarımı korunacak.
- `frontend-design` skill'i ve tasarım sistemi korunacak.

## 3. Electron uygulaması

Önerilen konum:

`folio/apps/desktop/`

Electron renderer, mevcut Folio React uygulamasını kullanacak.

Yeni bir masaüstü arayüzü yazma.

### Electron güvenliği

- `contextIsolation: true`
- `nodeIntegration: false`
- Dar kapsamlı preload API
- Typed IPC
- Güvenli dosya yolları
- Content Security Policy
- Gereksiz Node API erişimi olmaması
- Harici içeriklerin ayrı güvenlik değerlendirmesi

### Host adapter

Web ve Electron dosya erişimi birbirinden ayrılacak.

```text
React Folio UI
      ↓
HostAdapter
   ├── WebHostAdapter
   └── ElectronHostAdapter
```

Electron host adapter:

- Open dialog
- Save
- Save As
- Dosya seçimi
- Pencere davranışları

Web host adapter:

- Tarayıcı dosya açma
- İndirme
- Uygun tarayıcı dosya API'leri
- Yerel veri saklama

## 4. Dosya formatları

Destek hedefleri:

### `.folio`

Folio'nun düzenlenebilir proje formatı.

ZIP tabanlı paketleme yaklaşımını kullan.

Önerilen içerik:

```text
presentation.folio
├── manifest.json
├── document/
│   └── presentation.json
├── media/
├── fonts/
└── metadata/
```

Bu yalnızca mantıksal yapı önerisidir.

Gerçek belge serileştirme formatını Rust Session'ın desteklediği güvenilir veri modeliyle uyumlu tasarla.

### `.folio` güvenilirlik kuralları

- Dosya sürümü
- Manifest şeması
- İçerik bütünlüğü
- Medya referansları
- ID tutarlılığı
- Hatalı ZIP yönetimi
- Boyut ve açma sınırları
- İleri/geri sürüm uyumluluğu
- Atomic save
- Hata durumunda veri kaybını önleme

Sadece JSON snapshot'ını ZIP'e koymayı otomatik olarak yeterli bir proje formatı kabul etme.

### PPTX

Gerçek Microsoft PowerPoint dosyalarıyla import/export doğrulaması yap.

- Metin
- Şekiller
- Fontlar
- Görseller
- Gruplar
- Tablolar
- Animasyonlar
- Medya
- Slayt sıralaması

Desteklenmeyen özelliklerde sessiz veri kaybı oluşturma.

### PDF

PDF dışa aktarma için motorun gerçek render çıktısı temel alınabilir.

Üretim kalitesi, font metrikleri ve sayfa boyutu doğrulanmadan destek tamamlandı kabul edilmesin.

### HTML

Daha önce belirlenen tek HTML dosyasıyla sunum paylaşımı hedefini koru.

- Kullanıcı yükleme yapmadan tarayıcıda açabilmeli.
- Sunum oynatma amaçlı olmalı.
- Düzenleme için Folio içine içe aktarım gerekebilir.
- Gömülü medya, boyut, tarayıcı uyumluluğu ve güvenlik sınırları değerlendirilmelidir.

HTML export'u yalnız plan düzeyindeyse tamamlandı gösterme.

## 5. Journal/recovery

WP2'den gelen batch journal/recovery açığını çöz.

Mevcut `edit.paste` yaklaşımı payload'ı journal'a kaydetmiyor.

Üretimde veri kaybını önlemek için replay edilebilir işlem kaydı veya güvenilir checkpoint sistemi geliştir.

Tercih edilebilecek yaklaşım:

- Folio operation log
- Payload-bearing batch operation
- Sürümlü komut kaydı
- Checkpoint
- Crash recovery
- Replay testi

DeckCraft core değişikliği gerçekten zorunluysa önce gerekçeli teknik karar kaydı oluştur. Kaynak `deckcraft/` dizinini değiştirme.

Dış işlem kayıtları ile engine journal tutarlılığını doğrula.

### Recovery testleri

- Normal kapanma
- Beklenmedik kapanma
- Batch eklemeden sonra kapanma
- Undo/redo sonrası kapanma
- Kaydetme sırasında hata
- Eksik/bozuk operation log
- Hatalı medya referansları

## 6. Üretim engelleri

PoC'de açık kalan teknik kapılar doğrulanmalı:

### Gerçek PPTX

Gerçek PowerPoint dosyalarıyla karşılaştırma matrisi oluştur.

### IME

Tarayıcı/OS seviyesinde gerçek metin düzenleme ve composition testlerini gerçekleştir.

### Fontlar

Üretim font manifesti, Türkçe karakterler, fallback davranışı ve metin metriklerini doğrula.

### Bellek

Şunları ayrı ölç:

- WASM linear memory capacity
- Live WASM heap
- Browser process memory
- Undo history retained estimate
- Render allocations

100/500/1.000 nesne ve uzun süreli kullanıcı oturumlarını test et.

Bu kapılar tamamlanmadıkça ürünün üretime hazır olduğunu iddia etme.

## 7. Performans

- WASM modül yükleme süresi
- İlk render
- Tekrar render
- Nesne ekleme
- Batch ekleme
- Pointer/drag gecikmesi
- Undo/redo
- PPTX import/export
- Bellek büyümesi
- Uzun oturum davranışı

Web ve Electron ortamlarında karşılaştır.

Ölçülmemiş performans garantileri verme.

## 8. Lisans ve dağıtım

Mevcut PoC lisans raporlarını incele.

Özellikle:

- DeckCraft MIT/Apache-2.0
- Symphonia MPL-2.0
- Font lisansları
- İkonlar
- Medya
- UI bileşenlerinin lisansları
- Üçüncü taraf bildirimleri

Dağıtılan gerçek paket için lisans envanteri oluştur.

MPL kapsamındaki kaynak kodu yükümlülüklerini ticari dağıtım bakımından doğrula.

## 9. Paketleme

### Web

- Production build
- WASM asset loading
- Cache strategy
- Content Security Policy
- Hata raporlama
- Kaynak haritaları
- Versiyonlama

### Electron

- Paketleme
- Güncelleme stratejisi
- Windows/Linux/macOS hedefleri için destek matrisi
- Gerekli imzalama/notarization adımları
- Dosya ilişkilendirme
- Yerel `.folio` dosyası açma
- Kurulum ve kaldırma

Desteklenmeyen işletim sistemlerini tamamlandı olarak raporlama.

## 10. Testler

- Web smoke test
- Electron smoke test
- Gerçek dosya aç/kaydet
- `.folio` round-trip
- PPTX import/export
- PDF/HTML desteklenen kapsam
- Recovery
- Font doğrulaması
- IME
- Bellek/performance
- Güvenlik kontrolleri
- UI regresyon
- Lisans bildirimi kontrolü

## 11. Kabul kriterleri

- [ ] Folio web sürümü çalışıyor.
- [ ] Electron sürümü çalışıyor.
- [ ] Ortak React arayüzü kullanılıyor.
- [ ] Ortak Rust/WASM motoru kullanılıyor.
- [ ] Gerçek dosya aç/kaydet çalışıyor.
- [ ] `.folio` dosyası kaydedilip yeniden açılabiliyor.
- [ ] Kaydetme sırasında güvenilirlik kontrolleri var.
- [ ] Journal/recovery veri kaybına karşı doğrulanmış.
- [ ] Gerçek PPTX uyumluluk matrisi hazırlanmış.
- [ ] OS IME doğrulanmış.
- [ ] Üretim fontları doğrulanmış.
- [ ] Gerçek bellek ölçümleri raporlanmış.
- [ ] Lisans yükümlülükleri karşılanmış.
- [ ] UI tasarımı korunmuş.
- [ ] Build/test sonuçları mevcut.
- [ ] Eski ATLAS ve DeckCraft değişmemiş.

Başarısız veya henüz uygulanmamış maddeleri açık bırak. Test sonucu olmadan tamamlandı işaretleme.

## 12. Rapor

WP5 sonunda:

1. Web/Electron build sonuçları.
2. Desteklenen platformlar.
3. Dosya formatı destek matrisi.
4. `.folio` format sözleşmesi.
5. Recovery testleri.
6. PPTX uyumluluk raporu.
7. Font/IME sonuçları.
8. Bellek/performans sonuçları.
9. Lisans envanteri.
10. Bilinen sınırlamalar.
11. Yayın için GO/NO-GO değerlendirmesi.

**Son talimat: WP5'i uygula. Folio'yu güvenilir dosya yönetimine sahip, web ve Electron üzerinde çalışan bir sunum editörü olarak tamamla. Üretim hazır olma kararını yalnız doğrulanmış kanıtlara göre ver.**