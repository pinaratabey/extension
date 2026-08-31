import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getSessions,
  getSessionFrames,
  deleteSession,
  importSessionJSON,
  updateFrame,
} from '../lib/db';
import SessionCard from '../components/SessionCard';
import FrameTable from '../components/FrameTable';
import FrameInspector from '../components/FrameInspector';
import { Session, FrameRecord, ReplayMode } from '../types';

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [activeSessionObj, setActiveSessionObj] = useState<Session | null>(null);
  const [currentFrames, setCurrentFrames] = useState<FrameRecord[]>([]);
  const [selectedFrameId, setSelectedFrameId] = useState<number | null>(null);
  const [checkedFrameIds, setCheckedFrameIds] = useState<Set<number>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');
  const [replayBtnText, setReplayBtnText] = useState('▶ Replay Selected');
  const [isReplayingSelected, setIsReplayingSelected] = useState(false);

  const importFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    const sessionList = await getSessions();
    setSessions(sessionList);

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

  async function selectSession(sessionObj: Session) {
    if (sessionObj.id === undefined) return;
    setActiveSessionId(sessionObj.id);
    setActiveSessionObj(sessionObj);
    setSelectedFrameId(null);
    setCheckedFrameIds(new Set());

    const frames = await getSessionFrames(sessionObj.id);
    setCurrentFrames(frames);
  }

  const handleFrameSelect = useCallback((frame: FrameRecord) => {
    if (frame.id !== undefined) {
      setSelectedFrameId(frame.id);
    }
  }, []);

  const handleFrameCheck = useCallback((frameId: number, checked: boolean) => {
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

  const handleSelectAll = useCallback((checked: boolean, filteredFrames: FrameRecord[]) => {
    setCheckedFrameIds(prev => {
      const next = new Set(prev);
      filteredFrames.forEach(f => {
        if (f.id !== undefined) {
          if (checked) {
            next.add(f.id);
          } else {
            next.delete(f.id);
          }
        }
      });
      return next;
    });
  }, []);

  const selectedFrame = useMemo(() => {
    if (!selectedFrameId) return null;
    return currentFrames.find(f => f.id === selectedFrameId) || null;
  }, [selectedFrameId, currentFrames]);

  async function resolveTargetTab(): Promise<chrome.tabs.Tab | null> {
    const allTabs = await chrome.tabs.query({});
    const webTabs = allTabs.filter((t: chrome.tabs.Tab) =>
      t.url &&
      !t.url.startsWith('chrome-extension://') &&
      !t.url.startsWith('chrome://') &&
      !t.url.startsWith('about:')
    );

    let targetTab: chrome.tabs.Tab | null = null;
    if (activeSessionObj && activeSessionObj.tabUrl) {
      try {
        const sessionOrigin = new URL(activeSessionObj.tabUrl).origin;
        targetTab = webTabs.find((t: chrome.tabs.Tab) => {
          try { return t.url ? new URL(t.url).origin === sessionOrigin : false; }
          catch { return false; }
        }) || null;
      } catch (_) { }
    }
    if (!targetTab && webTabs.length > 0) targetTab = webTabs[0];
    return targetTab;
  }

  const handleSavePayload = useCallback(async (frameId: number, newBody: string) => {
    try {
      await updateFrame(frameId, newBody);
      alert('Payload saved successfully to database!');
      if (activeSessionId) {
        const frames = await getSessionFrames(activeSessionId);
        setCurrentFrames(frames);
      }
    } catch (err: any) {
      alert('Failed to save payload: ' + err.message);
    }
  }, [activeSessionId]);

  const handleReplayFrame = useCallback(async (updatedFrame: FrameRecord) => {
    const targetTab = await resolveTargetTab();
    if (!targetTab || !targetTab.id) {
      alert('No suitable web page tab found.\n\nOpen the test page (e.g. http://localhost:8080) in another tab, connect to STOMP, then retry.');
      return;
    }

    try {
      const mode: ReplayMode = updatedFrame.direction === 'RECEIVED' ? 'SERVER_MOCK' : 'CLIENT';
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
    } catch (err: any) {
      alert('Replay exception: ' + err.message);
    }
  }, [activeSessionObj]);

  const handleReplaySelected = useCallback(async () => {
    if (checkedFrameIds.size === 0) return;

    const targetTab = await resolveTargetTab();
    if (!targetTab || !targetTab.id) {
      alert('No suitable web page tab found.\n\nOpen the test page in another tab, connect to STOMP, then retry.');
      return;
    }

    const filter = searchFilter.trim().toLowerCase();
    const filtered = currentFrames.filter(f =>
      !filter || (f.destination && f.destination.toLowerCase().includes(filter))
    );
    const selected = filtered
      .filter(f => f.id !== undefined && checkedFrameIds.has(f.id))
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

      const mode: ReplayMode = f.direction === 'RECEIVED' ? 'SERVER_MOCK' : 'CLIENT';
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

  const handleImportClick = useCallback(() => {
    if (importFileInputRef.current) {
      importFileInputRef.current.click();
    }
  }, []);

  const handleImportFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const jsonContent = evt.target?.result as string;
        const newId = await importSessionJSON(jsonContent);
        alert(`Imported session successfully as #${newId}`);
        const sessionList = await getSessions();
        setSessions(sessionList);
        const importedSession = sessionList.find(s => s.id === newId);
        if (importedSession) {
          await selectSession(importedSession);
        }
      } catch (err: any) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);

    e.target.value = '';
  }, []);

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
