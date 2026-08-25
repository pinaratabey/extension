import { parseStompFrames } from './stomp-parser.js';
import { createSession, stopSession, saveFrame, getSessionFrames } from './db.js';

// Map tabId -> { sessionId, tabUrl, tabTitle }
const activeRecordings = new Map();

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

    case 'REPLAY_SESSION': {
      const { tabId, sessionId, mode, delayMs = 500 } = message;
      if (!tabId || !sessionId) throw new Error('Tab ID and Session ID are required for replay');

      const frames = await getSessionFrames(sessionId);
      if (!frames || frames.length === 0) {
        throw new Error('No recorded frames found in this session');
      }

      // Execute Replay Sequence (fire-and-forget, progress is reported via messages)
      executeReplaySequence(tabId, frames, mode, delayMs);
      return { success: true, frameCount: frames.length };
    }

    case 'REPLAY_SINGLE_FRAME': {
      const { tabId, frame } = message;
      if (!tabId || !frame) throw new Error('Tab ID and frame object are required for replay');

      const mode = message.mode || (frame.direction === 'RECEIVED' ? 'SERVER_MOCK' : 'CLIENT');
      const result = await executeReplaySequence(tabId, [frame], mode, 0);
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
async function executeReplaySequence(tabId, frames, mode, delayMs) {

  // Filter frames relevant to the chosen mode
  const replayableFrames = frames.filter(f => {
    if (mode === 'SERVER_MOCK') return f.direction === 'RECEIVED' && f.stompCommand !== 'CONNECTED';
    if (mode === 'CLIENT') return f.direction === 'SENT' && f.stompCommand === 'SEND';
    return false;
  });

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
            func: (destination, headersJson, payloadStr) => {
              if (window.client && window.client.send) {
                const headers = JSON.parse(headersJson);
                window.client.send(destination, headers, payloadStr);
                console.log('[STOMP Interceptor Replay] Sent client frame to', destination);
                return true;
              } else {
                console.warn('[STOMP Interceptor Replay] window.client not found on target page. Is the STOMP connection active?');
                return false;
              }
            },
            args: [
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

      // Delay between replayed frames (skip delay after last frame)
      if (delayMs > 0 && i < replayableFrames.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
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

