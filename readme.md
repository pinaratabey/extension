# STOMP Interceptor & Replay — Sistem Mimarisi

## Genel Bakış

Bu sistem, tarayıcı üzerinden kurulan WebSocket/STOMP bağlantılarını izlemek, kaydetmek ve tekrar oynatmak (replay) için geliştirilmiş bir **Chrome Extension + Spring Boot backend** kombinasyonudur.

```
┌───────────────────────────────────────────────────────────────┐
│                         Chrome Browser                        │
│                                                               │
│  ┌──────────────┐    ┌───────────────────────────────────┐   │
│  │  Ext. Popup  │    │     Test / Gerçek Web Sayfası     │   │
│  │  (popup/)    │    │                                   │   │
│  └──────┬───────┘    │  window.client (STOMP client)     │   │
│         │            │  window.__stompReplaySubs          │   │
│  ┌──────▼──────────┐ │  WebSocket bağlantısı             │   │
│  │ Background SW   │◄┘                                   │   │
│  │ (background.js) │                                     │   │
│  └──────┬──────────┘ ┌───────────────────────────────┐   │   │
│         │            │  Dashboard (Options Page)      │   │   │
│  ┌──────▼──────────┐ │  (dashboard/)                 │   │   │
│  │   IndexedDB     │◄│  Session listesi, Frame tablo │   │   │
│  │   (Dexie.js)    │ │  Inspector, Replay Selected   │   │   │
│  │  sessions       │ └───────────────────────────────┘   │   │
│  │  frames         │                                     │   │
│  └─────────────────┘                                     │   │
└───────────────────────────────────────────────────────────────┘
          ▲
          │ HTTP / WebSocket
          ▼
┌─────────────────────┐
│  Spring Boot Backend│
│  (localhost:8080)   │
│  /ws  WebSocket EP  │
│  /app/... @Mapping  │
│  /topic/... broker  │
└─────────────────────┘
```

---

## Bileşenler

### 1. `background.js` — Service Worker (Tüm Sistemin Beyni)

Extension'ın arka planda çalışan tek yetkili bileşeni. Üç temel görevi vardır.

#### a) WebSocket Trafik İzleme (Kayıt)

Chrome DevTools Protocol (CDP) ile aktif sekmedeki tüm WebSocket frame'lerini yakalar:

```
chrome.debugger.attach({ tabId }) → Network.enable()
        ↓
chrome.debugger.onEvent()
  method: Network.webSocketFrameSent   → direction: 'SENT'
  method: Network.webSocketFrameReceived → direction: 'RECEIVED'
        ↓
parseStompFrames(payloadData)   → STOMP frame nesneleri
        ↓
saveFrame(sessionId, direction, frame) → IndexedDB'ye yaz
        ↓ (eğer SENT + SUBSCRIBE/UNSUBSCRIBE ise)
activeTabSubscriptions güncelle   Map<tabId, Map<destination, subId>>
        ↓
STOMP_FRAME_INTERCEPTED broadcast → Popup canlı feed'ini günceller
```

`activeTabSubscriptions` gerçek WS trafiğinden elde edilen abonelik durumunu tutar; replay sırasında bootstrap için kullanılır.

#### b) Mesaj Yönetimi

`chrome.runtime.onMessage` ile popup ve dashboard'dan gelen komutları işler:

| Mesaj Tipi | Ne Yapar |
|---|---|
| `START_RECORDING` | Debugger attach, yeni session oluşturur |
| `STOP_RECORDING` | Debugger detach, session'ı kapatır |
| `GET_RECORDING_STATUS` | Kayıt aktif mi? |
| `GET_REPLAY_STATUS` | Replay devam ediyor mu? |
| `REPLAY_SESSION` | Tüm session'ı replay eder (async, fire-and-forget) |
| `REPLAY_SINGLE_FRAME` | Tek frame replay — Dashboard'dan gelir |

#### c) Replay Engine — `executeReplaySequence()`

İki mod desteklenir:

**`CLIENT` modu** (SENT frame'lerini tekrar gönderir):

```
1. Bootstrap: window.__stompReplaySubs merge edilir
   (mevcut page state + background'dan bilinen sub'lar)

2. Her frame için chrome.scripting.executeScript (MAIN world):
   ├─ SUBSCRIBE  → duplicate kontrolü → window.client.subscribe()
   ├─ SEND       → window.client.send()
   ├─ UNSUBSCRIBE→ window.client.unsubscribe()
   └─ CONNECT    → skip (zaten bağlı)

3. Frame'ler arası bekleme:
   delay = timestamp[i+1] - timestamp[i]  (orijinal zamanlama)
```

**`SERVER_MOCK` modu** (RECEIVED frame'lerini enjekte eder):

```
Her frame için rawPayload → window.client.ws.onmessage()
Sayfanın STOMP istemcisi mesajı gerçek sunucudan gelmiş gibi işler.
Canlı sunucu bağlantısı gerekmez.
```

---

### 2. `stomp-parser.js` — STOMP Protokol Parser

Ham WebSocket payload'larını yapılandırılmış STOMP frame nesnelerine dönüştürür.

**Parse akışı:**
```
rawPayload (string)
  ↓ split('\u0000')        ← NULL byte = frame sınırı
  ↓ leading \n strip       ← heartbeat temizleme
  ↓ split('\n\n')          ← header / body ayrımı
  ↓ header satırlarını parse ("KEY:VALUE\n")
  ↓
{ command, destination, headers, body, rawPayload }
```

`buildStompFrame(command, headers, body)` → tersine işlem; editlenmiş payload'ı raw STOMP string'e çevirir ve `rawPayload` güncellemesi için kullanılır.

---

### 3. `db.js` — Veri Katmanı (Dexie.js / IndexedDB)

**IndexedDB Şeması:**

```
sessions:  ++id | name | startTime | endTime | frameCount | tabUrl | tabTitle | status
frames:    ++id | sessionId | timestamp | direction | stompCommand | destination
                | headers(JSON) | body(string) | rawPayload(string)
```

**API:**

| Fonksiyon | Açıklama |
|---|---|
| `createSession(tabUrl, tabTitle, name)` | Yeni session kaydı, `status: 'RECORDING'` |
| `stopSession(sessionId)` | `endTime` ve `frameCount` günceller, `status: 'STOPPED'` |
| `saveFrame(sessionId, direction, frame)` | Frame ekler, session `frameCount`'u artırır |
| `updateFrame(frameId, newBody)` | Payload'ı günceller, `rawPayload`'ı yeniden build eder |
| `getSessions()` | Tüm session'lar — id'ye göre ters sıralı (en yeni önce) |
| `getSessionFrames(sessionId)` | Session frame'leri — timestamp sıralı |
| `exportSessionJSON(sessionId)` | `{ version, exportedAt, session, frames }` JSON string |
| `importSessionJSON(jsonString)` | Dışarıdan JSON import, `status: 'IMPORTED'` |
| `deleteSession(sessionId)` | Session + tüm frame'leri transaction içinde siler |

---

### 4. `popup/` — Extension Popup UI

Extension ikonuna tıklandığında açılır. **Şu an aktif sekme** üzerinde çalışır.

**Özellikler:**
- **Kayıt Başlat / Durdur** — `START_RECORDING` / `STOP_RECORDING` mesajı gönderir
- **Canlı Feed** — `STOMP_FRAME_INTERCEPTED` broadcast'lerini dinler, son 20 frame'i gösterir
- **Session Replay** — Dropdown'dan session + mod (CLIENT / SERVER_MOCK) seçilir, replay başlatılır
  - `REPLAY_COMPLETE` mesajı geldiğinde sonuç alert'i gösterilir
  - Popup kapatılıp açılsa bile replay state'i background'dan sorgulanır
- **Export JSON** — Seçili session'ı `.json` dosyası olarak indirir
- **Dashboard'u Aç** — Options Page olarak dashboard'u açar

---

### 5. `dashboard/` — Gelişmiş Analiz & Replay Arayüzü

Chrome Options Page olarak açılır (`chrome-extension://xxx/dashboard/dashboard.html`).

#### Session Listesi (Sol Sidebar)
- Tüm kayıtlı session'lar kart olarak listelenir (id, isim, frame sayısı, zaman)
- Karta tıklamak frame tablosunu yükler
- **+ Import** butonu ile dışarıdan `.json` session yüklenebilir
- **Delete** butonu aktif session'ı siler

#### Frame Tablosu (Orta Alan)

| Sütun | Açıklama |
|---|---|
| ☐ | Checkbox — frame seçimi (Replay Selected için) |
| # | Sıra numarası (filtrelenmiş listedeki konum) |
| Time | Frame timestamp'i (saat:dakika:saniye) |
| Dir | `SENT` / `RECEIVED` badge |
| Command | `SUBSCRIBE`, `SEND`, `MESSAGE`, vb. |
| Destination | `/topic/...` veya `/app/...` |
| Size | Body boyutu (byte) |

**Filtre** — Sadece `destination` alanına göre filtreler (gerçek zamanlı).

**Select All checkbox** (header'da) — görüntülenen tüm frame'leri seçer/kaldırır; `indeterminate` durumunu da destekler.

**Replay Selected** — Seçili frame'leri orijinal zamanlama ile sırayla replay eder:
```
1. Seçili frame'leri timestamp'e göre sırala
2. Hedef sekmeyi belirle (session'ın tabUrl origin'ine göre)
3. Her frame için:
   a. delay = timestamp[i] - timestamp[i-1]  (ms)
   b. setTimeout(delay)
   c. REPLAY_SINGLE_FRAME → background
   d. Buton: "⏳ Replaying 2/5…"
4. Tamamlandığında alert göster
```

#### Frame Inspector (Sağ Panel)
- Seçili frame'in tüm detaylarını gösterir
- **JSON Editor** — Payload'ı interaktif olarak düzenler
- **💾 Save** — Editlenmiş payload'ı IndexedDB'ye yazar
- **► Replay Frame** — Tek frame replay; hedef sekme session URL'inin origin'ine göre seçilir

---

### 6. `components/json-editor.js`

Inspector panel'inde STOMP frame payload'larını düzenlemek için kullanılan bileşen. Syntax highlighting ve JSON validasyon sağlar.

---

## Subscription Deduplication — Ghost Sub Önleme

Üst üste yapılan replay'lerde aynı destination'a birden fazla SUBSCRIBE gönderilmesi **hayalet subscription (ghost sub)** sorununa yol açar — sunucu aynı destination'a birden fazla mesaj göndermeye başlar.

Bunu önlemek için `window.__stompReplaySubs` takip objesi kullanılır:

```js
// Sayfa belleğinde yaşar, sayfa refresh'e kadar korunur
window.__stompReplaySubs = {
  '/topic/messages':       'sub-3',
  '/topic/system-status':  'sub-4'
}
```

**SUBSCRIBE replay akışı:**
```
__stompReplaySubs[destination] dolu mu?
  ├─ Evet → SKIP  (ghost sub engellenmiş) ✅
  └─ Hayır → window.client.subscribe(destination)
             subId (string) döner
             __stompReplaySubs[destination] = subId
```

**UNSUBSCRIBE replay akışı:**
```
__stompReplaySubs[destination] dolu mu?
  ├─ Hayır → SKIP
  └─ Evet → window.client.unsubscribe(subId)
            delete __stompReplaySubs[destination]
```

**Bootstrap (her CLIENT mode replay başında çalışır):**
```js
window.__stompReplaySubs = Object.assign(
  {},
  knownSubsObj,              // background'un WS intercept'ten bildiği sub'lar
  window.__stompReplaySubs || {}  // sayfa tarafındaki mevcut state — önceliklidir
);
```

> **Neden merge?** Sayfa yenilenmemişse önceki replay'den kalan `__stompReplaySubs` daha güncel bilgi içerir. `Object.assign` sırası sayesinde page state her zaman background verisini override eder.

---

## Dosya Yapısı

```
stomp-interceptor-main/
├── ARCHITECTURE.md                ← Bu dosya
├── chrome-extension/
│   ├── manifest.json              # Extension tanımı, permissions, options_page
│   ├── background.js              # Service worker: kayıt motoru, replay engine
│   ├── stomp-parser.js            # STOMP protokol parse ve build
│   ├── db.js                      # Dexie.js IndexedDB katmanı
│   ├── popup/
│   │   ├── popup.html             # Extension popup
│   │   ├── popup.js               # Popup mantığı
│   │   └── popup.css
│   ├── dashboard/
│   │   ├── dashboard.html         # Options page / gelişmiş dashboard
│   │   ├── dashboard.js           # Session/frame/replay mantığı
│   │   └── dashboard.css
│   ├── components/
│   │   ├── json-editor.js         # İnteraktif JSON editörü bileşeni
│   │   └── json-editor.css
│   └── lib/
│       └── dexie.min.js           # IndexedDB wrapper (vendored, no CDN)
└── backend/
    └── src/main/
        ├── java/.../              # Spring Boot STOMP broker
        └── resources/static/
            ├── index.html         # Test sayfası
            ├── js/app.js          # Test sayfası mantığı (SimpleStompClient kullanır)
            ├── js/stomp-client.js # Saf JS STOMP 1.2 implementasyonu
            └── css/style.css
```
