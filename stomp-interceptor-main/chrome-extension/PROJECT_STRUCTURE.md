# STOMP WebSocket Interceptor & Replayer — Proje Mimarisi ve Klasör Yapısı

Bu doküman, **STOMP WebSocket Interceptor & Replayer** Chrome Eklentisi ve entegre test ortamının genel mimarisini, kullanılan teknolojileri, güncel dosya yapısını ve bileşen işlevlerini ayrıntılı olarak açıklamaktadır.

---

## 📌 Proje Özeti ve Amacı

Bu sistem, web istemcileri (React, Angular, Vue, Vanilla JS vb.) ile sunucu (Spring Boot STOMP Broker vb.) arasında **WebSocket** üzerinden iletilen **STOMP (Simple Text Oriented Messaging Protocol)** mesajlarını yakalayan, kaydeden, inceleyen, düzenleyen ve tekrar oynatan (replay) profesyonel bir **Chrome Extension (Manifest V3)** ve beraberindeki **Canlı Radar Konsolu** test sunucusudur.

### 🌟 Temel Özellikler
- **Canlı Dinleme (Intercepting)**: `chrome.debugger` API'si (Chrome DevTools Protocol) ile düşük seviyeli WebSocket paketlerini tarayıcı katmanında kesintisiz dinler.
- **Ayrıştırma & Doğrulama (Parsing)**: STOMP paketlerini (`CONNECT`, `SUBSCRIBE`, `SEND`, `MESSAGE`, `UNSUBSCRIBE` vb.) komut, başlıklar (headers) ve gövde (body) bölümlerine eksiksiz ayırır.
- **IndexedDB Depolama**: Kaydedilen oturumları ve paket akışını **Dexie.js** kütüphanesi ile yerel tarayıcı veritabanında saklar.
- **Detaylı Paket & Oturum Yönetimi**:
  - Çoklu veya tekil paket silme (`Delete Frame`),
  - Oturum silme (`Delete Session`),
  - JSON formatında içe/dışa aktarma (`Export/Import JSON`).
- **Gelişmiş JSON Editörü**: Ham metin ve interaktif ağaç (Tree) görünümü arasında geçiş imkanı, anlık sözdizimi doğrulama.
- **Çift Yönlü Replay Engine**:
  1. **CLIENT Mode (Varsayılan)**: Kaydedilen mesajları web istemcisi gibi WebSocket üzerinden doğrudan sunucuya tekrar iletir.
  2. **SERVER_MOCK Mode**: Sunucudan gelmiş gibi mesajları DevTools Protocol üzerinden doğrudan tarayıcı STOMP istemcisine enjekte eder.
- **Entegre Askeri Radar Test Konsolu (`localhost:8080`)**:
  - `/topic/signal`, `/topic/systemstatus`, `/topic/target`, `/topic/alert` kanalları.
  - Canlı 360° döner tarama ışınlı taktik radar skopu, tam çerçeve ızgara ve çoklu hedef renklendirmesi (🟢 SIGNAL, 🟡 TARGET, 🔴 ALERT).

---

## 🛠️ Teknoloji Yığını (Tech Stack)

| Katman | Teknoloji | Açıklama |
| :--- | :--- | :--- |
| **Uzantı Dili** | TypeScript 5+ | Tip güvenliği ve `strict: true` yapılandırması |
| **Uzantı UI** | React 19 | Pop-up ve Dashboard modern arayüz bileşenleri |
| **Paketleyici (Bundler)** | Vite 6 + `@crxjs/vite-plugin` | Manifest V3 uyumlu hızlı HMR ve üretim derleyicisi |
| **Veritabanı** | Dexie.js 4+ | IndexedDB üzerinde nesne tabanlı yerel depolama |
| **Tipografi** | Google Fonts | `Inter` (UI) ve `JetBrains Mono` (Teknik veriler & loglar) |
| **Tasarım / CSS** | Vanilla CSS (Variables) | Modern koyu tema (Deep Obsidian), cam efekti ve taktik renk paleti |
| **Extension APIs** | Chrome Extension MV3 | `debugger`, `scripting`, `tabs`, `storage`, `activeTab` |
| **Test Backend** | Spring Boot 3.4.2 (Java 17) | WebSocket & STOMP Broker, Simüle AESA Radar Yayıncısı |

---

## 📂 Klasör ve Dosya Yapısı

```
stomp-interceptor-main/
│
├── backend/                                    # Test ve Doğrulama Spring Boot Sunucusu (localhost:8080)
│   ├── src/main/java/com/example/stomp/
│   │   ├── StompApplication.java               # Spring Boot Ana Başlatıcı Sınıfı
│   │   ├── config/
│   │   │   └── WebSocketConfig.java            # STOMP /ws Endpoint ve /topic, /app Broker Ayarları
│   │   ├── controller/
│   │   │   └── StompMessageController.java     # /signal, /target, /alert, /systemstatus İşleyicileri
│   │   ├── model/
│   │   │   └── ChatMessage.java                # Mesaj Veri Modeli
│   │   └── service/
│   │       └── HeartbeatPublisher.java         # /topic/systemstatus Periyodik Telemetri Yayıncısı
│   │
│   ├── src/main/resources/
│   │   ├── application.properties              # Sunucu Port ve Yapılandırması (8080)
│   │   └── static/                             # C2 Radar Konsolu Web Arayüzü
│   │       ├── index.html                      # Konsol Arayüzü (HTML5 + 360° Radar Canvas)
│   │       ├── css/style.css                   # Taktik Koyu Tema, Izgara Deseni ve Hover Efektleri
│   │       └── js/
│   │           ├── stomp-client.js             # Hafif STOMP İstemci Kütüphanesi
│   │           └── app.js                      # Radar Çizim Motoru, Şablonlar & WebSocket Yönetimi
│   └── pom.xml                                 # Maven Bağımlılıkları ve Yapılandırması
│
└── chrome-extension/                           # Chrome Eklentisi Ana Kaynak Kodları
    ├── dist/                                   # Derlenmiş Üretim Çıktısı (Chrome'a yüklenen klasör)
    │   ├── manifest.json                       # Derleme sonrası Manifest V3 yapılandırması
    │   ├── service-worker-loader.js            # Background Service Worker başlatıcısı
    │   └── assets/                             # Paketlenmiş JS, CSS ve HTML dosyaları
    │
    ├── src/                                    # TypeScript & React Kaynak Kodları
    │   ├── types/
    │   │   └── index.ts                        # StompFrame, Session, FrameRecord ve Mesajlaşma Tipleri
    │   │
    │   ├── lib/
    │   │   ├── stomp-parser.ts                 # STOMP 1.0/1.1/1.2 Frame Parser & Serializer
    │   │   └── db.ts                           # Dexie.js IndexedDB Veritabanı ve CRUD Yöneticisi
    │   │
    │   ├── background/
    │   │   └── index.ts                        # Service Worker (chrome.debugger & Çift Yönlü Replay Engine)
    │   │
    │   ├── components/                         # Modüler React UI Bileşenleri
    │   │   ├── DirectionTag.tsx                # SENT / RECEIVED yön etiketi rozeti
    │   │   ├── StatusPill.tsx                  # Recording / Idle durum göstergesi
    │   │   ├── SessionCard.tsx                 # Oturum listesi kartı
    │   │   ├── SessionDropdown.tsx             # Hızlı oturum seçici açılır menü
    │   │   ├── LiveFeedFrame.tsx               # Canlı yakalanan STOMP mesajı önizleme rozeti
    │   │   ├── FrameTable.tsx                  # Mesaj tablosu, çoklu seçim, arama ve filtreleme
    │   │   ├── FrameInspector.tsx              # Sağ panel: Header'lar, JSON Editor, Tekil Silme & Replay
    │   │   ├── JsonEditor.tsx                  # Kod / Ağaç Görünümlü İnteraktif JSON Editörü
    │   │   ├── JsonEditor.css                  # JSON Editörü Stilleri
    │   │   ├── Toast.tsx                       # Bildirim (Toast) Mesaj Bileşeni
    │   │   └── Toast.css                       # Bildirim Stilleri
    │   │
    │   ├── popup/                              # Popup Arayüzü (Toolbar İkonuna Basılınca Açılır)
    │   │   ├── index.html                      # Popup HTML Şablonu
    │   │   ├── main.tsx                        # Popup React Başlangıç Noktası
    │   │   ├── Popup.tsx                       # Popup Ana Kontrol Paneli
    │   │   └── Popup.css                       # Popup Stilleri
    │   │
    │   └── dashboard/                          # Tam Ekran Dashboard Arayüzü
    │       ├── index.html                      # Dashboard HTML Şablonu
    │       ├── main.tsx                        # Dashboard React Başlangıç Noktası
    │       ├── Dashboard.tsx                   # Dashboard Ana Sayfası ve Oturum Yöneticisi
    │       └── Dashboard.css                   # Dashboard Stilleri
    │
    ├── manifest.json                           # Chrome Extension Manifest V3 Tanımı
    ├── vite.config.js                          # Vite & CRXJS Derleyici Konfigürasyonu
    ├── tsconfig.json                           # TypeScript Ayarları
    ├── package.json                            # npm Paket Bağımlılıkları ve Scriptleri
    ├── PROJECT_STRUCTURE.md                    # Proje Mimarisi ve Klasör Yapısı Dokümanı
    └── README.md                               # Genel Tanıtım ve Kurulum Kılavuzu
```

---

## ⚡ Modüllerin ve Bileşenlerin Detaylı İncelemesi

### 1. `src/types/index.ts`
- **`StompFrame`**: `command`, `headers`, `body`, `rawPayload` ve `timestamp` içeren temel STOMP veri yapısı.
- **`Session`**: Kaydedilen oturumun ID'si, adı, başlangıç/bitiş zamanı, sekme URL'si ve paket sayısını (`frameCount`) tutar.
- **`FrameRecord`**: Veritabanında saklanan her bir paketin yönünü (`SENT` / `RECEIVED`), oturum ID'sini ve STOMP ayrıntılarını tanımlar.
- **`ReplayMode`**: `'CLIENT'` (WebSockets üzerinden iletme) ve `'SERVER_MOCK'` (DevTools protokolü üzerinden enjekte etme) modları.

### 2. `src/lib/stomp-parser.ts`
- `parseStompFrames(rawText)`: WebSocket üzerinden akan ham metni (`\u0000` NULL byte ile sonlanan) STOMP komutlarına, header satırlarına ve JSON gövdeye ayrıştırır.
- `serializeStompFrame(frame)`: Düzenlenmiş frame nesnesini standart STOMP protokol formatında metne dönüştürür.

### 3. `src/lib/db.ts`
- Dexie tabanlı `StompInterceptorDB` veritabanı sınıfı:
  - `sessions` tablosu: Oturum metaverileri.
  - `frames` tablosu: Yakalanan tüm STOMP paketleri.
- **CRUD Fonksiyonları**:
  - `deleteSession(sessionId)`: Oturumu ve ona bağlı tüm frame'leri temizler.
  - `deleteFrame(frameId, sessionId)`: Tek bir frame'i siler ve oturumun `frameCount` değerini günceller.
  - `deleteFrames(frameIds, sessionId)`: Seçili frame'leri topluca siler.
  - `exportSessionJSON(sessionId)` / `importSessionJSON(jsonString)`: Oturumları JSON olarak dışa aktarır ve içeri alır.

### 4. `src/background/index.ts` (Service Worker)
- **`chrome.debugger` Dinleyicisi**: `Network.webSocketFrameReceived` ve `Network.webSocketFrameSent` olaylarını yakalar.
- **Replay Motoru**:
  - `CLIENT` modunda sekmede çalışan STOMP istemcisine mesaj gönderir.
  - `SERVER_MOCK` modunda `Network.webSocketFrameReceived` taklit ederek sunucu mesajı gibi tarayıcıya iletir.

### 5. `src/components/` UI Bileşenleri
- **`FrameTable.tsx`**: Oturumdaki paketleri tablo halinde listeler, metin araması, komut (`SEND`, `MESSAGE` vb.) ve yön (`SENT`, `RECEIVED`) filtrelemesi sunar.
- **`FrameInspector.tsx`**: Seçilen paketin başlıklarını, gövdesini ve ham yükünü gösterir; JSON düzenleme, tekil frame silme ve tekil frame replay imkanı sağlar.
- **`JsonEditor.tsx`**: Hem ham JSON kod editörü hem de interaktif ağaç (Tree) gezgini sunar.
- **`Toast.tsx`**: Kullanıcıya anlık başarı, uyarı ve hata bildirimlerini zarif animasyonlarla iletir.

---

## 🚀 Derleme ve Çalıştırma Komutları

### Chrome Eklentisi (`chrome-extension/`)
```powershell
# Bağımlılıkları yükleme
npm install

# Üretim derlemesi (dist/ klasörünü oluşturur)
npm run build

# Geliştirme modu (değişiklikleri otomatik derler)
npm run watch
```

### Test Backend Sunucusu (`backend/`)
```powershell
# Maven ile Spring Boot uygulamasını başlatma (localhost:8080)
mvn spring-boot:run
```

---

## 🧩 Chrome'a Yükleme Adımları

1. `chrome-extension` klasöründe `npm run build` komutunu çalıştırın.
2. Google Chrome'da `chrome://extensions` sayfasına gidin.
3. Sağ üst köşedeki **Geliştirici modunu (Developer mode)** açın.
4. **Paketlenmemiş öğe yükle (Load unpacked)** butonuna tıklayın.
5. `stomp-interceptor-main/chrome-extension/dist` klasörünü seçin.

---

## 📝 Değişiklik Logu

### 2026-09-08 — SockJS Entegrasyonu & Gerçek Sistem Uyumu

#### Değiştirilen Dosyalar

**`src/lib/stomp-parser.ts`**
- **`unwrapSockJSPayload(data: string): string[]`** fonksiyonu eklendi.
  - SockJS framing protokolünü açar: `'h'`/`'o'` (heartbeat / open) → skip; `'a[...]'` → JSON array parse edilip içindeki STOMP string'leri döndürülür; `'c[...]'` (close) → skip; düz metin → direkt geçirilir (test backend uyumluluğu).
  - **Neden:** Gerçek sistemde STOMP mesajları SockJS taşıma katmanı tarafından `a["STOMP_FRAME"]` formatında sarmalanıyor. Önceki parser bu sarmalamayı anlayamıyor, dolayısıyla gerçek sistemden gelen frame'ler hiç kaydedilemiyordu.

**`src/background/index.ts`**
- **`Network.webSocketCreated` olayı dinlemeye alındı.**
  - Tab başına WebSocket bağlantılarını `requestId → url` eşlemesiyle `tabWebSockets` Map'inde takip eder.
  - `isSockJSTransportUrl(url)` yardımcı fonksiyonu ile URL'si `/websocket` ile biten bağlantılar SockJS transport olarak tanımlanır.
  - Frame olaylarında (`webSocketFrameSent` / `webSocketFrameReceived`) yalnızca SockJS transport URL'ine sahip `requestId`'ler işlenir; diğerleri (heartbeat kanalı vb.) atlanır.
  - **Neden:** Network sekmesinde iki WebSocket bağlantısı görünüyordu: gerçek STOMP verisini taşıyan `…/websocket` ve yalnızca `h` (ping) gönderen random sayılı kanal. Extension ikincisini dinliyordu; artık doğru kanalı dinliyor.

- **SockJS unwrapping entegre edildi.**
  - Her `payloadData` önce `unwrapSockJSPayload()` ile işlenir; sonuç dizisindeki her STOMP string ayrı ayrı `parseStompFrames()` ile parse edilir.
  - **Neden:** `h` heartbeat frame'leri boş dizi döndürüp erken çıkış sağlar; `a[...]` frame'leri gerçek STOMP içeriğini çıkarır.

- **`activeTabSubscriptions` Map'i ve tüm SUBSCRIBE/UNSUBSCRIBE takip kodu kaldırıldı.**
  - **Neden:** Aynı topic farklı kullanıcılar tarafından dinlenebilir; duplicate koruma bu senaryoyu engelliyordu. Ayrıca sistem ayağa kalktığında zaten tüm topic'lere subscribe olunmuş halde geldiğinden ekstra takibe gerek yoktu.

- **`executeReplaySequence` içindeki `__stompReplaySubs` bootstrap inject kaldırıldı.**
  - **Neden:** Subscription tracking mekanizması kaldırıldığından bu bootstrap da gereksiz hale geldi.

- **CLIENT mode replay'deki duplicate sub/unsub skip kontrolleri kaldırıldı.**
  - `SUBSCRIBE`: Önceden `win.__stompReplaySubs[destination]` doluysa `'SKIPPED'` döndürüyordu → kaldırıldı.
  - `UNSUBSCRIBE`: Önceden `win.__stompReplaySubs[destination]` yoksa `'SKIPPED'` döndürüyordu → kaldırıldı.
  - `__stompReplaySubs` tüm izleme kodu temizlendi.
  - **Neden:** Gerçek sistemde aynı topic'e birden fazla subscriber olabileceğinden bu kontroller yanlış sonuçlar üretiyordu.

- **CLIENT mode replay'de `window.stompClient` fallback eklendi.**
  - `window.client || window.stompClient` şeklinde her iki yaygın değişken adı deneniyor.
  - **Neden:** Gerçek sistemde global STOMP client değişkeninin adı bilinmediğinden iki en yaygın isme otomatik fallback sağlandı.

- **`Network.webSocketClosed` / `Network.webSocketFrameError` olayları dinleniyor.**
  - Kapatılan/hatalı WS bağlantıları `tabWebSockets` Map'inden temizleniyor.
  - **Neden:** Bellek sızıntısını önlemek için gereksiz kayıtlar temizlendi.

- **Replay stratejisi sadeleştirildi (SERVER_MOCK kaldırıldı).**
  - Popup arayüzünden (`Popup.tsx` ve `popup.html`) "Replay Strategy" (Server Mock vs Client) açılır menüsü tamamen kaldırıldı. Tüm replay işlemleri varsayılan olarak doğrudan websocket istemcisi (`CLIENT` modu) üzerinden yürütülecek şekilde sabitlendi.
  - Background script (`index.ts`) ve Dashboard bileşenlerinden `SERVER_MOCK` kod mantığı temizlendi.
  - **Neden:** Gerçek sistemde sunucu taklidi (Server Mocking) yerine doğrudan istemci üzerinden canlı websocket iletisini tekrar oynatmak esas olduğu için arayüz sadeleştirildi.

- **Kayıt Esnasında Popup Re-open Durumunda Canlı Akış & Sayaç Kalıcılığı (`Popup.tsx` ve `popup.js`)**
  - Popup açıldığında eğer arka planda devam eden bir kayıt oturumu varsa (`isRecording: true`), o ana kadar veritabanına (`IndexedDB`) yazılmış olan frame'ler `getSessionFrames(sessionId)` fonksiyonu ile çekilerek popup arayüzündeki frame sayacı ve **Intercepted Frames** canlı akış listesi dolduruluyor.
  - **Neden:** Popup kapandığında React local state sıfırlandığı için, kayıt devam ederken eklenti simgesine tekrar tıklandığında canlı liste boş ve sayaç 0 görünüyordu. Bu durum kaydın durduğu veya çalışmadığı algısına yol açıyordu. Yapılan düzenleme ile popup her açıldığında mevcut aktif oturumun güncel akışı ve sayaç değeri anında ekrana yükleniyor.

- **SockJS Client→Server Format Desteği (`stomp-parser.ts`)**
  - `unwrapSockJSPayload()` fonksiyonuna `["STOMP_FRAME"]` formatı desteği eklendi (başında `a` harfi YOK).
  - SockJS protokol şartnamesine göre iki yönün formatı farklıdır:
    - **Sunucu→İstemci (Gelen):** `a["STOMP_FRAME"]` — 'a' harfi var.
    - **İstemci→Sunucu (Giden):** `["STOMP_FRAME"]` — 'a' harfi YOK, saf JSON array.
  - Önceden giden (SENT) frame'ler yanlışlıkla düz metin olarak işleniyordu; bu nedenle gerçek SockJS sistemiyle kullanıldığında SENT frame'ler (SEND, SUBSCRIBE vb.) hatalı parse ediliyordu. Düzeltme ile artık her iki format da doğru şekilde çözümleniyor.

- **SockJS WebSocket Hook Content Script (`src/content/sockjs-hook.ts`)**
  - `document_start` aşamasında MAIN world'de çalışan yeni bir content script oluşturuldu.
  - `window.WebSocket` constructor'ı override edilerek URL'si `/websocket` ile biten SockJS transport bağlantısı `window.__stompInterceptorWS` değişkeninde saklanıyor.
  - `manifest.json`'a `content_scripts` girişi eklendi.
  - **Neden:** Kaynak koduna erişilemeyen uygulamalarda `window.client` veya `window.stompClient` gibi yüksek seviyeli STOMP istemci değişkenleri dışarı açılmamış olabilir. Hook sayesinde eklenti, ham WebSocket katmanına `document_start`'ta erişerek sayfanın kodu çalışmadan bağlantıyı yakalar.

- **Replay Motoru: Doğrudan SockJS WebSocket ile Gönderim (`background/index.ts`)**
  - `window.client.send()` yaklaşımı terk edildi.
  - Replay yapılırken `window.__stompInterceptorWS` (hook tarafından yakalanan canlı WebSocket) kullanılıyor.
  - Ham STOMP frame'i `JSON.stringify([rawStompFrame])` ile SockJS istemci→sunucu formatına (`["STOMP_FRAME"]`) sarmalanarak `ws.send()` ile gönderiliyor.
  - RECEIVED yönlü frame'ler (sunucudan gelen mesajlar) replay akışında atlanıyor, kullanıcıya anlamlı hata mesajı veriliyor.
  - **Neden:** Uygulamanın kaynak koduna erişim olmaksızın doğru SockJS formatında veri göndermek için `window.WebSocket` düzeyine inmek gerekir. Ayrıca SockJS protokol şartnamesine göre istemciden gönderilen frame'lerde başında 'a' harfi bulunmaz; `["..."]` formatı kullanılır. Eski yaklaşımda `window.client` bulunamazsa replay tamamen başarısız oluyordu.

> [!NOTE]
> **Önemli:** Sayfayı eklenti yüklendikten sonra açarsanız hook otomatik çalışır. Eklentiyi zaten açık bir sayfada etkinleştirdiyseniz, hook'un devreye girmesi için sayfayı bir kez yenilemeniz (F5) gerekir.
