import { parseStompFrames } from './stomp-parser.js';
import { createSession, stopSession, saveFrame, getSessionFrames } from './db.js';

// Map tabId -> { sessionId, tabUrl, tabTitle }
const activeRecordings = new Map();

// Tracks whether a session replay is currently in progress //*
let isReplayInProgress = false; //*

// Tracks currently active STOMP subscriptions per tab, derived from intercepted WS frames //*
// Map<tabId, Map<destination, subId>> //*
const activeTabSubscriptions = new Map(); //*

// Listen to Chrome Debugger Events
chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;
  if (!tabId || !activeRecordings.has(tabId)) return;

  const recording = activeRecordings.get(tabId);
  const sessionId = recording.sessionId;

  if (method === 'Network.webSocketFrameSent' || method === 'Network.webSocketFrameReceived') {
    const direction = method === 'Network.webSocketFrameSent' ? 'SENT' : 'RECEIVED';
    const payloadData = params.response ? params.response.payloadData : '';

    if (!payloadData) return;

    // Parse STOMP frames (skip raw heartbeats if needed or log them)
    const stompFrames = parseStompFrames(payloadData);

    for (const frame of stompFrames) {
      await saveFrame(sessionId, direction, frame);

      // Track SUBSCRIBE / UNSUBSCRIBE state from intercepted WS traffic //*
      // This is the ground-truth source for bootstrap — independent of window.client internals //*
      if (direction === 'SENT') { //*
        if (!activeTabSubscriptions.has(tabId)) activeTabSubscriptions.set(tabId, new Map()); //*
        const tabSubs = activeTabSubscriptions.get(tabId); //*
        if (frame.command === 'SUBSCRIBE' && frame.destination) { //*
          const subId = frame.headers?.id || frame.headers?.['id'] || `sub-tracked-${Date.now()}`; //*
          tabSubs.set(frame.destination, subId); //*
        } else if (frame.command === 'UNSUBSCRIBE' && frame.destination) { //*
          tabSubs.delete(frame.destination); //*
        } //*
      } //*

      // Notify extension popups/dashboards of live intercepted frame
      chrome.runtime.sendMessage({
        type: 'STOMP_FRAME_INTERCEPTED',
        tabId,
        sessionId,
        direction,
        frame
      }).catch(() => {
        // Ignore error if no popup or dashboard is currently open
      });
    }
  }
});

// Handle Debugger Detached unexpectedly (e.g. standard DevTools opened)
chrome.debugger.onDetach.addListener(async (source, reason) => {
  const tabId = source.tabId;
  if (tabId && activeRecordings.has(tabId)) {
    const recording = activeRecordings.get(tabId);
    await stopSession(recording.sessionId);
    activeRecordings.delete(tabId);

    chrome.runtime.sendMessage({
      type: 'RECORDING_STOPPED',
      tabId,
      reason: `Debugger detached: ${reason}`
    }).catch(() => { });
  }
});

// Communication with Popup and Dashboard UI
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    sendResponse({ success: false, error: err.message });
  });
  return true; // Keep response channel open for async promise
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'START_RECORDING': {
      const tabId = message.tabId;
      if (!tabId) throw new Error('No target tab specified');

      if (activeRecordings.has(tabId)) {
        return { success: true, isRecording: true, sessionId: activeRecordings.get(tabId).sessionId };
      }

      const tab = await chrome.tabs.get(tabId);
      const sessionId = await createSession(tab.url, tab.title, message.sessionName);

      // Attach debugger protocol
      await chrome.debugger.attach({ tabId }, "1.3");
      await chrome.debugger.sendCommand({ tabId }, "Network.enable");

      activeRecordings.set(tabId, {
        sessionId,
        tabUrl: tab.url,
        tabTitle: tab.title
      });

      return { success: true, isRecording: true, sessionId };
    }

    case 'STOP_RECORDING': {
      const tabId = message.tabId;
      if (!tabId || !activeRecordings.has(tabId)) {
        return { success: true, isRecording: false };
      }

      const recording = activeRecordings.get(tabId);
      await chrome.debugger.detach({ tabId });
      await stopSession(recording.sessionId);
      activeRecordings.delete(tabId);

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

    case 'GET_REPLAY_STATUS': { //*
      return { success: true, isReplayInProgress }; //*
    } //*

    case 'REPLAY_SESSION': {
      const { tabId, sessionId, mode, delayMs = 500 } = message;
      if (!tabId || !sessionId) throw new Error('Tab ID and Session ID are required for replay');

      if (isReplayInProgress) { //*
        return { success: false, error: 'A replay is already in progress. Please wait for it to finish.' }; //*
      } //*

      const frames = await getSessionFrames(sessionId);
      if (!frames || frames.length === 0) {
        throw new Error('No recorded frames found in this session');
      }

      isReplayInProgress = true; //*
      // Execute Replay Sequence (fire-and-forget, progress is reported via messages)
      executeReplaySequence(tabId, frames, mode, delayMs)
        .finally(() => { isReplayInProgress = false; }); //*
      return { success: true, frameCount: frames.length };
    }

    case 'REPLAY_SINGLE_FRAME': {
      const { tabId, frame } = message;
      if (!tabId || !frame) throw new Error('Tab ID and frame object are required for replay');

      const mode = message.mode || (frame.direction === 'RECEIVED' ? 'SERVER_MOCK' : 'CLIENT');
      // Bypass mode filter for single frame replay — user explicitly chose this frame
      const result = await executeReplaySequence(tabId, [frame], mode, 0, true); //*
      return { success: true, ...result };
    }

    default:
      return { success: false, error: 'Unknown message type' };
  }
}

/**
 * Replay engine: Replays STOMP frames to active tab
 * Mode 'CLIENT': Sends recorded SENT frames back to server using page STOMP client
 * Mode 'SERVER_MOCK': Injects recorded RECEIVED frames back into tab via DevTools Protocol
 *
 * Sends progress notifications:
 *   REPLAY_FRAME_STATUS  — after each frame is replayed
 *   REPLAY_COMPLETE      — when the entire sequence finishes
 */
async function executeReplaySequence(tabId, frames, mode, delayMs, bypassFilter = false) { //*

  // Unified clean log for the engineer testing the tank system
  if (bypassFilter && frames.length === 1) { //*
    const f = frames[0]; //*
    console.log(`[STOMP Interceptor Replay] Replaying single frame (Command: ${f.stompCommand}, Direction: ${f.direction}, Mode: ${mode})`); //* //*
  } else { //*
    console.log(`[STOMP Interceptor Replay] Replaying session: ${frames.length} frames (Mode: ${mode})`); //* //*
  } //*

  // Filter frames relevant to the chosen mode.
  // bypassFilter=true is used for single-frame replay (user explicitly selected the frame) //*
  const replayableFrames = bypassFilter ? frames : frames.filter(f => { //*
    if (mode === 'SERVER_MOCK') return f.direction === 'RECEIVED' && f.stompCommand !== 'CONNECTED';
    if (mode === 'CLIENT') return f.direction === 'SENT' && ['SEND', 'SUBSCRIBE', 'UNSUBSCRIBE', 'CONNECT'].includes(f.stompCommand);
    return false;
  }); //*

  if (replayableFrames.length === 0) {
    broadcastMessage({
      type: 'REPLAY_COMPLETE',
      tabId,
      success: true,
      totalFrames: 0,
      replayedFrames: 0,
      skippedFrames: frames.length,
      message: `No ${mode === 'SERVER_MOCK' ? 'RECEIVED' : 'SENT'} frames to replay in this session`
    });
    return;
  }

  try {

    // CLIENT mode: bootstrap __stompReplaySubs from background's activeTabSubscriptions map. //*
    // This is the ground-truth source — built from intercepted WebSocket SUBSCRIBE/UNSUBSCRIBE //*
    // frames, so it works regardless of how window.client stores subscriptions internally. //*
    if (mode === 'CLIENT') { //*
      const knownSubs = activeTabSubscriptions.get(tabId) || new Map(); //*
      const knownSubsObj = Object.fromEntries(knownSubs); //*
      console.log('[STOMP Interceptor Replay] Bootstrap: injecting', knownSubs.size, 'known subscription(s) from WS intercept:', knownSubsObj); //*
      await chrome.scripting.executeScript({ //*
        target: { tabId }, //*
        world: 'MAIN', //*
        func: (subsObj) => { //*
          // Seed __stompReplaySubs with ground-truth data from background //*
          window.__stompReplaySubs = subsObj; //*
          console.log('[STOMP Interceptor Replay] Bootstrap complete. Tracked subs:', JSON.stringify(window.__stompReplaySubs)); //*
        }, //*
        args: [knownSubsObj] //*
      }).catch((err) => { //*
        console.warn('[STOMP Interceptor Replay] Bootstrap inject failed:', err); //*
      }); //*
    } //*

    let replayedCount = 0;
    let errorCount = 0;


    for (let i = 0; i < replayableFrames.length; i++) {
      const frame = replayableFrames[i];
      let frameSuccess = false;
      let frameError = null;

      if (mode === 'SERVER_MOCK') {
        // Inject the recorded server frame directly into the page's STOMP client
        // by manually triggering ws.onmessage — this is the only way to actually
        // deliver the payload to the page without a live server connection.
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (rawPayload) => {
              // Diagnostic: check each step
              if (!window.client) {
                console.error('[STOMP Interceptor Replay] ❌ window.client is null/undefined.' +
                  ' → Reload the test page (Ctrl+Shift+R) and restart Spring Boot.');
                return false;
              }
              if (!window.client.ws) {
                console.error('[STOMP Interceptor Replay] ❌ window.client.ws is null.' +
                  ' → Click "Connect" on the test page first, then retry replay.');
                return false;
              }
              if (!window.client.ws.onmessage) {
                console.error('[STOMP Interceptor Replay] ❌ window.client.ws.onmessage is not set.' +
                  ' → The WebSocket connection is not fully initialized.');
                return false;
              }
              // All good — inject the frame
              const event = new MessageEvent('message', { data: rawPayload });
              window.client.ws.onmessage(event);
              console.log('[STOMP Interceptor Replay] ✅ SERVER_MOCK frame injected:', rawPayload.substring(0, 80));
              return true;
            },
            args: [frame.rawPayload || buildStompFrameFromRecord(frame)]
          });
          frameSuccess = true;
          replayedCount++;
        } catch (err) {
          frameError = err.message;
          errorCount++;
          console.warn(`[Replay] SERVER_MOCK frame #${i + 1} failed:`, err);
        }
      } else if (mode === 'CLIENT') {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: (command, destination, headersJson, payloadStr) => {
              if (!window.client) {
                console.warn('[STOMP Interceptor Replay] window.client bulunamadı. Bağlantı aktif mi?');
                return false;
              }
              const headers = JSON.parse(headersJson);

              // Replay subscription state tracker //*
              if (!window.__stompReplaySubs) window.__stompReplaySubs = {}; //*

              if (command === 'SEND') {
                window.client.send(destination, headers, payloadStr);
              } else if (command === 'SUBSCRIBE') {
                if (window.__stompReplaySubs[destination]) {
                  // Already subscribed to this destination - skip //*
                  console.log('[STOMP Interceptor Replay] SUBSCRIBE skipped (already subscribed):', destination); //*
                  return 'SKIPPED'; //*
                }
                const sub = window.client.subscribe(destination, () => { }); //*
                // Use sub.id if available; fall back to destination as a truthy sentinel //*
                // (some custom STOMP clients return undefined id) //*
                window.__stompReplaySubs[destination] = sub?.id || destination; //*
                console.log('[STOMP Interceptor Replay] SUBSCRIBE completed:', destination, '→ id:', sub?.id ?? '(no id, using destination as key)'); //*
              } else if (command === 'UNSUBSCRIBE') {
                if (!window.__stompReplaySubs || !window.__stompReplaySubs[destination]) {
                  // Not subscribed to this destination - skip //*
                  console.log('[STOMP Interceptor Replay] UNSUBSCRIBE skipped (not subscribed):', destination); //*
                  return 'SKIPPED'; //*
                }
                window.client.unsubscribe(window.__stompReplaySubs[destination]); //*
                console.log('[STOMP Interceptor Replay] UNSUBSCRIBE completed:', destination, '→ id:', window.__stompReplaySubs[destination]); //*
                delete window.__stompReplaySubs[destination]; //*
              } else if (command === 'CONNECT') {
                console.log('[STOMP Interceptor Replay] CONNECT frame skipped (already connected).');
              }
              return true;
            },
            args: [
              frame.stompCommand,
              frame.destination,
              JSON.stringify(frame.headers || {}),
              frame.body || ''
            ]
          });
          frameSuccess = true;
          replayedCount++;
        } catch (err) {
          frameError = err.message;
          errorCount++;
          console.warn(`[Replay] CLIENT frame #${i + 1} failed:`, err);
        }
      }

      // Broadcast per-frame progress
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

      // Real-time delay: wait exactly as long as the original recording did between frames //*
      if (i < replayableFrames.length - 1) { //*
        const currentTimestamp = replayableFrames[i].timestamp; //*
        const nextTimestamp = replayableFrames[i + 1].timestamp; //*
        const timestampDelta = nextTimestamp - currentTimestamp; //*
        // Use timestamp delta if valid, otherwise fall back to delayMs //*

        //const waitMs = (timestampDelta > 0 && timestampDelta < 60000) ? timestampDelta : delayMs; //*
        // bunu kullanmak sitersen aşağıyı waitMS ile değiştir deltayı.
        if (timestampDelta > 0) { //*
          await new Promise(resolve => setTimeout(resolve, timestampDelta)); //*
        } //*
      } //*
    }

    // Broadcast completion
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

  } catch (err) {
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


/**
 * Build a raw STOMP frame string from a stored frame record
 */
function buildStompFrameFromRecord(frame) {
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

/**
 * Broadcast a message to all extension contexts (popup, dashboard, etc.)
 */
function broadcastMessage(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Ignore if no listener is active
  });
}

