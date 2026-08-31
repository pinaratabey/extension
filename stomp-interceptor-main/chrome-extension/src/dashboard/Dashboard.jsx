import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getSessions,
  getSessionFrames,
  deleteSession,
  importSessionJSON,
  updateFrame,
} from '../lib/db.js';
import SessionCard from '../components/SessionCard';
import FrameTable from '../components/FrameTable';
import FrameInspector from '../components/FrameInspector';

export default function Dashboard() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeSessionObj, setActiveSessionObj] = useState(null);
  const [currentFrames, setCurrentFrames] = useState([]);
  const [selectedFrameId, setSelectedFrameId] = useState(null);
  const [checkedFrameIds, setCheckedFrameIds] = useState(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [replayBtnText, setReplayBtnText] = useState('▶ Replay Selected');
  const [isReplayingSelected, setIsReplayingSelected] = useState(false);

  const importFileInputRef = useRef(null);

  // ─── Load Sessions on Mount ────────────────────────────────
  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    const sessionList = await getSessions();
    setSessions(sessionList);

    // Auto-select first session if none selected
    if (sessionList.length > 0 && !activeSessionId) {
      await selectSession(sessionList[0]);
    } else if (sessionList.length === 0) {
      setActiveSessionId(null);
      setActiveSessionObj(null);
      setCurrentFrames([]);
      setSelectedFrameId(null);
      setCheckedFrameIds(new Set());
    }
  }

  // ─── Select Session ────────────────────────────────────────
  async function selectSession(sessionObj) {
    setActiveSessionId(sessionObj.id);
    setActiveSessionObj(sessionObj);
    setSelectedFrameId(null);
    setCheckedFrameIds(new Set());

    const frames = await getSessionFrames(sessionObj.id);
    setCurrentFrames(frames);
  }

  // ─── Frame Selection ──────────────────────────────────────
  const handleFrameSelect = useCallback((frame) => {
    setSelectedFrameId(frame.id);
  }, []);

  const handleFrameCheck = useCallback((frameId, checked) => {
    setCheckedFrameIds(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(frameId);
      } else {
        next.delete(frameId);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((checked, filteredFrames) => {
    setCheckedFrameIds(prev => {
      const next = new Set(prev);
      filteredFrames.forEach(f => {
        if (checked) {
          next.add(f.id);
        } else {
          next.delete(f.id);
        }
      });
      return next;
    });
  }, []);

  // ─── Selected Frame Object ────────────────────────────────
  const selectedFrame = useMemo(() => {
    if (!selectedFrameId) return null;
    return currentFrames.find(f => f.id === selectedFrameId) || null;
  }, [selectedFrameId, currentFrames]);

  // ─── Resolve target tab for replay ────────────────────────
  async function resolveTargetTab() {
    const allTabs = await chrome.tabs.query({});
    const webTabs = allTabs.filter(t =>
      t.url &&
      !t.url.startsWith('chrome-extension://') &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('about:')
    );

    let targetTab = null;
    if (activeSessionObj && activeSessionObj.tabUrl) {
      try {
        const sessionOrigin = new URL(activeSessionObj.tabUrl).origin;
        targetTab = webTabs.find(t => {
          try { return new URL(t.url).origin === sessionOrigin; }
          catch { return false; }
        });
      } catch (_) { }
    }
    if (!targetTab) targetTab = webTabs[0];
    return targetTab;
  }

  // ─── Save Payload ─────────────────────────────────────────
  const handleSavePayload = useCallback(async (frameId, newBody) => {
    try {
      await updateFrame(frameId, newBody);
      alert('Payload saved successfully to database!');
      // Refresh frames
      if (activeSessionId) {
        const frames = await getSessionFrames(activeSessionId);
        setCurrentFrames(frames);
      }
    } catch (err) {
      alert('Failed to save payload: ' + err.message);
    }
  }, [activeSessionId]);

  // ─── Replay Single Frame ──────────────────────────────────
  const handleReplayFrame = useCallback(async (updatedFrame) => {
    const targetTab = await resolveTargetTab();
    if (!targetTab) {
      alert('No suitable web page tab found.\n\nOpen the test page (e.g. http://localhost:8080) in another tab, connect to STOMP, then retry.');
      return;
    }

    try {
      const mode = updatedFrame.direction === 'RECEIVED' ? 'SERVER_MOCK' : 'CLIENT';
      const res = await chrome.runtime.sendMessage({
        type: 'REPLAY_SINGLE_FRAME',
        tabId: targetTab.id,
        frame: updatedFrame,
        mode: mode
      });

      if (res && res.success) {
        alert(`Successfully replayed ${updatedFrame.stompCommand} frame to tab: ${targetTab.url}`);
      } else {
        alert('Replay failed: ' + (res ? res.error : 'Unknown error'));
      }
    } catch (err) {
      alert('Replay exception: ' + err.message);
    }
  }, [activeSessionObj]);

  // ─── Replay Selected Frames ───────────────────────────────
  const handleReplaySelected = useCallback(async () => {
    if (checkedFrameIds.size === 0) return;

    const targetTab = await resolveTargetTab();
    if (!targetTab) {
      alert('No suitable web page tab found.\n\nOpen the test page in another tab, connect to STOMP, then retry.');
      return;
    }

    // Collect selected frames sorted by original timestamp
    const filter = searchFilter.trim().toLowerCase();
    const filtered = currentFrames.filter(f =>
      !filter || (f.destination && f.destination.toLowerCase().includes(filter))
    );
    const selected = filtered
      .filter(f => checkedFrameIds.has(f.id))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (selected.length === 0) return;

    setIsReplayingSelected(true);
    setReplayBtnText(`⏳ Replaying 0/${selected.length}…`);

    let prevTimestamp = selected[0].timestamp;

    for (let i = 0; i < selected.length; i++) {
      const f = selected[i];
      const delay = i === 0 ? 0 : (f.timestamp - prevTimestamp);
      prevTimestamp = f.timestamp;

      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const mode = f.direction === 'RECEIVED' ? 'SERVER_MOCK' : 'CLIENT';
      try {
        await chrome.runtime.sendMessage({
          type: 'REPLAY_SINGLE_FRAME',
          tabId: targetTab.id,
          frame: f,
          mode: mode
        });
      } catch (err) {
        console.error('Replay error for frame', f.id, err);
      }

      setReplayBtnText(`⏳ Replaying ${i + 1}/${selected.length}…`);
    }

    setReplayBtnText('▶ Replay Selected');
    setIsReplayingSelected(false);
    alert(`Replayed ${selected.length} frame(s) with original timing.`);
  }, [checkedFrameIds, searchFilter, currentFrames, activeSessionObj]);

  // ─── Delete Session ───────────────────────────────────────
  const handleDeleteSession = useCallback(async () => {
    if (!activeSessionId) return;
    if (!confirm(`Are you sure you want to delete session #${activeSessionId}?`)) return;

    await deleteSession(activeSessionId);
    setActiveSessionId(null);
    setActiveSessionObj(null);
    setCurrentFrames([]);
    setSelectedFrameId(null);
    setCheckedFrameIds(new Set());
    await loadSessions();
  }, [activeSessionId]);

  // ─── Import Session ───────────────────────────────────────
  const handleImportClick = useCallback(() => {
    if (importFileInputRef.current) {
      importFileInputRef.current.click();
    }
  }, []);

  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const newId = await importSessionJSON(evt.target.result);
        alert(`Imported session successfully as #${newId}`);
        // Select the imported session
        const sessionList = await getSessions();
        setSessions(sessionList);
        const importedSession = sessionList.find(s => s.id === newId);
        if (importedSession) {
          await selectSession(importedSession);
        }
      } catch (err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);

    // Reset file input so same file can be re-imported
    e.target.value = '';
  }, []);

  // ─── Render ───────────────────────────────────────────────
  const noSessions = sessions.length === 0;

  return (
    <div className="dashboard-layout">

      {/* Sidebar: Recording Sessions */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">Recorded Sessions</div>
          <button
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
            onClick={handleImportClick}
          >
            + Import
          </button>
        </div>

        <div className="session-list">
          {noSessions ? (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem', fontSize: '0.85rem' }}>
              No recorded sessions in Dexie DB
            </div>
          ) : (
            sessions.map(s => (
              <SessionCard
                key={s.id}
                session={s}
                isActive={s.id === activeSessionId}
                onClick={() => selectSession(s)}
              />
            ))
          )}
        </div>
      </div>

      {/* Main View: STOMP Frame Feed */}
      <div className="main-view">
        <div className="top-bar">
          <div>
            <h2 style={{ fontSize: '1.1rem' }}>
              {activeSessionObj
                ? `#${activeSessionObj.id} - ${activeSessionObj.name}`
                : (noSessions ? 'No Sessions' : 'Select a session')}
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {activeSessionObj
                ? `Url: ${activeSessionObj.tabUrl || 'N/A'} | Frames: ${activeSessionObj.frameCount || 0}`
                : 'Inspect recorded STOMP frames'}
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              className="search-input"
              placeholder="Filter by destination..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <button
              className="btn btn-cyan"
              style={{ padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}
              disabled={checkedFrameIds.size === 0 || isReplayingSelected}
              onClick={handleReplaySelected}
            >
              {replayBtnText}
            </button>
            <button
              className="btn btn-red"
              style={{ padding: '0.5rem 0.8rem', fontSize: '0.8rem' }}
              onClick={handleDeleteSession}
            >
              Delete
            </button>
          </div>
        </div>

        <FrameTable
          frames={currentFrames}
          searchFilter={searchFilter}
          selectedFrameId={selectedFrameId}
          checkedFrameIds={checkedFrameIds}
          onFrameSelect={handleFrameSelect}
          onFrameCheck={handleFrameCheck}
          onSelectAll={handleSelectAll}
        />
      </div>

      {/* Inspector Panel: Frame Detail */}
      <FrameInspector
        frame={selectedFrame}
        onSavePayload={handleSavePayload}
        onReplayFrame={handleReplayFrame}
      />

      {/* Hidden file input for import */}
      <input
        type="file"
        ref={importFileInputRef}
        accept=".json"
        style={{ display: 'none' }}
        onChange={handleImportFile}
      />
    </div>
  );
}
