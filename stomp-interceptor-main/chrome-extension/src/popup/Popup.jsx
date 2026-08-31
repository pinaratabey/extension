import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getSessions, exportSessionJSON } from '../lib/db.js';
import StatusPill from '../components/StatusPill';
import LiveFeedFrame from '../components/LiveFeedFrame';
import SessionDropdown from '../components/SessionDropdown';

const MAX_LIVE_FEED_FRAMES = 20;

export default function Popup() {
  const [currentTabId, setCurrentTabId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionName, setSessionName] = useState('');
  const [frameCount, setFrameCount] = useState(0);
  const [liveFeedFrames, setLiveFeedFrames] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [replayMode, setReplayMode] = useState('SERVER_MOCK');
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayBtnText, setReplayBtnText] = useState('► Replay Session');

  // Guard against double-click within same popup session
  const isReplayingRef = useRef(false);

  // ─── Initialization ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (cancelled) return;
      if (tab) {
        setCurrentTabId(tab.id);
        // Check recording status
        const response = await chrome.runtime.sendMessage({
          type: 'GET_RECORDING_STATUS',
          tabId: tab.id
        });
        if (!cancelled && response && response.isRecording) {
          setIsRecording(true);
          setCurrentSessionId(response.sessionId);
        }
      }

      // Load sessions dropdown
      const sessionList = await getSessions();
      if (!cancelled) {
        setSessions(sessionList);
        if (sessionList.length > 0) {
          setSelectedSessionId(String(sessionList[0].id));
        }
      }

      // Check replay status (persists even if popup was closed)
      const replayStatus = await chrome.runtime.sendMessage({ type: 'GET_REPLAY_STATUS' });
      if (!cancelled && replayStatus && replayStatus.isReplayInProgress) {
        setIsReplaying(true);
        setReplayBtnText('Replaying...');
        isReplayingRef.current = true;
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  // ─── Chrome Message Listener (with cleanup) ───────────────────
  useEffect(() => {
    function handleMessage(msg) {
      if (msg.type === 'STOMP_FRAME_INTERCEPTED' && msg.tabId === currentTabId) {
        // Add frame to live feed (prepend, max 20)
        setLiveFeedFrames(prev => {
          const newFrame = {
            id: Date.now() + Math.random(),
            direction: msg.direction,
            command: msg.frame.command,
            destination: msg.frame.destination
          };
          const updated = [newFrame, ...prev];
          return updated.slice(0, MAX_LIVE_FEED_FRAMES);
        });
        setFrameCount(prev => prev + 1);
      }

      if (msg.type === 'REPLAY_COMPLETE') {
        isReplayingRef.current = false;
        setIsReplaying(false);
        setReplayBtnText('► Replay Session');

        if (msg.success) {
          alert(`✅ Replay complete! ${msg.replayedFrames} frame(s) successfully replayed.`);
        } else {
          alert(`⚠️ Replay finished with errors.\nSuccessful: ${msg.replayedFrames}, Failed: ${msg.errorCount}`);
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [currentTabId]);

  // ─── Toggle Recording ─────────────────────────────────────────
  const handleToggleRecord = useCallback(async () => {
    if (!currentTabId) return;

    if (!isRecording) {
      const res = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId: currentTabId,
        sessionName: sessionName.trim()
      });

      if (res && res.success) {
        setIsRecording(true);
        setCurrentSessionId(res.sessionId);
        setLiveFeedFrames([]);
        setFrameCount(0);
      } else {
        alert('Failed to start recording: ' + (res ? res.error : 'Unknown error'));
      }
    } else {
      const res = await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING',
        tabId: currentTabId
      });

      if (res && res.success) {
        setIsRecording(false);
        setCurrentSessionId(null);
        // Reload sessions dropdown
        const sessionList = await getSessions();
        setSessions(sessionList);
        if (sessionList.length > 0) {
          setSelectedSessionId(String(sessionList[0].id));
        }
      }
    }
  }, [currentTabId, isRecording, sessionName]);

  // ─── Replay Session ───────────────────────────────────────────
  const handleReplay = useCallback(async () => {
    const sessionId = parseInt(selectedSessionId, 10);
    if (!sessionId || !currentTabId) return;
    if (isReplayingRef.current) return;

    isReplayingRef.current = true;
    setIsReplaying(true);
    setReplayBtnText('Replaying...');

    try {
      const res = await chrome.runtime.sendMessage({
        type: 'REPLAY_SESSION',
        tabId: currentTabId,
        sessionId: sessionId,
        mode: replayMode,
        delayMs: 400
      });

      if (!res || !res.success) {
        alert('Replay error: ' + (res ? res.error : 'Unknown error'));
        isReplayingRef.current = false;
        setIsReplaying(false);
        setReplayBtnText('► Replay Session');
      }
      // If success: wait for REPLAY_COMPLETE message
    } catch (err) {
      alert('Replay exception: ' + err.message);
      isReplayingRef.current = false;
      setIsReplaying(false);
      setReplayBtnText('► Replay Session');
    }
  }, [selectedSessionId, currentTabId, replayMode]);

  // ─── Export JSON ──────────────────────────────────────────────
  const handleExportJSON = useCallback(async () => {
    const sessionId = parseInt(selectedSessionId, 10);
    if (!sessionId) {
      alert('Please select a session to export');
      return;
    }

    try {
      const jsonStr = await exportSessionJSON(sessionId);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stomp-session-${sessionId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + err.message);
    }
  }, [selectedSessionId]);

  // ─── Open Dashboard ───────────────────────────────────────────
  const handleOpenDashboard = useCallback(() => {
    chrome.runtime.openOptionsPage();
  }, []);

  // ─── Render ───────────────────────────────────────────────────
  const hasLiveFeedFrames = liveFeedFrames.length > 0;

  return (
    <>
      {/* Header */}
      <div className="header">
        <div className="title">
          <div className="icon">S</div>
          <span>STOMP Interceptor</span>
        </div>
        <StatusPill isRecording={isRecording} />
      </div>

      {/* Recording Controls */}
      <div className="section">
        <div className="section-title">Recorder</div>
        {!isRecording && (
          <div className="form-group">
            <label htmlFor="sessionName">Session Name</label>
            <input
              type="text"
              id="sessionName"
              placeholder="e.g. User Chat Flow Test"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
            />
          </div>
        )}
        <button
          className={`btn ${isRecording ? 'btn-stop' : 'btn-rec'}`}
          onClick={handleToggleRecord}
        >
          {isRecording ? '■ Stop Recording' : '● Start Recording'}
        </button>
      </div>

      {/* Live Intercepted Stream Preview */}
      <div className="section">
        <div className="section-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Intercepted Frames</span>
          <span style={{ color: 'var(--accent-cyan)' }}>{frameCount}</span>
        </div>
        <div className="live-feed">
          {!hasLiveFeedFrames ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '0.5rem' }}>
              Ready to record STOMP frames
            </div>
          ) : (
            liveFeedFrames.map(frame => (
              <LiveFeedFrame
                key={frame.id}
                direction={frame.direction}
                command={frame.command}
                destination={frame.destination}
              />
            ))
          )}
        </div>
      </div>

      {/* Quick Replay Control */}
      <div className="section">
        <div className="section-title">Quick Replay</div>
        <div className="form-group">
          <label htmlFor="sessionSelect">Select Recorded Session</label>
          <SessionDropdown
            sessions={sessions}
            value={selectedSessionId}
            onChange={setSelectedSessionId}
          />
        </div>
        <div className="form-group">
          <label htmlFor="replayMode">Replay Strategy</label>
          <select
            id="replayMode"
            value={replayMode}
            onChange={e => setReplayMode(e.target.value)}
          >
            <option value="SERVER_MOCK">Mock Server -&gt; Client (DevTools Protocol)</option>
            <option value="CLIENT">Re-send Client -&gt; Server (WebSockets)</option>
          </select>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleReplay}
          disabled={isReplaying || sessions.length === 0}
        >
          {replayBtnText}
        </button>
      </div>

      {/* Footer Actions */}
      <div className="footer-actions">
        <button className="btn btn-secondary" onClick={handleOpenDashboard}>
          Full Dashboard
        </button>
        <button className="btn btn-secondary" onClick={handleExportJSON}>
          Export JSON
        </button>
      </div>
    </>
  );
}
