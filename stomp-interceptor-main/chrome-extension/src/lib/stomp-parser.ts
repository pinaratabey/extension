import { StompFrame } from '../types';

/**
 * Unwraps SockJS framing protocol from a raw WebSocket payload.
 *
 * SockJS frame types:
 *   'o'        → open (connection established) — skip
 *   'h'        → heartbeat (ping) — skip
 *   'c[...]'   → close — skip
 *   'a["..."]' → array of messages — unwrap and return the inner strings
 *   plain text → passed through as-is (backward compat with direct STOMP / test backend)
 *
 * Returns an array of raw STOMP strings ready for parseStompFrames().
 */
export function unwrapSockJSPayload(data: string): string[] {
  if (!data || typeof data !== 'string') return [];

  const trimmed = data.trim();

  // SockJS heartbeat or open — nothing to parse
  if (trimmed === 'h' || trimmed === 'o') return [];

  // SockJS close frame: c[code, reason]
  if (trimmed.startsWith('c')) return [];

  // SockJS server→client array frame: a["STOMP_FRAME_1", ...]  (gelen frame'ler)
  if (trimmed.startsWith('a')) {
    try {
      const jsonPart = trimmed.slice(1); // remove leading 'a'
      const arr: string[] = JSON.parse(jsonPart);
      if (Array.isArray(arr)) {
        return arr.filter(s => typeof s === 'string' && s.trim().length > 0);
      }
    } catch {
      // Malformed SockJS frame — fall through to plain-text handling
    }
    return [];
  }

  // SockJS client→server array frame: ["STOMP_FRAME"] (no leading 'a')  (giden frame'ler)
  // Sunucu a["..."] kullanırken istemci ["..."] kullanır — SockJS protokol şartnamesine göre.
  if (trimmed.startsWith('[')) {
    try {
      const arr: string[] = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        return arr.filter(s => typeof s === 'string' && s.trim().length > 0);
      }
    } catch {
      // Malformed — fall through
    }
    return [];
  }

  // Plain STOMP text (direct WebSocket without SockJS wrapper, e.g. test backend)
  return [trimmed];
}

/**
 * Utility for parsing and serializing STOMP 1.0, 1.1, 1.2 protocol frames
 */
export function parseStompFrames(rawPayload: string): StompFrame[] {
  if (!rawPayload || typeof rawPayload !== 'string') return [];

  // STOMP frames are terminated by NULL byte (\u0000)
  // Heartbeats are single \n or \r\n characters
  const rawFrames = rawPayload.split('\u0000');
  const parsedList: StompFrame[] = [];

  for (let raw of rawFrames) {
    // Strip leading heartbeats/newlines
    raw = raw.replace(/^[\r\n]+/, '');
    if (!raw.trim()) continue;

    const dividerIndex = raw.indexOf('\n\n');
    const headerSection = dividerIndex !== -1 ? raw.substring(0, dividerIndex) : raw;
    const bodySection = dividerIndex !== -1 ? raw.substring(dividerIndex + 2) : '';

    const lines = headerSection.split('\n');
    const command = lines[0].trim();
    const headers: Record<string, string> = {};

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const colonIndex = line.indexOf(':');
      if (colonIndex !== -1) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }

    const destination = headers['destination'] || headers['subscription'] || '';

    parsedList.push({
      command,
      destination,
      headers,
      body: bodySection,
      rawPayload: raw + '\u0000'
    });
  }

  return parsedList;
}

export function buildStompFrame(command: string, headers: Record<string, string> = {}, body = ''): string {
  let frameStr = command + '\n';
  for (const [key, val] of Object.entries(headers)) {
    frameStr += `${key}:${val}\n`;
  }
  frameStr += '\n';
  if (body) {
    frameStr += body;
  }
  frameStr += '\u0000';
  return frameStr;
}
