# STOMP WebSocket Interceptor & Replayer — Proje Mimarisi ve Klasör Yapısı

Bu doküman, **STOMP WebSocket Interceptor & Replayer** Chrome Eklentisi projesinin genel mimarisini, kullanılan teknolojileri ve klasör/dosya yapısını ayrıntılı olarak açıklamaktadır.

---

## 📌 Proje Özeti ve Amacı

Bu uygulama, web istemcileri (React, Angular, Vue vb.) ile sunucu (Spring Boot STOMP Broker vb.) arasında **WebSocket** protokolu üzerinden iletilen **STOMP (Simple Text Oriented Messaging Protocol)** mesajlarını yakalayan, kaydeden ve tekrar oynatan (replay) bir **Chrome Extension (Manifest V3)** uygulamasıdır.

### Temel Özellikler
- **Canlı Dinleme (Intercepting)**: `chrome.debugger` API'si (DevTools Protocol) ile düşük seviyeli WebSocket paketlerini tarayıcı katmanında kesintisiz dinler.
- **Ayrıştırma (Parsing)**: STOMP paketlerini (`CONNECT`, `SUBSCRIBE`, `SEND`, `MESSAGE`, `UNSUBSCRIBE` vb.) komut, header ve payload bölümlerine ayırır.
- **IndexedDB Depolama**: Kaydedilen oturumları ve paket akışını **Dexie.js** kütüphanesi ile yerel tarayıcı veritabanında saklar.
- **React 19 & TypeScript Arayüzü**: Pop-up menüsü ve detaylı Dashboard ekranı üzerinden verileri filtreleme, JSON payload düzenleme ve canlı paket akışını izleme imkanı sunar.
- **Çift Yönlü Replay Engine**:
  1. **CLIENT Mode**: Kaydedilen mesajları istemci gibi sunucuya tekrar gönderir.
  2. **SERVER_MOCK Mode**: Sunucudan gelmiş gibi mesajları doğrudan tarayıcı STOMP istemcisine enjekte eder.

---

## 🛠️ Teknoloji Yığını (Tech Stack)

| Bileşen | Teknoloji | Açıklama |
| :--- | :--- | :--- |
| **Dil** | TypeScript 5+ | Tip güvenliği ve gelişmiş geliştirici deneyimi (`strict: true`) |
| **UI Kütüphanesi** | React 19 | Pop-up ve Dashboard arayüz bileşenleri |
| **Paketleyici (Bundler)** | Vite 6 + `@crxjs/vite-plugin` | Manifest V3 uyumlu hızlı derleme ve modül paketleme |
| **Veritabanı** | Dexie.js 4+ | IndexedDB üzerinde nesne tabanlı yerel depolama |
| **Styling** | Vanilla CSS / CSS Variables | Modern dark mode, cam efekti (glassmorphism) ve responsive tasarım |
| **Extension APIs** | Chrome Extension Manifest V3 | `debugger`, `scripting`, `tabs`, `storage`, `activeTab` |

---

## 📂 Klasör ve Dosya Yapısı

```
stomp-interceptor-main/
├── backend/                            # Test ve Doğrulama için Spring Boot Sunucusu
│   ├── src/main/java/...               # WebSocket & STOMP Broker yapılandırması
│   └── pom.xml                         # Maven bağımlılıkları
│
└── chrome-extension/                   # Chrome Eklentisi Ana Kod Tabanı
    ├── dist/                           # Derlenmiş üretim çıktısı (Chrome'a bu klasör yüklenir)
    │   ├── manifest.json               # Derleme sonrası Manifest V3 yapılandırması
    │   ├── service-worker-loader.js    # Service Worker başlatıcı scripti
    │   └── assets/                     # Derlenmiş JS, CSS ve HTML varlıkları
    │
    ├── src/                            # Aktif TypeScript + React Kaynak Kodları
    │   ├── types/
    │   │   └── index.ts                # Tüm STOMP, Veritabanı ve Mesajlaşma Tip Tanımları
    │   │
    │   ├── lib/
    │   │   ├── stomp-parser.ts         # STOMP 1.0/1.1/1.2 Frame Ayrıştırıcı ve Seri Hale Getirici
    │   │   └── db.ts                   # Dexie.js (IndexedDB) Veritabanı Sınıfı ve CRUD İşlemleri
    │   │
    │   ├── background/
    │   │   └── index.ts                # Chrome Service Worker (Debugger, Replay Engine, Event Listeners)
    │   │
    │   ├── components/                 # Yeniden Kullanılabilir React Bileşenleri
    │   │   ├── DirectionTag.tsx        # SENT / RECEIVED yön etiketi badge bileşeni
    │   │   ├── StatusPill.tsx          # Recording / Idle canlı durum göstergesi
    │   │   ├── SessionCard.tsx         # Sidebar içerisindeki oturum kartı
    │   │   ├── SessionDropdown.tsx     # Oturum seçim açılır menüsü
    │   │   ├── LiveFeedFrame.tsx       # Canlı akan STOMP mesajı preview rozeti
    │   │   ├── FrameTable.tsx          # Oturuma ait STOMP mesajları tablosu ve filtreleme
    │   │   ├── FrameInspector.tsx      # Sağ panel: Header detayları, Raw Payload ve Replay butonları
    │   │   ├── JsonEditor.tsx          # İnteraktif JSON Kod & Tree Editor bileşeni
    │   │   └── JsonEditor.css          # JSON Editor stilleri
    │   │
    │   ├── popup/                      # Eklenti Pop-up Arayüzü (Araç çubuğuna tıklayınca açılan pencere)
    │   │   ├── index.html              # Pop-up HTML şablonu
    │   │   ├── main.tsx                # Pop-up React giriş noktası
    │   │   ├── Popup.tsx               # Pop-up ana arayüz bileşeni
    │   │   └── Popup.css               # Pop-up stilleri
    │   │
    │   └── dashboard/                  # Tam Ekran Dashboard Arayüzü (Gelişmiş İnceleme & Replay)
    │       ├── index.html              # Dashboard HTML şablonu
    │       ├── main.tsx                # Dashboard React giriş noktası
    │       ├── Dashboard.tsx           # Dashboard ana layout ve durum yönetimi bileşeni
    │       └── Dashboard.css           # Dashboard stilleri
    │
    ├── manifest.json                   # Chrome Extension Manifest V3 Yapılandırma Dosyası
    ├── vite.config.js                  # Vite ve CRXJS eklenti konfigürasyonu
    ├── tsconfig.json                   # TypeScript derleyici ayarları (`strict: true`)
    ├── package.json                    # npm paket bağımlılıkları ve npm betikleri
    └── README.md                       # Kullanım ve kurulum rehberi
```

---

## ⚡ Modüllerin Detaylı Açıklaması

### 1. `src/types/index.ts`
Projedeki veri yapılarını tanımlayan ana TypeScript dosyasudur:
- `StompFrame`: STOMP mesajının komut (`command`), hedef (`destination`), başlıklar (`headers`), gövde (`body`) ve ham metin (`rawPayload`) temsilcisi.
- `Session` & `FrameRecord`: IndexedDB veritabanında saklanan oturum ve paket kayıt modelleri.
- `ExtensionRequestMessage` & `ExtensionBroadcastEvent`: Service Worker ile React UI arasındaki `chrome.runtime.sendMessage` mesajlaşma tipleri.

### 2. `src/lib/stomp-parser.ts`
WebSocket üzerinden geçen `\u0000` (NULL byte) ile sonlanan ham string verileri analiz eder:
- Başlık satırlarını (`destination`, `subscription`, `id`, `content-type`) nesneye dönüştürür.
- Gövde (body) bölümünü ve kalp atışlarını (heartbeat) doğru şekilde ayırır.

### 3. `src/lib/db.ts`
Dexie.js kütüphanesini kullanarak `StompInterceptorDB` adında bir IndexedDB veritabanı yönetir:
- `sessions` tablosu: Kayıt adı, başlama/bitiş zamanı, toplam paket sayısı ve sekme bilgilerini saklar.
- `frames` tablosu: Her bir STOMP paketinin detaylarını, yönünü (`SENT`/`RECEIVED`) ve zaman damgasını tutar.
- JSON dışa aktarma (`exportSessionJSON`) ve içe aktarma (`importSessionJSON`) fonksiyonlarını içerir.

### 4. `src/background/index.ts` (Service Worker)
Eklentinin arka planda çalışan beynidir:
- **`chrome.debugger` API**: Hedef sekmeye bağlanarak WebSocket paketlerini anlık olarak yakalar.
- **Replay Engine**: Kaydedilen paket sırasını orjinal zaman aralıkları ile (veya tekil olarak) sekmeye yeniden gönderir.

### 5. `src/popup/` & `src/dashboard/`
- **Popup (`Popup.tsx`)**: Hızlı başlat/durdur, canlı paket sayacı, son paketlerin özeti ve hızlı replay sunan küçük pencere.
- **Dashboard (`Dashboard.tsx`)**: Tüm oturumları inceleme, filtreleme, JSON payload düzenleme ve dışa/içe aktarma imkanı sağlayan tam ekran kontrol paneli.

---

## 🚀 Komutlar ve Çalıştırma

| Komut | Açıklama |
| :--- | :--- |
| `npm run build` | Projeyi TypeScript ile derler ve `dist/` klasörünü oluşturur. |
| `npm run watch` | Kod değişikliklerinde `dist/` klasörünü otomatik olarak günceller. |
| `npx tsc --noEmit` | Herhangi bir derleme yapmadan tüm projenin TypeScript tip kontrolünü gerçekleştirir. |

---

## 🧩 Chrome'a Yükleme Rehberi

1. `npm run build` komutunu çalıştırın.
2. Chrome'da `chrome://extensions` sayfasını açın.
3. Sağ üstteki **Geliştirici modunu** aktif hale getirin.
4. **Geliştirilmiş öğe yükle (Load unpacked)** butonuna basarak `chrome-extension/dist` klasörünü seçin.
