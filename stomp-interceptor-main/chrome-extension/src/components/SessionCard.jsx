import React from 'react';

/**
 * SessionCard — Single session entry in the sidebar
 * Mirrors original .session-card markup exactly
 */
export default function SessionCard({ session, isActive, onClick }) {
  const timeStr = new Date(session.startTime).toLocaleString();
  const className = `session-card ${isActive ? 'active' : ''}`;

  return (
    <div className={className} onClick={onClick}>
      <div className="session-name">
        #{session.id} {session.name}
      </div>
      <div className="session-meta">
        <span>{session.frameCount || 0} frames</span>
        <span>{timeStr}</span>
      </div>
    </div>
  );
}
