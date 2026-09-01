let client = null;
window.client = null; // Expose for Chrome Extension replay injection
const activeSubscriptions = new Map(); // topic -> subId

// DOM elements
const wsUrlInput = document.getElementById('wsUrl');
const btnConnect = document.getElementById('btnConnect');
const btnDisconnect = document.getElementById('btnDisconnect');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');

const subTopicInput = document.getElementById('subTopic');
const btnSubscribe = document.getElementById('btnSubscribe');
const subscriptionList = document.getElementById('subscriptionList');
const subCountEl = document.getElementById('subCount');

const pubDestinationInput = document.getElementById('pubDestination');
const pubPayloadInput = document.getElementById('pubPayload');
const btnSend = document.getElementById('btnSend');
const feedList = document.getElementById('feedList');
const btnClearLog = document.getElementById('btnClearLog');

const radarCanvas = document.getElementById('radarCanvas');
const radarTrackCountEl = document.getElementById('radarTrackCount');

// -------------------------------------------------------------------
// 📡 Interactive Tactical Radar Scope Canvas Engine
// -------------------------------------------------------------------
const radarBlips = [];
let sweepAngle = 0;
let radarAnimationId = null;

function initRadarCanvas() {
  if (!radarCanvas) return;
  const ctx = radarCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = radarCanvas.getBoundingClientRect();
  radarCanvas.width = rect.width * dpr;
  radarCanvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  function renderRadar() {
    const width = rect.width;
    const height = rect.height;
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(cx, cy) - 14;

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Radar Frame Background & Full-Frame Grid Mesh
    ctx.fillStyle = '#030508';
    ctx.fillRect(0, 0, width, height);

    // Full-frame subtle tactical grid
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.055)';
    ctx.lineWidth = 1;
    const gridSize = 16;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // 1b. Radar Circular Scope Center Area (Slight tactical glow)
    ctx.fillStyle = 'rgba(0, 230, 118, 0.015)';
    ctx.beginPath();
    ctx.arc(cx, cy, maxRadius, 0, Math.PI * 2);
    ctx.fill();

    // 2. Concentric Range Rings (50km, 100km, 150km)
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.32)';
    ctx.lineWidth = 1;
    [0.33, 0.66, 1.0].forEach((ratio, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxRadius * ratio, 0, Math.PI * 2);
      ctx.stroke();

      // Range text
      ctx.fillStyle = 'rgba(0, 230, 118, 0.75)';
      ctx.font = '9px monospace';
      ctx.fillText(`${(idx + 1) * 50}k`, cx + 4, cy - maxRadius * ratio + 10);
    });

    // 3. Crosshairs & Angle Lines
    ctx.beginPath();
    ctx.moveTo(cx - maxRadius, cy);
    ctx.lineTo(cx + maxRadius, cy);
    ctx.moveTo(cx, cy - maxRadius);
    ctx.lineTo(cx, cy + maxRadius);
    ctx.stroke();

    // Diagonal reference lines
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.12)';
    ctx.beginPath();
    const diag = maxRadius * 0.7071;
    ctx.moveTo(cx - diag, cy - diag);
    ctx.lineTo(cx + diag, cy + diag);
    ctx.moveTo(cx + diag, cy - diag);
    ctx.lineTo(cx - diag, cy + diag);
    ctx.stroke();

    // Compass Headings
    ctx.fillStyle = 'rgba(0, 230, 118, 0.85)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - maxRadius + 9);
    ctx.fillText('S', cx, cy + maxRadius - 3);
    ctx.fillText('E', cx + maxRadius - 6, cy + 3);
    ctx.fillText('W', cx - maxRadius + 6, cy + 3);

    // 4. Sweep Beam Animation
    sweepAngle = (sweepAngle + 0.035) % (Math.PI * 2);

    const sweepGradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxRadius);
    sweepGradient.addColorStop(0, 'rgba(0, 230, 118, 0.14)');
    sweepGradient.addColorStop(1, 'rgba(0, 230, 118, 0.01)');

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxRadius, sweepAngle - 0.4, sweepAngle);
    ctx.closePath();
    ctx.fillStyle = sweepGradient;
    ctx.fill();

    // Sweep leading line
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sweepAngle) * maxRadius, cy + Math.sin(sweepAngle) * maxRadius);
    ctx.strokeStyle = 'rgba(0, 255, 136, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // 5. Render Active Radar Targets (SIGNAL, TARGET, ALERT)
    const now = Date.now();
    let activeBlipCount = 0;

    for (let i = radarBlips.length - 1; i >= 0; i--) {
      const b = radarBlips[i];
      const age = now - b.timeAdded;
      if (age > 20000) {
        radarBlips.splice(i, 1);
        continue;
      }

      activeBlipCount++;
      const opacity = Math.max(0.2, 1 - (age / 20000));
      const bx = cx + (b.normalizedRange * maxRadius) * Math.cos(b.radAngle);
      const by = cy + (b.normalizedRange * maxRadius) * Math.sin(b.radAngle);

      if (b.type === 'alert') {
        // 🔴 ALERT: Flashing Threat Triangle & Fast Red Halo
        const pulse = 5 + (Math.sin(now * 0.015 + b.seed) * 3);
        ctx.beginPath();
        ctx.arc(bx, by, pulse + 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 42, 85, ${opacity * 0.3})`;
        ctx.fill();

        // Inverted Warning Triangle
        ctx.beginPath();
        ctx.moveTo(bx, by - 6);
        ctx.lineTo(bx + 6, by + 5);
        ctx.lineTo(bx - 6, by + 5);
        ctx.closePath();
        ctx.fillStyle = `rgba(255, 42, 85, ${opacity})`;
        ctx.fill();

        // Alert Tag
        ctx.font = 'bold 8px monospace';
        ctx.fillStyle = `rgba(255, 100, 130, ${opacity})`;
        ctx.textAlign = 'left';
        ctx.fillText(b.label, bx + 8, by - 1);
        ctx.fillStyle = `rgba(255, 160, 180, ${opacity * 0.8})`;
        ctx.fillText(`${b.rangeKm}km [ALERT]`, bx + 8, by + 8);

      } else if (b.type === 'target') {
        // 🟡 TARGET: Amber / Gold Lock-On Box & Cross Reticle
        const pulse = 4 + (Math.sin(now * 0.008 + b.seed) * 2);
        ctx.beginPath();
        ctx.rect(bx - pulse, by - pulse, pulse * 2, pulse * 2);
        ctx.strokeStyle = `rgba(255, 184, 0, ${opacity * 0.85})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Center Gold Core
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 184, 0, ${opacity})`;
        ctx.fill();

        // Target Tag
        ctx.font = '8px monospace';
        ctx.fillStyle = `rgba(255, 200, 50, ${opacity})`;
        ctx.textAlign = 'left';
        ctx.fillText(b.label, bx + 8, by - 1);
        ctx.fillStyle = `rgba(200, 180, 140, ${opacity * 0.8})`;
        ctx.fillText(`${b.rangeKm}km [TGT]`, bx + 8, by + 8);

      } else {
        // 🟢 SIGNAL: Neon Emerald Circular Beacon Pulse
        const pulse = 4 + (Math.sin(now * 0.008 + b.seed) * 2);
        ctx.beginPath();
        ctx.arc(bx, by, pulse + 2, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 230, 118, ${opacity * 0.25})`;
        ctx.fill();

        // Center Green Core
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 255, 136, ${opacity})`;
        ctx.fill();

        // Signal Tag
        ctx.font = '8px monospace';
        ctx.fillStyle = `rgba(0, 255, 136, ${opacity})`;
        ctx.textAlign = 'left';
        ctx.fillText(b.label, bx + 7, by - 1);
        ctx.fillStyle = `rgba(148, 163, 184, ${opacity * 0.8})`;
        ctx.fillText(`${b.rangeKm}km`, bx + 7, by + 8);
      }
    }

    if (radarTrackCountEl) {
      radarTrackCountEl.textContent = activeBlipCount > 0 ? `${activeBlipCount} CONTACTS ACTIVE` : 'SCANNING 360°';
    }

    radarAnimationId = requestAnimationFrame(renderRadar);
  }

  if (radarAnimationId) cancelAnimationFrame(radarAnimationId);
  renderRadar();
}

function addRadarBlip(trackId, azimuthDeg, rangeKm, type = 'signal') {
  // Convert Azimuth (0° North, clockwise) to Canvas Radians (0 East, counter-clockwise)
  const radAngle = ((azimuthDeg - 90) * Math.PI) / 180;
  const maxRange = 150;
  const normalizedRange = Math.min(1.0, Math.max(0.15, rangeKm / maxRange));

  // Find existing track or add new
  const existing = radarBlips.find(b => b.label === trackId);
  if (existing) {
    existing.radAngle = radAngle;
    existing.normalizedRange = normalizedRange;
    existing.rangeKm = Math.round(rangeKm);
    existing.timeAdded = Date.now();
    existing.type = type;
  } else {
    radarBlips.push({
      label: trackId,
      radAngle: radAngle,
      normalizedRange: normalizedRange,
      rangeKm: Math.round(rangeKm),
      type: type,
      timeAdded: Date.now(),
      seed: Math.random() * 10
    });
  }
}

// -------------------------------------------------------------------
// ⚙️ Presets Definition with /topic/... Destination Channels
// -------------------------------------------------------------------
const presetsData = {
  signal: {
    dest: '/topic/signal',
    payload: () => ({
      trackId: "SIG-" + Math.floor(1000 + Math.random() * 9000) + "-AIR",
      sensor: "AESA-3D-PRIMARY",
      azimuth: parseFloat((Math.random() * 360).toFixed(1)),
      elevation: parseFloat((Math.random() * 45).toFixed(1)),
      rangeKm: parseFloat((25 + Math.random() * 115).toFixed(1)),
      speedMach: parseFloat((0.8 + Math.random() * 1.6).toFixed(2)),
      heading: parseFloat((Math.random() * 360).toFixed(1)),
      confidence: 0.98,
      timestamp: new Date().toISOString()
    })
  },
  systemstatus: {
    dest: '/topic/systemstatus',
    payload: () => ({
      nodeId: "C2-TACTICAL-CORE-01",
      status: "OPERATIONAL",
      frequencyBand: "X_BAND_ACTIVE",
      transmitterPowerKw: 450.0,
      signalToNoiseRatio: 28.4,
      coolingUnit: "OPTIMAL",
      cpuLoadPercent: parseFloat((25 + Math.random() * 20).toFixed(1)),
      operationalReadiness: "100%"
    })
  },
  target: {
    dest: '/topic/target',
    payload: () => ({
      targetId: "TGT-FOE-" + Math.floor(10 + Math.random() * 90),
      iffStatus: "HOSTILE",
      classification: "FIGHTER_JET_5TH_GEN",
      lockStatus: "RADAR_LOCK_ENGAGED",
      azimuth: parseFloat((Math.random() * 360).toFixed(1)),
      rangeKm: parseFloat((35 + Math.random() * 90).toFixed(1)),
      altitudeFt: 34500,
      velocityKts: 1120,
      assignedBattery: "SAM-COMPLEX-ALPHA"
    })
  },
  alert: {
    dest: '/topic/alert',
    payload: () => ({
      alertId: "ALT-DEF-" + Math.floor(100 + Math.random() * 900),
      threatLevel: "CRITICAL",
      sector: "SECTOR-BRAVO-7",
      azimuth: parseFloat((Math.random() * 360).toFixed(1)),
      rangeKm: parseFloat((20 + Math.random() * 70).toFixed(1)),
      warningType: "UNIDENTIFIED_HIGH_SPEED_ENTRY",
      actionRequired: "SCRAMBLE_INTERCEPT_SQUADRON",
      countermeasure: "CHAFF_FLARE_ARMED",
      defenseStatus: "DEFCON_2"
    })
  }
};

function applyPreset(presetName) {
  const preset = presetsData[presetName];
  if (!preset) return;

  document.querySelectorAll('.preset-pills .pill').forEach(p => {
    p.classList.toggle('active', p.getAttribute('data-preset') === presetName || p.id === `pill-${presetName}`);
  });

  pubDestinationInput.value = preset.dest;
  const data = preset.payload();
  pubPayloadInput.value = JSON.stringify(data, null, 2);
}

// Expose globally
window.applyPreset = applyPreset;

// Bind direct click listeners to all preset pills
document.querySelectorAll('.preset-pills .pill').forEach(pill => {
  pill.addEventListener('click', () => {
    const presetName = pill.getAttribute('data-preset') || pill.id.replace('pill-', '');
    applyPreset(presetName);
  });
});

// -------------------------------------------------------------------
// ⚡ WebSocket STOMP Connection Lifecycle
// -------------------------------------------------------------------
btnConnect.addEventListener('click', async () => {
  const url = wsUrlInput.value.trim();
  if (!url) return;

  updateStatus('connecting', 'Connecting...');
  btnConnect.disabled = true;

  client = new SimpleStompClient(url);
  window.client = client; // Expose for Chrome Extension CLIENT replay mode

  client.onConnect = () => {
    updateStatus('connected', 'Connected');
    btnConnect.disabled = true;
    btnDisconnect.disabled = false;
    btnSubscribe.disabled = false;
    btnSend.disabled = false;

    // Auto-subscribe to the 4 requested tactical defense topics
    subscribeTopic('/topic/signal');
    subscribeTopic('/topic/systemstatus');
    subscribeTopic('/topic/target');
    subscribeTopic('/topic/alert');
  };

  client.onDisconnect = () => {
    updateStatus('disconnected', 'Not Connected');
    window.client = null;
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
    btnSubscribe.disabled = true;
    btnSend.disabled = true;
    activeSubscriptions.clear();
    renderSubscriptions();
  };

  client.onError = (err) => {
    console.error('Sensor Gateway Error:', err);
    updateStatus('disconnected', 'Connection Error');
    btnConnect.disabled = false;
    btnDisconnect.disabled = true;
  };

  // Only plot onto radar when a frame is ACTUALLY SENT or RECEIVED
  client.onFrameLog = (direction, command, headers, body, rawData) => {
    addLogItem(direction, command, headers, body);

    try {
      const parsed = JSON.parse(body);
      const dest = headers.destination || '';

      if (dest.includes('alert') || parsed.threatLevel || parsed.alertId) {
        const id = parsed.alertId || 'ALT-902';
        const az = parsed.azimuth !== undefined ? parsed.azimuth : (Math.random() * 360);
        const rng = parsed.rangeKm !== undefined ? parsed.rangeKm : (30 + Math.random() * 60);
        addRadarBlip(id, az, rng, 'alert');
      } else if (dest.includes('target') || parsed.targetId) {
        const id = parsed.targetId || 'TGT-FOE';
        const az = parsed.azimuth !== undefined ? parsed.azimuth : (Math.random() * 360);
        const rng = parsed.rangeKm !== undefined ? parsed.rangeKm : (40 + Math.random() * 80);
        addRadarBlip(id, az, rng, 'target');
      } else if (dest.includes('signal') || dest.includes('radar') || parsed.trackId) {
        const id = parsed.trackId || ('SIG-' + Math.floor(1000 + Math.random() * 9000));
        const az = parsed.azimuth !== undefined ? parsed.azimuth : (Math.random() * 360);
        const rng = parsed.rangeKm !== undefined ? parsed.rangeKm : (35 + Math.random() * 90);
        addRadarBlip(id, az, rng, 'signal');
      }
    } catch (_) { }
  };

  try {
    await client.connect();
  } catch (e) {
    console.error('Connection failure:', e);
    updateStatus('disconnected', 'Connection Failed');
    btnConnect.disabled = false;
  }
});

// Disconnect
btnDisconnect.addEventListener('click', () => {
  if (client) {
    client.disconnect();
  }
});

// Subscribe
btnSubscribe.addEventListener('click', () => {
  const topic = subTopicInput.value.trim();
  if (topic) {
    subscribeTopic(topic);
  }
});

function subscribeTopic(topic) {
  if (!client || !client.connected || activeSubscriptions.has(topic)) return;

  const subId = client.subscribe(topic, (body, headers) => {
    // Message received callback is logged via onFrameLog
  });

  activeSubscriptions.set(topic, subId);
  renderSubscriptions();
}

function unsubscribeTopic(topic) {
  if (!client || !activeSubscriptions.has(topic)) return;
  const subId = activeSubscriptions.get(topic);
  client.unsubscribe(subId);
  activeSubscriptions.delete(topic);
  renderSubscriptions();
}

function renderSubscriptions() {
  subscriptionList.innerHTML = '';
  if (subCountEl) {
    subCountEl.textContent = `${activeSubscriptions.size} Active`;
  }

  if (activeSubscriptions.size === 0) {
    subscriptionList.innerHTML = '<div style="font-size:0.75rem; color:var(--text-muted); font-family:var(--font-mono);">No active subscriptions</div>';
    return;
  }

  for (const [topic, subId] of activeSubscriptions.entries()) {
    const item = document.createElement('div');
    item.className = 'subscription-item';
    item.innerHTML = `
      <span class="subscription-topic">${escapeHtml(topic)}</span>
      <button class="btn btn-danger" style="padding:0.2rem 0.45rem; font-size:0.68rem;" onclick="unsubscribeTopic('${topic}')">Unsub</button>
    `;
    subscriptionList.appendChild(item);
  }
}

// Send Frame
btnSend.addEventListener('click', () => {
  if (!client || !client.connected) return;
  const dest = pubDestinationInput.value.trim();
  const payloadStr = pubPayloadInput.value.trim();

  if (!dest) return;

  let payload = payloadStr;
  try {
    payload = JSON.parse(payloadStr);
  } catch (e) {
    // Use raw string if not JSON
  }

  client.send(dest, {}, payload);
});

// Clear Log
btnClearLog.addEventListener('click', () => {
  feedList.innerHTML = '';
});

// Status UI
function updateStatus(state, label) {
  connectionStatus.className = 'status-badge ' + state;
  statusText.textContent = label;
}

// Add Log Item
function addLogItem(direction, command, headers, body) {
  // Clear placeholder if present
  if (feedList.querySelector('div[style*="text-align: center"]')) {
    feedList.innerHTML = '';
  }

  const item = document.createElement('div');
  item.className = `feed-item ${direction.toLowerCase()}`;

  const timeStr = new Date().toLocaleTimeString();
  const dest = headers.destination || headers.subscription || '';

  let bodyDisplay = body;
  try {
    const parsed = JSON.parse(body);
    bodyDisplay = JSON.stringify(parsed, null, 2);
  } catch (e) {
    // Keep raw
  }

  item.innerHTML = `
    <div class="feed-meta">
      <div style="display:flex; align-items:center; gap:0.5rem;">
        <span class="feed-tag ${direction.toLowerCase()}">${direction}</span>
        <strong style="color:var(--text-main); font-family:var(--font-mono);">${escapeHtml(command)}</strong>
        ${dest ? `<span style="color:#CBD5E1; font-family:var(--font-mono);">${escapeHtml(dest)}</span>` : ''}
      </div>
      <span>${timeStr}</span>
    </div>
    ${bodyDisplay ? `<pre class="feed-body">${escapeHtml(bodyDisplay)}</pre>` : ''}
  `;

  feedList.prepend(item);

  // Keep max 60 log items
  while (feedList.children.length > 60) {
    feedList.removeChild(feedList.lastChild);
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
}

// Start radar scope on page load
window.addEventListener('DOMContentLoaded', () => {
  initRadarCanvas();
});
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initRadarCanvas();
}
