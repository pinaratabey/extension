import { parseStompFrames, unwrapSockJSPayload } from '../lib/stomp-parser';
import { createSession, stopSession, saveFrame, getSessionFrames } from '../lib/db';
import {
  ExtensionRequestMessage,
  ExtensionBroadcastEvent,
  FrameDirection,
  FrameRecord,
  ReplayMode
} from '../types';

interface ActiveRecording {
  sessionId: number;
  tabUrl: string;
  tabTitle: string;
}

// Map tabId -> { sessionId, tabUrl, tabTitle }
const activeRecordings = new Map<number, ActiveRecording>();

// Tracks whether a session replay is currently in progress
let isReplayInProgress = false;

// Tracks WebSocket connections per tab: Map<tabId, Map<requestId, url>>
// Used to filter only SockJS transport WebSocket connections (URLs ending with /websocket)
const tabWebSockets = new Map<number, Map<string, string>>();

/**
 * Returns true if the given WebSocket URL is a SockJS transport endpoint.
 * SockJS transport URLs follow the pattern: /endpoint/{server}/{session}/websocket
 * We also allow plain /websocket suffix to catch common configurations.
 */
function isSockJSTransportUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname.endsWith('/websocket');
  } catch {
    return url.includes('/websocket');
  }
}

// ─── Chrome Debugger Events ───────────────────────────────────────────────────

chrome.debugger.onEvent.addListener(async (source: chrome.debugger.Debuggee, method: string, params: any) => {
  const tabId = source.tabId;
  if (!tabId || !activeRecordings.has(tabId)) return;

  const recording = activeRecordings.get(tabId)!;
  const sessionId = recording.sessionId;

  // Track newly created WebSocket connections
  if (method === 'Network.webSocketCreated') {
    const { requestId, url } = params;
    if (!tabWebSockets.has(tabId)) tabWebSockets.set(tabId, new Map());
    tabWebSockets.get(tabId)!.set(requestId, url || '');

    if (isSockJSTransportUrl(url || '')) {
      console.log(`[STOMP Interceptor] SockJS transport WebSocket detected: ${url} (requestId: ${requestId})`);
    } else {
      console.log(`[STOMP Interceptor] WebSocket opened (not SockJS transport, will be ignored): ${url}`);
    }
    return;
  }

  // Clean up closed/failed WebSocket connections
  if (method === 'Network.webSocketClosed' || method === 'Network.webSocketFrameError') {
    const { requestId } = params;
    tabWebSockets.get(tabId)?.delete(requestId);
    return;
  }

  if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
    const direction: FrameDirection = method === 'Network.webSocketFrameSent' ? 'SENT' : 'RECEIVED';
    const requestId: string = params?.requestId || '';
    const payloadData: string = params?.response?.payloadData || '';

    if (!payloadData) return;

    // Filter: only process frames from SockJS transport WebSocket connections
    const wsMap = tabWebSockets.get(tabId);
    if (wsMap && requestId) {
      const wsUrl = wsMap.get(requestId);
      // If we have URL info for this connection and it's not a SockJS transport, skip it
      if (wsUrl !== undefined && !isSockJSTransportUrl(wsUrl)) {
        return;
      }
    }

    // Unwrap SockJS framing: 'h'/'o' → skip, 'a[...]' → extract inner STOMP strings
    const stompPayloads = unwrapSockJSPayload(payloadData);

    for (const stompPayload of stompPayloads) {
      const stompFrames = parseStompFrames(stompPayload);

      for (const frame of stompFrames) {
        await saveFrame(sessionId, direction, frame);

        // Notify extension popups/dashboards of live intercepted frame
        broadcastMessage({
          type: 'STOMP_FRAME_INTERCEPTED',
          tabId,
          sessionId,
          direction,
          frame
        });
      }
    }
  }
});

// Handle Debugger Detached unexpectedly
chrome.debugger.onDetach.addListener(async (source: chrome.debugger.Debuggee, reason: string) => {
  const tabId = source.tabId;
  if (tabId && activeRecordings.has(tabId)) {
    const recording = activeRecordings.get(tabId)!;
    await stopSession(recording.sessionId);
    activeRecordings.delete(tabId);
    tabWebSockets.delete(tabId);

    broadcastMessage({
      type: 'RECORDING_STOPPED',
      tabId,
      reason: `Debugger detached: ${reason}`
    });
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────

// Communication with Popup and Dashboard UI
chrome.runtime.onMessage.addListener((message: ExtensionRequestMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err: any) => {
      sendResponse({ success: false, error: err instanceof Error ? err.message : String(err) });
    });
  return true; // Keep response channel open for async promise
});

async function handleMessage(message: ExtensionRequestMessage, sender: chrome.runtime.MessageSender): Promise<any> {
  switch (message.type) {
    case 'START_RECORDING': {
      const tabId = message.tabId;
      if (!tabId) throw new Error('No target tab specified');

      if (activeRecordings.has(tabId)) {
        return { success: true, isRecording: true, sessionId: activeRecordings.get(tabId)!.sessionId };
      }

      const tab = await chrome.tabs.get(tabId);
      const sessionId = await createSession(tab.url || '', tab.title || '', message.sessionName);

      // Attach debugger protocol and enable Network domain
      await chrome.debugger.attach({ tabId }, '1.3');
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

      activeRecordings.set(tabId, {
        sessionId,
        tabUrl: tab.url || '',
        tabTitle: tab.title || ''
      });

      return { success: true, isRecording: true, sessionId };
    }

    case 'STOP_RECORDING': {
      const tabId = message.tabId;
      if (!tabId || !activeRecordings.has(tabId)) {
        return { success: true, isRecording: false };
      }

      const recording = activeRecordings.get(tabId)!;
      await chrome.debugger.detach({ tabId });
      await stopSession(recording.sessionId);
      activeRecordings.delete(tabId);
      tabWebSockets.delete(tabId);

      return { success: true, isRecording: false, sessionId: recording.sessionId };
    }

    case 'GET_RECORDING_STATUS': {
      const tabId = message.tabId;
      const isRecording = activeRecordings.has(tabId);
      const recording = activeRecordings.get(tabId);
      return {
        success: true,
        isRecording,
        sessionId: recording ? recording.sessionId : null
      };
    }

    case 'GET_REPLAY_STATUS': {
      return { success: true, isReplayInProgress };
    }

    case 'REPLAY_SESSION': {
      const { tabId, sessionId, mode, delayMs = 500 } = message;
      if (!tabId || !sessionId) throw new Error('Tab ID and Session ID are required for replay');

      if (isReplayInProgress) {
        return { success: false, error: 'A replay is already in progress. Please wait for it to finish.' };
      }

      const frames = await getSessionFrames(sessionId);
      if (!frames || frames.length === 0) {
        throw new Error('No recorded frames found in this session');
      }

      isReplayInProgress = true;
      executeReplaySequence(tabId, frames, mode, delayMs)
        .finally(() => { isReplayInProgress = false; });
      return { success: true, frameCount: frames.length };
    }

    case 'REPLAY_SINGLE_FRAME': {
      const { tabId, frame } = message;
      if (!tabId || !frame) throw new Error('Tab ID and frame object are required for replay');

      const mode: ReplayMode = 'CLIENT';
      const result = await executeReplaySequence(tabId, [frame], mode, 0, true);
      return { success: true, ...result };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

// ─── Replay Engine ────────────────────────────────────────────────────────────

async function executeReplaySequence(
  tabId: number,
  frames: FrameRecord[],
  mode: ReplayMode = 'CLIENT',
  delayMs: number = 0,
  bypassFilter = false
): Promise<any> {
  if (bypassFilter && frames.length === 1) {
    const f = frames[0];
    console.log(`[STOMP Interceptor Replay] Replaying single frame (Command: ${f.stompCommand}, Direction: ${f.direction})`);
  } else {
    console.log(`[STOMP Interceptor Replay] Replaying session: ${frames.length} frames`);
  }

  const replayableFrames = bypassFilter ? frames : frames.filter(f => {
    return f.direction === 'SENT' && ['SEND', 'SUBSCRIBE', 'UNSUBSCRIBE', 'CONNECT'].includes(f.stompCommand);
  });

  if (replayableFrames.length === 0) {
    broadcastMessage({
      type: 'REPLAY_COMPLETE',
      tabId,
      success: true,
      totalFrames: 0,
      replayedFrames: 0,
      skippedFrames: frames.length,
      message: 'No SENT frames to replay in this session'
    });
    return;
  }

  try {
    let replayedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < replayableFrames.length; i++) {
      const frame = replayableFrames[i];
      let frameSuccess = false;
      let frameError: string | null = null;

      // Sadece SENT frame'ler replay edilir. RECEIVED frame'ler (sunucudan gelen) atlanır.
      if (frame.direction !== 'SENT') {
        broadcastMessage({
          type: 'REPLAY_FRAME_STATUS',
          tabId,
          frameIndex: i,
          totalFrames: replayableFrames.length,
          success: false,
          error: 'RECEIVED frames cannot be replayed (server-side only)',
          frame: { stompCommand: frame.stompCommand, destination: frame.destination, direction: frame.direction }
        });
        continue;
      }

      try {
        const rawFrame = frame.rawPayload || buildStompFrameFromRecord(frame);
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: (rawStompFrame: string) => {
            const win = window as any;

            // Öncelik: hook tarafından yakalanan canlı SockJS WebSocket
            const ws: WebSocket | undefined = win.__stompInterceptorWS;
            if (ws && ws.readyState === 1 /* OPEN */) {
              // SockJS istemci→sunucu formatı: ["STOMP_FRAME"]  (başında 'a' YOK)
              const payload = JSON.stringify([rawStompFrame]);
              ws.send(payload);
              console.log('[STOMP Interceptor Replay] ✅ Sent via SockJS WS:', rawStompFrame.substring(0, 80));
              return { ok: true };
            }

            // Fallback: yüksek seviyeli STOMP istemcisi (window.client / window.stompClient)
            const client = win.client || win.stompClient;
            if (client && typeof client.send === 'function') {
              console.warn('[STOMP Interceptor Replay] __stompInterceptorWS bulunamadı, window.client fallback deneniyor.');
              return { ok: false, reason: 'WS hook not found. Page may need to be refreshed for the hook to capture the connection.' };
            }

            console.error('[STOMP Interceptor Replay] ❌ Aktif SockJS WebSocket bulunamadı. Sayfayı yenileyip tekrar deneyin.');
            return { ok: false, reason: 'No active SockJS WebSocket found. Please refresh the page so the hook can capture the connection.' };
          },
          args: [rawFrame]
        });

        const result = results?.[0]?.result as { ok: boolean; reason?: string } | undefined;
        if (result?.ok) {
          frameSuccess = true;
          replayedCount++;
        } else {
          frameError = result?.reason || 'Unknown replay error';
          errorCount++;
        }
      } catch (err: any) {
        frameError = err.message;
        errorCount++;
        console.warn(`[Replay] Frame #${i + 1} failed:`, err);
      }

      broadcastMessage({
        type: 'REPLAY_FRAME_STATUS',
        tabId,
        frameIndex: i,
        totalFrames: replayableFrames.length,
        success: frameSuccess,
        error: frameError,
        frame: {
          stompCommand: frame.stompCommand,
          destination: frame.destination,
          direction: frame.direction
        }
      });

      if (i < replayableFrames.length - 1) {
        const currentTimestamp = replayableFrames[i].timestamp;
        const nextTimestamp = replayableFrames[i + 1].timestamp;
        const timestampDelta = nextTimestamp - currentTimestamp;

        if (timestampDelta > 0) {
          await new Promise(resolve => setTimeout(resolve, timestampDelta));
        }
      }
    }

    broadcastMessage({
      type: 'REPLAY_COMPLETE',
      tabId,
      success: errorCount === 0,
      totalFrames: replayableFrames.length,
      replayedFrames: replayedCount,
      errorCount,
      message: errorCount === 0
        ? `Successfully replayed ${replayedCount} frames`
        : `Replayed ${replayedCount}/${replayableFrames.length} frames (${errorCount} errors)`
    });

  } catch (err: any) {
    broadcastMessage({
      type: 'REPLAY_COMPLETE',
      tabId,
      success: false,
      error: err.message,
      totalFrames: replayableFrames.length,
      replayedFrames: 0
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildStompFrameFromRecord(frame: FrameRecord): string {
  let frameStr = (frame.stompCommand || 'MESSAGE') + '\n';
  const headers = frame.headers || {};
  for (const [key, val] of Object.entries(headers)) {
    frameStr += `${key}:${val}\n`;
  }
  frameStr += '\n';
  if (frame.body) {
    frameStr += frame.body;
  }
  frameStr += '\u0000';
  return frameStr;
}

function broadcastMessage(msg: ExtensionBroadcastEvent): void {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Ignore if no listener is active
  });
}
