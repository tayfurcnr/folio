# Folio UI kararları ve WP1 sonrası güncellemeler

Bu belge, WP1 planı hazırlandıktan sonra onaylanan ve Folio React kabuğuna uygulanan arayüz kararlarını kaydeder. Buradaki kararlar, `WP1.md` içindeki başlangıç mockup'ı ayrıntılarıyla çelişirse güncel kaynak kabul edilir. Görsel token'ların kaynağı `DESIGN.md` ve `apps/editor/src/styles/tokens.css` olmaya devam eder.

## Üst çubuk

- Üst solda tam logo yerine Folio uygulama simgesi kullanılır.
- `Dosya`, `Düzenle` ve `Görünüm` menüleri ikonlu, ortak `Button` bileşeninden üretilir.
- Geri al ve ileri al düğmeleri üst çubukta, sunum adından önce bulunur ve gerçek Rust Session undo/redo geçmişini kullanır. `Düzenle` menüsünde yinelenmez.
- Sunum adı, dosya simgesi ve adın hemen sağındaki kalem düğmesiyle gösterilir. Ad değiştirme motor bağlantısı bekler.
- Yorumlar düğmesi avatar grubunun yanında bulunur. Sunumu Yap, gerçek Rust slaytlarını sunum görünümünde oynatır; Paylaş düğmesi iş birliği servisi beklediği için devre dışıdır.
- Kaydetme durumu üst çubukta tekrarlanmaz; yalnızca alt durum çubuğunda `Kaydetme Kapalı` olarak görünür.
- Dosya menüsündeki Aç, Kaydet ve Farklı Kaydet işlemleri tarayıcı dosya seçicisi/indirmesiyle DeckCraft PPTX içe/dışa aktarımını kullanır. Bu akış gerçek PowerPoint uyumluluğunun doğrulandığı anlamına gelmez.

## Menü ve ortak kontroller

- Menü seçenekleri ortak Folio `Button` bileşenini kullanır; ikonlar metnin önünde yer alır.
- `Düzenle` menüsünde geri al/ileri al tekrarlanmaz; bu eylemler üst çubuktadır.
- `Görünüm` menüsünde cetveller, bir `ToggleSwitch` ile açılıp kapatılır. Açık/koyu arayüz seçimi de aynı switch ailesini kullanır.
- Toggle switch hover'da renk değiştirmez; konum geçişi animasyonludur. `prefers-reduced-motion` ayarı hareketi azaltır.
- Header ve rail düğmeleri ile film şeridinin kaydırma/araç düğmeleri ortak Folio Button bileşenini kullanır; engellenmiş motor eylemleri tıklanınca kullanılamama açıklaması verir. Slayt kartı, sekme ve composer gibi özel kontroller kendi erişilebilir etkileşimlerini korur.
- Film şeridindeki çoğalt/sil düğmeleri hover ölçek animasyonunda kartla birlikte hareket eder; kart eylemleri sabit bir üst-sağ hizasında kalır.
- Yorumlar, Sunumu Yap ve Paylaş ikonları yalnızca hover/focus sırasında kısa ikon animasyonu oynatır; tıklama animasyonu kullanılmaz. Geri al/ileri al ikon hareketleri de hover/focus içindir.

## Navigasyon ve paneller

- Sekiz rail öğesi sırasını korur; dördüncü öğenin görünen adı `Kütüphane` olur.
- Kütüphane; Görseller, Videolar, Ses, Tablolar ve Belgeler için ortak arama/filtre düzenini kullanır. `Dosya ekle` seçilen dosyaları oturum belleğindeki kütüphaneye ekler. Görsel, ses ve video gerçek Rust Session'a yerleştirilebilir; diğer dosya türleri yalnızca kütüphane listesinde görünür.
- Bileşen panelindeki arama ve kategori filtreleri araç düğmelerinin üstünde, aralarında tutarlı boşlukla yer alır.
- Arama alanı ile filtre düğmesi aynı satırda ve yakın aralıkta; kategori satırı aramadan sonra sabit bir üst boşlukla başlar. Kütüphane ve Tema panelleri ortak arama/filtre bileşenlerini paylaşır.
- Araçlar panelindeki desteklenen Metin, Görsel, Video, Grafik, Tablo, çizgi ve diyagram eylemleri ortak Button sistemini kullanır ve Rust Session'a içerik ekler. Motor komutu olmayan çizim/denklem eylemleri kullanılabilir gibi gösterilmez.
- Panel açılıp kapanırken canvas alanı ölçülü geçiş yapar. Küçük görünüm farkları dışında panel, rail ve çalışma alanı mevcut Folio görsel dilini korur.

## Koyu tema: rail durumu

- Rail hover ve aktif durumları açık tema renklerini kullanmaz.
- Koyu tema hover'ında koyu, hafif aydınlanmış yüzey ve açık metin kullanılır.
- Aktif rail öğesi aynı yuvarlatılmış kart siluetini korur; koyu sıcak/turuncu yüzey, ince sıcak çerçeve ve turuncu ikon/metin ile ayrışır.
- Aktif durumda solda ayrı bir şerit kullanılmaz. Aktif öğenin hover hali yüzeyi bir miktar daha aydınlatır.

## Çalışma alanı ve film şeridi

- Film şeridi yalnızca canvas sütununda kalır; görünürlüğü alt durum çubuğundaki `Slaytlar` düğmesinden değiştirilir ve açılıp kapanırken animasyon uygular.
- Film şeridi `SlideFilmstrip` adlı Folio React bileşenidir. ATLAS'ın DOM'a ve kendi belge modeline bağlı `filmstrip.ts` kodu Folio'ya taşınmaz.
- İçerik yatay taşınca ortak Button bileşeninden sol/sağ kaydırma okları gösterilir. Kart hover/focus büyümesi ve slayt arası araçların açılma geçişi korunur. Çoğalt/sil düğmeleri `.slide-card-frame` içinde sabit üst-sağ konumda durur; hover sırasında yer değiştirmeden yalnızca opaklıkla görünür.
- Kartlar, thumbnail'lar, aktif slayt ve sıralama Rust Session projeksiyonlarından gelir. Kartları sürükleyip bırakarak sıralama Session'daki gerçek slayt sırasını değiştirir; aralık ve film şeridi ekleme kontrolleri gerçek slayt oluşturur.
- Slayt seçimi, ekleme/silme/çoğaltma/sıralama, geçiş ve bölüm işlemleri gerçek EngineAdapter komutlarına bağlıdır.
- Ekrana sığdır, cetvel ve zoom davranışları UI katmanındadır. Otomatik sığdırma çalışma alanı ölçüsünü izler; pencere boyutu ve tarayıcı tam ekran değişince yeniden hesaplanır.
- Taşan nesneler, aynı Rust renderer'ın büyütülmüş şeffaf frame'iyle çizilir. Slaytın kendi 960×540 çizimi normal opaklıkta kalır; çevre frame'de yalnızca slayt dışı kısım düşük opaklıkla gösterilir.

## WP3.5 canvas, ızgara ve medya kararları

- El aracı seçiliyken alt çubuktaki düğme turuncu aktif görünür; çalışma alanı cursor'ı `grab`, sürükleme sırasında `grabbing` olur. Pan, mevcut React `panOffset` davranışıyla kalır.
- Selection frame, handle ve rotate kontrolü yalnızca gerçek Rust Session selection projection'ından çizilir. Seçili metin alanı görünürken seçim kontrolleri metin giriş alanının üzerinde kalır; metin kutusunun kenarından başlayan pointer drag Rust Session'a taşınır. Metin alanının içi caret ve klavye girişi için kullanılabilir kalır.
- Seçim frame'inde 8 resize handle ve üst orta rotate handle bulunur. Resize ve rotate gerçek Rust pointer etkileşimleridir; geçici görsel transform belge geometrisi yerine kullanılmaz. Her hareket tek Undo etkileşimi olarak kalır.
- Görünüm menüsünde `Izgara` yalnızca geçici 20 birimlik canvas overlay'i gösterir. `Izgaraya yasla`, move ve resize pointer koordinatlarını Session'a göndermeden önce düzenler; overlay sunum çıktısına girmez. DeckCraft'ın smart-guide hizası son geometriyi küçük miktarda değiştirebilir.
- Taşma frame marjı çalışma alanının görünür ölçüsünden hesaplanır; Rust/WASM tarafında en fazla 4096×4096 piksel frame sınırı vardır. Slayt içi frame ve dışarı taşan şeffaf frame aynı pan/zoom dönüşümünü kullanır.
- Fit bildirimi kısa süreli toast'tır; yaklaşık 2.8 saniyede kapanır, tekrar gösterimde önceki timer temizlenir ve reduced-motion ayarı geçişi azaltır.
- Kütüphane dosyaları `folio-media-library` IndexedDB deposunda content SHA-256 anahtarıyla tutulur ve aynı içerik tekrar eklendiğinde yinelenmez. Bu kapsam mevcut tarayıcı profiline aittir; kullanıcı/proje hesabı arasında senkronize değildir. Dosya slayda yerleştirildiğinde byte içeriği Rust Session belgesine gömülür; Kütüphane öğesinin silinmesi slayttaki kopyayı silmez.
- Render sırasında WASM frame baytları doğrudan `ImageData`'ya görünüm olarak verilir; drag sırasında Rust Session tek belge otoritesi ve tek undo geçmişi olarak kalır.

## Yorumlar ve örnek veriler

- Yorumlar, üst çubuktan açılan sağ panelde yer alır; kullanıcı yorumu, yanıtı ve çözüm durumu belge kimliğiyle IndexedDB'de kalıcıdır.
- `@Slayt` etiketleri belge slaytlarına bağlanır; nesneye bağlı yorum ilgili nesneyi yeniden seçebilir.
- Yorumlar bu tarayıcı/cihaz kapsamındadır. Çok kullanıcılı canlı eşitleme, davet ve erişim izinleri için host servisi gerekir; yerel kayıt ekip sohbeti olarak sunulmaz.
- Yorum paneli, sol Yapay Zekâ panelinden ayrı bir özelliktir. WP4'te AI chat arayüzü geliştirilirken sağ yorum paneli AI sohbetiyle birleştirilmemelidir.

## WP3.8 etkileşim ve yerelleştirme kararları

- Seçili nesne, boş canvas ve slayt kartı sağ tık menüleri Folio React katmanında açılır; eski ATLAS belge/DOM uygulaması taşınmaz. Menü eylemleri `EngineAdapter` üzerinden gerçek Rust Session komutlarını çağırır.
- Sağ tık, hedef nesne zaten seçiliyse çoklu seçimi korur. Boş canvas sağ tıkı mevcut seçimi temizlemeden canvas menüsünü açar.
- Menü viewport kenarlarında konumunu sınırlar; Escape, dışarı tıklama ve ok/Home/End klavye hareketlerini destekler. Menü eylemleri ortak Folio `Button` bileşeninden üretilir.
- Nesne menüsündeki çoğalt ve sil, DeckCraft komut adları `edit.duplicate` ve `edit.delete` kullanır. Kopyala/yapıştır Rust Session clipboard'ını kullanır; işletim sistemi clipboard entegrasyonu ayrıca doğrulanmalıdır.
- Arayüz dili `Görünüm` menüsündeki TR/EN seçicisinden değişir. Seçim `localStorage` içinde tutulur; kayıt yoksa tarayıcı diline göre başlangıç yapılır. `html lang`, React arayüzü ve varsayılan Rust placeholder render projection'ı birlikte güncellenir. Dil değişikliği kullanıcı sunum verisini çevirmemeli veya değiştirmemelidir.
- Yorumlardaki yerleşik örnek mesajlar arayüz metni olarak çevrilir; kullanıcı tarafından yazılan mesajlar ve sunum içeriği aynen korunur. Dil kapsamı şu an Türkçe ve İngilizcedir.
- Move, resize ve rotate cursor'ları ayrı anlam taşır. Rotate kontrolünde düşük detaylı, net yön bildiren cursor kullanılır; cursor yönü gereksiz döndürülmez ve resize handle alanından ayrılır.
- Canvas ve transform bitmap çözünürlüğü görünüm zoom'u ile DPR çarpımına göre, 1×–4× arasında seçilir. Zoom küçülünce kullanılmayan yüksek çözünürlüklü piksel üretimi azaltılır; Rust Session renderer ve final kalite korunur.

## Gerçek işlev ile prototip sınırı

| UI davranışı | Bugünkü sınır |
|---|---|
| Menü, tema switch'i, cetvel, panel ve film şeridi görünürlüğü | React UI state'inde çalışır |
| Film şeridi drag-and-drop, geçiş ve bölüm işlemleri | Gerçek Rust Session sırasını ve slayt ayarlarını değiştirir |
| Yorumlar, yanıtlar ve `@Slayt` seçimi | Belge kimliğiyle IndexedDB'ye kaydedilir; bu cihazdaki kullanıcı yorum ekleyip yanıtlayabilir, çözebilir ve ilgili slayt/nesneye gidebilir. Sunucuya veya diğer kullanıcılara eşitlenmez. |
| Undo/redo, slayt ekleme/sıralama ve temel şekil/metin düzenleme | Gerçek Rust Session ve EngineAdapter üzerinden çalışır |
| Sunum adını değiştirme | DeckCraft belge özelliklerini değiştiren Rust/WASM komutuyla çalışır; Undo/Redo ve yerel autosave desteklenir. |
| Açma ve kaydetme | DeckCraft motoru PPTX içe/dışa aktarımı tarayıcı dosya seçici/indirmesiyle çalışır; gerçek PowerPoint uyumluluğu kanıtlanmış değildir |
| Dosya paylaşımı | Tarayıcı Web Share API kullanılabiliyorsa PPTX dosyasını paylaşır; ortak düzenleme bağlantısı oluşturmaz |
| Ekip erişimi ve canlı eşitleme | Host/servis bağlantısı bekler; yorumlar ve belge şu an yerel cihazda kalır |
| Sunum oynatma | Mevcut Rust Session slaytlarını sunum görünümünde oynatır; ayrı sunucu penceresi notları gösterir ve slaytları uzaktan kontrol eder |
| Taşan nesne önizlemesi | Rust renderer'ın büyütülmüş şeffaf frame'i ile uygulanır; sınır dışında düşük opaklıkta gösterilir |

Yapay zekâ prompt önerileri servis entegrasyonu gelene kadar devre dışıdır. Slaytlar, nesneler, seçim ve undo/redo Rust Session'dan projekte edilir; React kalıcı sunum belgesinin ikinci otoritesi değildir.
