# Canva parity: kalan işler

Bu liste mevcut kaynak ve regresyon kanıtına göre hazırlanmıştır. Folio, Canva ile birebir özellik eşitliğinde değildir. Yeni işler bu başlıklara göre uygulanıp aynı davranış, render, kalıcılık ve geri alma ölçütleriyle doğrulanmalıdır.

## P1 — Kullanıcıya görünen eksikler

- **Metin efektleri:** Canva'daki Echo, Background, Splice, Hollow, Glitch ve Neon efektlerini; hazır efekt stillerini ve efekt başına gerekli kontrolleri ekle. Mevcut Shadow ve Glow temel parametreleri, metin aralığı seçimi, Undo/Redo, biçim boyacısı ve PPTX turu WP3.8 headless regresyonunda doğrulandı. Tablo hücrelerinde efekt uygulamasına ayrıca tarayıcı regresyonu ekle.
- **Yapay zekâ araçları:** Assistant paneli hâlâ bağlantı yapılandırılmadığını bildiriyor; öneriler, dosya ekleme ve gönderme kontrolleri devre dışı. Bir model sağlayıcısı, güvenli sunucu proxy'si ve sunum bağlamı için kullanıcı akışları belirlenip panel uçtan uca çalıştırılmalı.
- **Tam özellik matrisi:** Canva’daki slayt, metin, şekil, fotoğraf/video, ses, tablo, grafik, animasyon, sunum, paylaşım ve dışa aktarma akışlarını karşılaştıran madde madde matris oluştur. Mevcut WP3.8 testi geniştir, ancak uygulamanın tüm Canva iş akışlarının birebir olduğunu kanıtlamaz. Her matris satırına gerçek tarayıcı etkileşimi, render ve Undo/Redo kanıtı ekle.
- **İçerik ve marka kaynakları:** Folio kütüphanesi tarayıcı profiline yerel dosya koleksiyonudur. Canva'nın hazır stok içerikleri, kullanıcı hesabına bağlı varlık kütüphanesi ve marka kitleri eşdeğeri yoktur.

## P1 — Ortak çalışma ve hesap

- **Hesap sahipliği:** Mevcut işbirliği servisi kalıcı belge, rol bazlı bearer davet bağlantıları ve iptal sağlar; kullanıcı hesabı ve hesapla belge kurtarma yoktur. Canva benzeri hesap/kimlik, belge sahipliği ve erişim kurtarma ekle.
- **Çevrimdışı düzenleme:** Bağlantı kesilince düzenleme kuyruğu, tekrar bağlanınca güvenli replay ve servis/revizyon hatalarının kullanıcıya gösterilmesini doğrula.
- **Eşzamanlı düzenleme:** Servis işlemleri sıralar ve eski revizyonu reddeder; bu tüm eşzamanlı metin düzenlemelerinde otomatik birleştirme sağlamaz. Aynı metin aralığında, şekil transformunda, silme/Undo ve medya değişiminde iki kullanıcı senaryoları tanımla; yakınsama veya kurtarılabilir çatışma göster.
- **Üretim işletimi:** Dağıtımda yedekleme/geri yükleme tatbikatı, veri saklama ve silme politikası, servis health/monitoring, rate limiting ve yük altında WebSocket davranışını doğrula.

## P2 — Cihaz ve ortam doğrulaması

- **DPR 4 ve yüksek zoom performansı:** Pointer-up raster gecikmesi ve taşma bitmap belleği gerçek üretim cihazında ölçülmeli; mevcut hızlı Chromium ölçümü kullanıcı algısı veya uzun oturum kanıtı değildir.
- **IME ve giriş aygıtları:** Türkçe fiziksel klavye/IME composition, dokunmatik kalem ve gerçek fare etkileşimlerini işletim sistemi üzerinde doğrula.
- **Medya codec matrisi:** VP9/WebM video yolu doğrulandı; H.264, HEVC, AV1 ve desteklenen tarayıcı/işletim sistemi kombinasyonlarını ayrı ayrı test et.
- **Görsel karşılaştırma:** Canva'daki aynı belge ve viewport ile font ölçümü, metin satır kırımı, seçim affordance'ları ve dışa aktarılan PPTX/PDF için düzenli görsel parity karşılaştırması yap.

## Tamamlanma ölçütü

Bu liste tamamlandı demek, her özellik grubunun güncel Canva davranışıyla karşılaştırılması, eksiklerin uygulanması ve gerçek tarayıcıda render, giriş, Undo/Redo, kalıcılık, paylaşım ve dışa aktarma kanıtının bulunması anlamına gelir. Tek bir regresyon paketinin geçmesi tüm parity hedefini tek başına karşılamaz.
