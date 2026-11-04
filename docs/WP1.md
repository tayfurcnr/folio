# FOLIO — WP1: React Arayüz Kabuğu ve Frontend Design Entegrasyonu

## 1. Görevin amacı

Yeni **Folio** sunum editörünün React + TypeScript tabanlı arayüz kabuğunu oluştur.

Folio sıfırdan tasarlanan yeni bir ürün değildir. Mevcut ATLAS/Folio arayüzünün devamıdır.

> **Uygulama güncellemesi:** WP1 sonrasında onaylanan ve mevcut kabuğa uygulanan UI kararları [`UI-DECISIONS.md`](./UI-DECISIONS.md) içinde kayıtlıdır. Bu ek, aşağıdaki başlangıç mockup ayrıntılarından farklı olduğunda güncel kabul edilir.

Eski ATLAS projesini tamamen koruyarak mevcut arayüzü yeni `ATLAS/folio/` klasörüne taşıyacağız.

Yeni Folio'nun sunum motoru ilerleyen aşamalarda DeckCraft Rust/WASM olacak. Ancak **bu görev yalnızca WP1 kapsamındadır. Rust/WASM entegrasyonuna henüz başlanmayacak.**

### Temel kurallar

1. Eski ATLAS'ın görsel tasarımını koru.
2. Mevcut UI bileşenlerini mümkün olduğunca yeniden kullan.
3. Eski hibrit HTML/TypeScript/React portal mimarisini taşıma.
4. Yeni Folio tamamen React + TypeScript + Vite olsun.
5. Yeni kod yalnızca `ATLAS/folio/` altında oluşturulsun.
6. `frontend-design` skill'ini yeni projeye kur, incele ve UI geliştirmelerinde aktif kullan.
7. Eski ATLAS ve DeckCraft kaynaklarını değiştirme.
8. Çalışan motoru olmayan özellikler için sahte fonksiyonlar üretme.

**En önemli hedef: Yeni Folio, mevcut ATLAS arayüzünün modernize edilmiş devamı gibi görünmeli. Tamamen farklı bir ürün tasarımı oluşturulmamalı.**

---

## 2. Kaynak dizinlerin korunması

Mevcut çalışma alanını incele.

Beklenen dizinler:

```text
ATLAS/
├── atlas/          # Eski ATLAS — KORUNACAK
├── deckcraft/      # DeckCraft ve Rust/WASM PoC — KORUNACAK
└── folio/          # Yeni Folio — OLUŞTURULACAK
```

### Kesin güvenlik kuralları

- `atlas/` ve `deckcraft/` dizinlerini yalnızca oku.
- Bu dizinlerde hiçbir dosyayı değiştirme veya silme.
- Git working tree durumunu işe başlamadan önce kaydet.
- Mevcut değiştirilmiş, silinmiş veya izlenmeyen dosyaları koru.
- `git reset`, `git clean`, `git stash`, zorlayıcı checkout veya benzeri işlemler yapma.
- Eski projelerde branch değiştirme.
- Eski projelere commit, push veya merge yapma.
- Dosyaları kesip taşıma; yalnızca yeni projeye kopyala.
- Yeni `folio/` klasörü mevcutsa içeriğini incele ve hiçbir dosyanın üzerine kontrolsüz yazma.
- Bütün yeni yazma işlemleri `folio/` dizini altında gerçekleşsin.

Eski proje, çalışır durumda referans olarak kalmalı.

---

## 3. Frontend Design skill kurulumu ve kullanımı

Bu görevde `frontend-design` skill'ini kullanmak zorunludur.

### 3.1. Skill'i bul ve yeni projeye kur

Önce geliştirme ortamında mevcut `frontend-design` skill'ini ara.

Aşağıdaki gibi mevcut skill dizinleri, araç kayıtları veya kurulu agent skill'leri incelenebilir:

- `.agents/skills/frontend-design/`
- `.claude/skills/frontend-design/`
- Kullanıcı düzeyinde kurulu skill dizinleri
- Geliştirme ortamının kendi skill kayıtları

**Önemli:**

- Gerçek skill'in kaynağını ve kurulum şeklini doğrula.
- Skill bulunmuyorsa güvenilir ve yetkili kaynağını araştır.
- Resmî veya güvenilir kaynaktan mevcut sürümünü edin.
- Bilinmeyen depolardan rastgele kod indirme veya çalıştırma.
- Kaynağı doğrulanamayan bir skill'i kurulmuş gibi raporlama.
- Skill için gereken lisans ve atıf koşullarını koru.

Tercih edilen yeni proje konumu:

```text
folio/
└── .agents/
    └── skills/
        └── frontend-design/
            └── SKILL.md
```

Skill ilave script, referans veya varlık dosyaları içeriyorsa gerekli klasör yapısını koruyarak tamamını taşı.

Agent altyapısı `.claude/skills/` dizinini gerektiriyorsa bunu desteklenen biçimde yapılandır. Gereksiz iki ayrı kopya oluşturma.

### 3.2. Skill talimatlarını oku

Skill'in `SKILL.md` dosyasını oku ve varsa referanslarını incele.

UI geliştirmesi sırasında skill'in tasarım ilkelerini ve kalite kontrol önerilerini uygula.

Ancak **skill'in genel stil tercihleri mevcut Folio tasarım kararlarını geçersiz kılamaz.**

Öncelik sırası:

1. Mevcut ATLAS/Folio tasarımı
2. `DESIGN.md`
3. `tokens.css`
4. Onaylanmış Folio arayüz planı
5. `frontend-design` skill rehberi

Skill'i özellikle şu işler için kullan:

- Görsel tutarlılık
- Bileşen hiyerarşisi
- Tipografi ve boşluklar
- Panel yerleşimi
- Menü tasarımı
- Hover, active ve focus durumları
- Responsive davranış
- Erişilebilirlik
- İnce görsel kalite iyileştirmeleri

Skill mevcut tasarımın yeniden yorumlanması için değil, **mevcut tasarımı koruyarak daha kaliteli uygulanması için** kullanılacak.

### 3.3. Skill kullanımını doğrula

WP1 raporunda:

- Skill'in bulunduğu veya edinildiği kaynak
- Kurulum dizini
- Okunan talimat dosyaları
- Uygulanan tasarım ilkeleri
- Skill'in hangi bileşenlerde kullanıldığı

açıkça belirtilsin.

---

## 4. Yeni Folio klasör yapısı

Yeni proje için önerilen yapı:

```text
folio/
├── .agents/
│   └── skills/
│       └── frontend-design/
│           └── SKILL.md
│
├── apps/
│   └── editor/
│       ├── public/
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── app/
│           ├── ui/
│           │   ├── header/
│           │   ├── navigation/
│           │   ├── panels/
│           │   ├── workspace/
│           │   ├── components/
│           │   └── dialogs/
│           ├── features/
│           ├── styles/
│           └── assets/
│
├── packages/
│   └── ui/
│
├── docs/
│   ├── DESIGN.md
│   ├── ARCHITECTURE.md
│   └── MIGRATION.md
│
├── package.json
└── package-lock.json
```

Bu yapı başlangıç önerisidir. Gereksiz veya kullanılmayan klasörleri sırf şemada bulunduğu için oluşturma.

WP1 kapsamında Rust crate, engine adapter veya Electron uygulamasını oluşturmak zorunlu değildir. Bunlar sonraki aşamalara aittir.

---

## 5. Mevcut ATLAS tasarımını taşı

Aşağıdaki kaynakları incele:

- `atlas/DESIGN.md`
- `atlas/apps/editor/src/ui/tokens.css`
- `atlas/apps/editor/src/ui/EditorShell.tsx`
- `atlas/apps/editor/src/ui/mount.tsx`
- `atlas/apps/editor/src/ui/components/`
- Mevcut header, navigation, panel ve workspace CSS dosyaları
- `atlas/docs/img/folio-logo.svg`
- Mevcut ikon ve tipografi sistemleri

### Taşıma yaklaşımı

Bileşenleri önce sınıflandır:

**A. Doğrudan taşınabilir**

Yalnızca görsel sunum yapan, eski motora bağımlı olmayan bileşenler.

**B. Uyarlanarak taşınabilir**

Görsel tasarımı korunacak, ancak olay yönetimi veya veri kaynağı React state'e uyarlanacak bileşenler.

**C. WP1'e taşınmayacak**

Eski belge motoru, render motoru, undo/redo ve persistence bağımlılıkları.

### Kesin olarak taşınmayacak mimari parçalar

- Eski editör `main.ts`
- `DocumentStore`
- TypeScript belge otoritesi
- Eski TypeScript render motoru
- DOM `CustomEvent` komut köprüsü
- React portal düzeni
- Eski TypeScript undo/redo geçmişi

Eski `index.html` içindeki statik editör DOM'unu yeni uygulamaya kopyalama.

Yeni `index.html` yalnızca React root ve gerekli HTML metadata'sını içersin.

Yeni arayüz tamamen `App.tsx` ve React bileşenleri üzerinden oluşturulsun.

---

## 6. Tasarım sistemi

Mevcut Folio tasarımını temel al.

### Görsel dil

- Açık tema
- Beyaz panel yüzeyleri
- Açık gri çalışma alanı
- Pastel turuncu vurgu
- Koyu metinler
- Yumuşatılmış köşeler
- İnce kenarlıklar
- Hafif gölgeler
- Dengeli boşluklar
- Modern ve kurumsal tipografi

Renkler, spacing, border-radius ve tipografi için mevcut `tokens.css` esas alınacak.

Mevcut semantik token'lar kullanılabiliyorsa yeni hardcoded renkler oluşturma.

Yeni tasarım sistemi icat etme.

Mevcut Folio logosunu kullan.

Gereksiz gradient, aşırı gölge, büyük dekoratif ikonlar ve ürüne uymayan görsel efektler ekleme.

---

## 7. Üst menü

Mevcut Folio header tasarımını koruyarak şu düzeni uygula.

### Sol bölüm

- Folio uygulama simgesi
- Dosya
- Düzenle
- Görünüm
- Geri al / ileri al
- Bölücü ve sunum adı; kalem düğmesi adın hemen sağında

### Orta bölüm

- Bu sürümde ayrı orta header alanı yoktur; başlık sol menü ve geçmiş kontrollerinden sonra hizalanır.

### Sağ bölüm

- Düzenleyicilerin avatarları
- Yorumlar
- Paylaş
- Sunumu Yap

Kaydetme durumu üst çubukta tekrarlanmaz; yalnızca alt durum çubuğunda `Kaydetme Kapalı` gösterilir. Avatarlar ve yorum içeriği şu an örnek veridir, gerçek ekip bağlantısı değildir.

Bu alanlar React bileşenleri olarak ayrılmalı.

Önerilen isimler:

- `EditorHeader`
- `Brand`
- `FileMenu`
- `EditMenu`
- `ViewMenu`
- `PresentationTitle`
- `SaveStatus`
- `CollaboratorAvatars`
- `CommentsButton`
- `ShareButton`
- `PresentButton`

### Davranış kuralları

- Arayüz menüleri açılıp kapanabilir.
- Mevcut çalışan bir işlev varsa korunabilir; ancak eski motor taşınmayacak.
- Motor gerektiren komutlar henüz bağlı değilse devre dışı tutulacak.
- Gerçek kaydetme yapılmadan `Kaydedildi` gibi yanıltıcı durumlar gösterilmeyecek.
- Gerçek iş birliği bağlantısı yoksa sahte aktif kullanıcı verisi oluşturulmayacak.
- Paylaş ve Sunumu Yap işlevleri yoksa çalışıyormuş gibi davranmayacak.

---

## 8. Sol navigasyon — 8 ana menü

Sol navigation rail kesin olarak şu sırada olacak:

1. **Şablonlar** — `layout-template`
2. **Tema** — `palette`
3. **Bileşenler** — `shapes`
4. **Kütüphane** — `images` (Görseller, Videolar, Ses, Tablolar ve Belgeler)
5. **Araçlar** — `pencil-ruler`
6. **Katmanlar** — `layers`
7. **Eylemler** — `zap`
8. **Yapay Zeka** — `sparkles`

Yardım butonu bu sekiz öğenin dışında, rail'in alt kısmında sabit olacak.

### Görünüm

- Her menüde ikon ve kısa etiket bulunsun.
- Aktif öğe turuncu vurguyla gösterilsin.
- Hover etkisi hafif olsun.
- Rail dar ve düzenli kalsın.
- İkon ve metin hizalaması tutarlı olsun.

### Davranış

- Bir öğeye tıklandığında ilgili sol içerik paneli açılsın.
- Aynı aktif öğeye tekrar tıklandığında panel kapansın.
- Panel kapatıldığında canvas çalışma alanı genişlesin.
- Yeni öğe seçildiğinde ilgili panel içeriği gösterilsin.
- Navigasyon durumu React state üzerinden yönetilsin.

`WorkspaceSection` gibi tip güvenli bir ortak bölüm tanımı kullanılabilir.

Eski `fonts` rail sekmesini taşıma. Font kontrolleri ileride ilgili metin düzenleme alanlarına bağlanacak.

Seçime bağlı eski otomatik `format` paneli açma davranışını taşıma.

---

## 9. Sol içerik panelleri

Sekiz ana panel için mevcut Folio tasarım dilini kullan.

### Şablonlar

- Şablon arama
- Kategori alanı
- Şablon kartları
- Önizleme yerleşimi

### Tema

- Tema sekmeleri
- Renk paletleri
- Tipografi alanları
- Tema kartları

### Bileşenler

- Metin
- Şekiller
- Tablolar
- Grafikler
- İkonlar
- Diyagramlar
- Hazır içerik blokları

### Kütüphane (başlangıç planındaki Medya paneli)

Kullanıcıya görünen panel adı **Kütüphane** olur. Arama ve filtre alanları ortak panel arama bileşenleriyle gösterilir. Kategoriler Görseller, Videolar, Ses, Tablolar ve Belgeler'dir. Dosya kaynağı bağlı değilse boş durum gösterilir; sahte varlık listesi gösterilmez.

### Araçlar

- Kalem
- İşaretleyici
- Fosforlu kalem
- Silgi
- Renkler
- Kalınlık
- Şeffaflık

### Katmanlar

- Katman listesi yerleşimi
- Arama
- Görünürlük
- Kilit
- Gruplama alanları

### Eylemler

- Animasyonlar
- Geçişler
- Etkileşim

### Yapay Zeka

Yapay zeka paneli için ilerleyen WP4 aşamasında şu referans kullanılacak:

https://ui.shadcn.com/docs/ai-elements/aria/chat

WP1 sırasında mevcut AI panelinin görsel alanını koru.

Gerçek AI Chat bileşen entegrasyonu WP4 kapsamındadır. WP1'de tam sohbet altyapısı geliştirme.

### Panel kuralları

- Ortak panel başlıkları ve boşlukları kullan.
- Paneller kendi içinde scroll edilebilsin.
- Panel açılıp kapanması animasyonluysa ölçülü ve hızlı olsun.
- UI-only arama, sekme ve accordion gibi davranışlar çalışabilir.
- Belgeyi değiştiren fonksiyonları motor olmadan taklit etme.
- Boş içerikleri yanıltıcı gerçek veri gibi gösterme.

---

## 10. Canvas çalışma alanı

Canvas mevcut Folio görünümünü koruyacak.

### Yerleşim

- Çalışma alanı merkezde olacak.
- Açık gri workspace arka planı kullanılacak.
- Slayt alanı varsayılan olarak 16:9 oranında olacak.
- Slayt görünümü mevcut tasarıma uygun olacak.
- Cetvellerin görsel yerleşimi korunacak.
- Sağda kalıcı özellik paneli bulunmayacak.

### WP1 sınırı

Bu aşamada gerçek Rust render veya nesne düzenleme motoru bağlanmayacak.

Bunun yerine UI kabuğunun yerleşimini doğrulamaya uygun, açıkça gösterim amaçlı statik bir canvas görünümü kullanılabilir.

Bu statik görünüm gerçek belge modeli gibi davranmayacak.

Sahte selection, drag, resize, undo veya belge değişiklikleri oluşturma.

### Canvas kontrolleri

Canvas'ın sağ alt kısmında şu kontrollerin mevcut yerleşimini koru:

- El aracı
- Yakınlaştırma oranı
- Ekrana sığdır

Ekrana sığdır, kullanılabilir çalışma alanının ölçüsünü izler; pencere boyutu ve tarayıcı tam ekran değişince otomatik zoom yeniden hesaplanır. Gerçek içerik çizimi ve motor entegrasyonu gerektiren davranışları WP3'e bırak.

---

## 11. Floating selection toolbar hazırlığı

Gerçek floating toolbar geliştirmesi WP4 kapsamındadır.

Referans:

https://uiarc.dev/components/blocks/selection-toolbar

WP1 sırasında canvas katman mimarisini ileride toolbar eklenebilecek şekilde oluştur.

İleride seçim bilgisi Rust engine adapter üzerinden gelecek.

Toolbar:

- Seçili nesnenin hemen üzerinde görünecek.
- Nesneye bağlı konumlanacak.
- Zoom ve pan ile hareket edecek.
- Ekran dışına taşmayacak.
- Metin, şekil, medya ve çoklu seçim için değişebilecek.

WP1'de sahte seçili nesne ve sahte seçim toolbar'ı oluşturma.

Arc UI Pro lisansı doğrulanmadan ücretli bileşen kaynak kodunu kopyalama.

---

## 12. Alt slayt şeridi

**Kritik yerleşim kararı:**

Slayt şeridi yalnızca Canvas çalışma alanının tam altında olacak.

Rail ve sol içerik panelinin altına uzanmayacak.

### Görünüm

- Mevcut Folio slide filmstrip tasarımı korunsun.
- Küçük slayt önizlemeleri için alan bulunsun.
- Aktif slayt turuncu kenarlıkla gösterilebilsin.
- Yeni slayt butonunun mevcut yerleşimi korunsun.
- Yatay scroll desteklensin.
- İçerik taşınca ortak Button bileşeninden yatay kaydırma okları görünsün.
- Kart hover/focus büyümesi ve kartlar arasındaki araçların açılma animasyonu korunsun.
- Kartlar sürükle-bırak sıralamayı UI önizlemesi için desteklesin.
- Film şeridi gerektiğinde gizlenebilsin.

Film şeridi `SlideFilmstrip` React bileşenidir. Mevcut kart verisi üç örnek slayttan oluşur; sürükle-bırak sırası yerel geçici UI state'idir, kalıcı belge sırası değildir. Gerçek slayt listesi, thumbnail, ekleme/silme ve motor sıralaması WP3 kapsamındadır. Aralık işlemleri ve yeni slayt düğmesi motor bağlantısına kadar devre dışı kalır.

WP1'de motor olmadan sahte slayt oluşturma veya silme işlemleri ekleme.

Statik önizleme kullanılacaksa gösterim amaçlı olduğu açık olsun.

---

## 13. Alt durum ve zoom alanı

Mevcut Folio alt durum düzeni korunsun.

Alt durum çubuğunun sağında:

- El
- Yakınlaştırma
- Ekrana sığdır

kontrolleri bulunsun.

Alt durum çubuğunun solunda `Slaytlar` görünürlük düğmesi, sayfa numarası ve tek `Kaydetme Kapalı` göstergesi bulunur. Sağ tarafta Notlar, sunum, El, zoom ve Ekrana sığdır kontrolleri yer alır. Motor/servis gerektiren komutlar bağlı değilken devre dışı veya açıklamalı olur.

Aynı yakınlaştırma kontrollerini birden fazla yerde tekrar oluşturma.

Gerçek veri olmayan durum bilgilerini üretme.

---

## 14. Responsive tasarım

En az aşağıdaki ekran boyutlarında doğrulama yap:

### 1366 × 768

- Header tek satırda kalsın.
- Rail menüleri erişilebilir olsun.
- Sol panel canvas'ı kullanılamaz hale getirmesin.
- Film şeridi doğru konumda olsun.
- Kritik butonlar kesilmesin.

### 1920 × 1080

- Canvas dengeli şekilde büyüsün.
- Sol panel gereksiz genişlemesin.
- Header düzgün hizalansın.
- Film şeridi canvas ile aynı çalışma kolonunda kalsın.

### Daha dar ekranlar

- İçerik paneli gerektiğinde overlay davranışına geçebilir.
- Header ikincil eylemleri gruplanabilir.
- Rail etiketleri yerleşime göre uyarlanabilir.

Mevcut Folio tasarımının davranışları korunmalı.

---

## 15. Görsel karşılaştırma ve kalite kontrol

Bu WP1'in en önemli kabul testlerinden biridir.

Eski ATLAS arayüzünü mevcut haliyle referans al.

Yeni Folio arayüzünü aynı ekran boyutlarında karşılaştır.

### Zorunlu çözünürlükler

- 1366×768
- 1920×1080

Mümkünse aynı aktif panel ve benzer canvas görünümü kullanılmalı.

Karşılaştırılacak alanlar:

1. Logo ve marka alanı
2. Header yüksekliği
3. Menü tipografisi
4. Rail genişliği
5. İkon boyutları
6. Sol panel genişliği
7. Renkler
8. Border-radius
9. Kartlar ve paneller
10. Canvas yerleşimi
11. Slayt şeridi
12. Alt kontroller

### Raporlama

Farkları üç gruba ayır:

- Bilerek yapılan tasarım değişiklikleri
- Taşıma sırasında oluşan ve düzeltilmesi gereken farklar
- Motor henüz bağlı olmadığı için eksik olan davranışlar

Eski ATLAS uygulaması mevcut çalışma ağacından güvenli şekilde çalıştırılamıyorsa projeyi değiştirme; mevcut referans görselleri kullan ve karşılaştırmanın kapsamını belirt.

Ekran görüntüsü üretmek mümkün değilse yapılmış gibi raporlama.

---

## 16. Teknik kalite kuralları

- TypeScript strict mode kullan.
- React bileşenlerini sorumluluklarına göre ayır.
- Gereksiz büyük `App.tsx` oluşturma.
- UI-only state ile gelecekteki belge state'ini ayır.
- Kullanılmayan dependency ekleme.
- Yeni ve gereksiz component library kurma.
- Erişilebilir button, menu ve dialog davranışlarını uygula.
- Klavye odağı ve focus stillerini koru.
- Console error/warning üretme.
- Build ve typecheck doğrulamalarını çalıştır.
- Mevcut frontend-design skill kurallarını uygularken Folio tasarımını değiştirme.
- Mevcut projeye doğrudan bağımlı absolute import/path bırakma.
- Varlıkların ve fontların lisanslarını incele.
- Herhangi bir demo UI, gerçek motor işlevi gibi davranmamalı.

---

## 17. WP1 kapsamında yapılmayacaklar

Bu görevde:

- Rust/WASM adapter oluşturma.
- DeckCraft motorunu bağlama.
- TypeScript belge motorunu yeniden yazma.
- Gerçek PPTX import/export geliştirme.
- Gerçek undo/redo sistemi kurma.
- Gerçek slayt veya nesne düzenleme geliştirme.
- AI provider entegrasyonu yapma.
- Floating selection toolbar'ı tamamlamaya çalışma.
- Electron entegrasyonuna başlama.
- Journal/recovery geliştirme.
- Eski ATLAS veya DeckCraft dosyalarını değiştirme.

Bu işlerin tamamı sonraki WP2–WP5 aşamalarında yapılacak.

---

## 18. WP1 kabul kriterleri

WP1 ancak aşağıdaki koşullar sağlanırsa tamamlanmış kabul edilecek:

- [ ] `ATLAS/folio/` oluşturulmuş.
- [ ] Eski `atlas/` değiştirilmemiş.
- [ ] Eski `deckcraft/` değiştirilmemiş.
- [ ] Yeni React + TypeScript + Vite uygulaması çalışıyor.
- [ ] `frontend-design` skill'i yeni proje altında kurulmuş ve talimatları uygulanmış.
- [ ] Mevcut Folio logosu ve tasarım token'ları kullanılıyor.
- [ ] Eski portal/DOM/DocumentStore mimarisi taşınmamış.
- [ ] Header belirlenen menü ve yerleşime sahip.
- [ ] Sekizli rail doğru sırada.
- [ ] Yardım altta sabit.
- [ ] Sol panel açılıp kapanıyor.
- [ ] Panel kapanınca canvas genişliyor.
- [ ] Sağda kalıcı özellik paneli yok.
- [ ] Film şeridi canvas'ın tam altında.
- [ ] Canvas sağ alt kontrolleri mevcut.
- [ ] 1366×768 yerleşimi doğrulanmış.
- [ ] 1920×1080 yerleşimi doğrulanmış.
- [ ] Sahte çalışan belge, AI veya paylaşım işlevleri yok.
- [ ] Build ve typecheck başarılı.
- [ ] Görsel karşılaştırma yapılmış veya doğrulanamayan kısımlar açıkça belirtilmiş.

---

## 19. Tamamlandığında raporla

İş bittiğinde aşağıdaki bilgileri sun:

1. Oluşturulan `folio/` dosya ağacı.
2. Eski ATLAS'tan kopyalanan bileşenler.
3. React için yeniden düzenlenen bileşenler.
4. `frontend-design` skill'inin kaynağı, kurulumu ve kullanımı.
5. Değiştirilen/oluşturulan dosyalar.
6. Kullanılan bağımlılıklar.
7. Çalıştırma komutları.
8. Build/typecheck sonuçları.
9. 1366×768 ve 1920×1080 ekran görüntüleri.
10. Eski ATLAS ile görsel farklar.
11. Bilerek devre dışı bırakılan özellikler.
12. WP2 için hazır arayüz bağlantı noktaları.

Eski projelerde değişiklik olmadığını Git durumu ve dosya karşılaştırmasıyla doğrula.

## 20. Son talimat

**Artık plan hazırlama aşamasını tamamladık. WP1'i doğrudan uygula.**

Yeni `ATLAS/folio/` klasörünü oluştur, mevcut Folio arayüzünü koruyarak tamamen React + TypeScript tabanlı uygulama kabuğunu geliştir.

`frontend-design` skill'ini yeni projeye kur ve tasarım uygulaması sırasında aktif kullan.

Mevcut ATLAS ve DeckCraft kaynaklarına dokunma.

**Amaç yeni bir arayüz icat etmek değil; mevcut Folio arayüzünü temiz bir React mimarisine taşıyıp Rust/WASM motor entegrasyonuna hazır hale getirmektir.**
