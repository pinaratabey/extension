/**
 * SockJS WebSocket Hook
 *
 * Bu script `document_start` aşamasında, sayfanın herhangi bir kodu çalışmadan önce
 * MAIN world'de enjekte edilir.
 *
 * Amacı: window.WebSocket'i override ederek `/websocket` URL'i ile açılan
 * SockJS transport bağlantısını `window.__stompInterceptorWS` değişkeninde saklamak.
 * Bu referans, replay sırasında doğrudan SockJS soketine yazmak için kullanılır.
 */
(function installSockJSHook(): void {
  // Birden fazla kez yüklenmesini önle
  if ((window as any).__stompInterceptorHookInstalled) return;
  (window as any).__stompInterceptorHookInstalled = true;

  const NativeWebSocket = window.WebSocket;

  function isSockJSTransport(url: string): boolean {
    try {
      return new URL(url).pathname.endsWith('/websocket');
    } catch {
      return url.includes('/websocket');
    }
  }

  // window.WebSocket'i override et
  class InterceptedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url as string, protocols);

      const urlStr = typeof url === 'string' ? url : url.toString();

      if (isSockJSTransport(urlStr)) {
        // Aktif SockJS transport soketini sakla (bağlantı yenilenirse üzerine yazar)
        (window as any).__stompInterceptorWS = this;
        console.debug('[STOMP Interceptor Hook] ✅ SockJS WebSocket captured for replay:', urlStr);
      }
    }
  }

  window.WebSocket = InterceptedWebSocket as unknown as typeof WebSocket;

  console.debug('[STOMP Interceptor Hook] WebSocket hook installed.');
})();
