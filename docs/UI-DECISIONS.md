# Folio UI kararları ve WP1 sonrası güncellemeler

Bu belge, WP1 planı hazırlandıktan sonra onaylanan ve Folio React kabuğuna uygulanan arayüz kararlarını kaydeder. Buradaki kararlar, `WP1.md` içindeki başlangıç mockup'ı ayrıntılarıyla çelişirse güncel kaynak kabul edilir. Görsel token'ların kaynağı `DESIGN.md` ve `apps/editor/src/styles/tokens.css` olmaya devam eder.

## Üst çubuk

- Üst solda tam logo yerine Folio uygulama simgesi kullanılır.
- `Dosya`, `Düzenle` ve `Görünüm` menüleri ikonlu, ortak `Button` bileşeninden üretilir.
- Geri al ve ileri al düğmeleri üst çubukta, sunum adından önce bulunur. Motor bağlantısı gelene kadar devre dışıdır.
- Sunum adı, dosya simgesi ve adın hemen sağındaki kalem düğmesiyle gösterilir. Ad değiştirme motor bağlantısı bekler.
- Yorumlar düğmesi avatar grubunun yanında bulunur. Paylaş ve Sunumu Yap düğmeleri motor/servis bağlantısı yokken devre dışıdır.
- Kaydetme durumu üst çubukta tekrarlanmaz; yalnızca alt durum çubuğunda `Kaydetme Kapalı` olarak görünür.

## Menü ve ortak kontroller

- Menü seçenekleri ortak Folio `Button` bileşenini kullanır; ikonlar metnin önünde yer alır.
- `Düzenle` menüsünde geri al/ileri al tekrarlanmaz; bu eylemler üst çubuktadır.
- `Görünüm` menüsünde cetveller, bir `ToggleSwitch` ile açılıp kapatılır. Açık/koyu arayüz seçimi de aynı switch ailesini kullanır.
- Toggle switch hover'da renk değiştirmez; konum geçişi animasyonludur. `prefers-reduced-motion` ayarı hareketi azaltır.
- Header ve rail düğmeleri ile film şeridinin kaydırma/araç düğmeleri ortak Folio Button bileşenini kullanır; engellenmiş motor eylemleri tıklanınca kullanılamama açıklaması verir. Slayt kartı, sekme ve composer gibi özel kontroller kendi erişilebilir etkileşimlerini korur.
- Yorumlar, Sunumu Yap ve Paylaş ikonları yalnızca hover/focus sırasında kısa ikon animasyonu oynatır; tıklama animasyonu kullanılmaz. Geri al/ileri al ikon hareketleri de hover/focus içindir ve düğmeler motor bağlantısı gelene kadar devre dışıdır.

## Navigasyon ve paneller

- Sekiz rail öğesi sırasını korur; dördüncü öğenin görünen adı `Medya` yerine `Kütüphane` olur.
- Kütüphane; Görseller, Videolar, Ses, Tablolar ve Belgeler için ortak arama/filtre düzenini kullanır. Dosya içeriği bağlı değilse boş durum gösterilir ve panelin altına sabit `Dosya ekle` düğmesi yer alır. Dosya seçme/ekleme host bağlantısı gelene kadar düğme devre dışıdır.
- Bileşen panelindeki arama ve kategori filtreleri araç düğmelerinin üstünde, aralarında tutarlı boşlukla yer alır.
- Arama alanı ile filtre düğmesi aynı satırda ve yakın aralıkta; kategori satırı aramadan sonra sabit bir üst boşlukla başlar. Kütüphane ve Tema panelleri ortak arama/filtre bileşenlerini paylaşır.
- Araçlar panelindeki Metin, Görsel, Video, Grafik, Tablo ve Not kısayolları ortak Button sistemini kullanır. Motor bağlantısı olmadan belgeye içerik eklemezler.
- Panel açılıp kapanırken canvas alanı ölçülü geçiş yapar. Küçük görünüm farkları dışında panel, rail ve çalışma alanı mevcut Folio görsel dilini korur.

## Koyu tema: rail durumu

- Rail hover ve aktif durumları açık tema renklerini kullanmaz.
- Koyu tema hover'ında koyu, hafif aydınlanmış yüzey ve açık metin kullanılır.
- Aktif rail öğesi aynı yuvarlatılmış kart siluetini korur; koyu sıcak/turuncu yüzey, ince sıcak çerçeve ve turuncu ikon/metin ile ayrışır.
- Aktif durumda solda ayrı bir şerit kullanılmaz. Aktif öğenin hover hali yüzeyi bir miktar daha aydınlatır.

## Çalışma alanı ve film şeridi

- Film şeridi yalnızca canvas sütununda kalır; görünürlüğü alt durum çubuğundaki `Slaytlar` düğmesinden değiştirilir ve açılıp kapanırken animasyon uygular.
- Film şeridi `SlideFilmstrip` adlı Folio React bileşenidir. ATLAS'ın DOM'a ve kendi belge modeline bağlı `filmstrip.ts` kodu Folio'ya taşınmaz.
- İçerik yatay taşınca ortak Button bileşeninden sol/sağ kaydırma okları gösterilir. Kart hover/focus büyümesi ve slayt arası araçların açılma geçişi korunur.
- Statik kartlar gösterim amaçlı üç örnek slayttır. Kartları sürükleyip bırakarak sıralama mevcut yerel örnek state'inde çalışır; bu sıra henüz Rust Session'a gönderilmez ve belgeye kaydedilmez.
- Slayt seçimi, gerçek thumbnail üretimi, slayt ekleme/silme/çoğaltma, aralık işlemleri ve kalıcı sıra WP3 motor bağlantısına aittir. Bağlantı kurulmadan bu eylemler etkin gösterilmez.
- Ekrana sığdır, cetvel ve zoom davranışları UI katmanındadır. Otomatik sığdırma çalışma alanı ölçüsünü izler; pencere boyutu ve tarayıcı tam ekran değişince yeniden hesaplanır.
- Taşan nesneleri düşük opaklıkla gösterme, henüz UI'da uygulanmış değildir; WP3'te gerçek render katmanına eklenecek bir gereksinimdir.

## Yorumlar ve örnek veriler

- Yorumlar, üst çubuk düğmesinden açılan sağ panelde gösterilir; panel başlığı, bağlam satırı, mesaj akışı ve composer panel/çerçeve dilini izler.
- `@` ile statik slayt etiketleri önerilir. Mesajdaki slayt etiketi seçildiğinde ilgili örnek slayt seçilir.
- Paneldeki mesajlar, avatarlar ve zamanlar örnek arayüz verisidir. Yerel composer davranışı gerçek ekip sohbeti, senkronizasyon veya kalıcı yorum kaydı değildir.
- Gerçek iş birliği ve yorum verisi bir servis/host bağlantısı kurulana kadar örnek olarak etiketlenmeli; gerçek kullanıcı durumu gibi sunulmamalıdır.
- Yorum paneli, sol Yapay Zekâ panelinden ayrı bir özelliktir. WP4'te AI chat arayüzü geliştirilirken sağ yorum paneli AI sohbetiyle birleştirilmemelidir.

## Gerçek işlev ile prototip sınırı

| UI davranışı | Bugünkü sınır |
|---|---|
| Menü, tema switch'i, cetvel, panel ve film şeridi görünürlüğü | React UI state'inde çalışır |
| Film şeridi drag-and-drop | Yalnızca statik örnek slaytların yerel sırası |
| Yorum composer ve `@Slayt` seçimi | Yalnızca örnek mesaj/slayt state'i |
| Undo/redo, ad değiştirme, kaydetme, slayt ekleme ve gerçek düzenleme | Motor veya servis bağlantısı bekler |
| Paylaşım, sunum oynatma, ekip senkronizasyonu | Host/servis bağlantısı bekler |
| Taşan nesne önizlemesi | WP3 render gereksinimi; henüz uygulanmadı |

UI-only örnek davranışlar Rust Session bağlandığında gerçek slayt view model'lerine ve typed EngineAdapter komutlarına taşınır. React kalıcı sunum belgesinin ikinci otoritesi olmayacaktır.
