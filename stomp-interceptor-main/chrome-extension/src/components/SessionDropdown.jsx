import React from 'react';

/**
 * SessionDropdown — Dropdown for selecting a recorded session
 * Displays session list with id, name, frame count, and time
 */
export default function SessionDropdown({ sessions, value, onChange }) {
  if (sessions.length === 0) {
    return (
      <select disabled>
        <option value="">No recorded sessions</option>
      </select>
    );
  }

  return (
    <select id="sessionSelect" value={value} onChange={e => onChange(e.target.value)}>
      {sessions.map(s => {
        const dateStr = new Date(s.startTime).toLocaleTimeString();
        return (
          <option key={s.id} value={s.id}>
            #{s.id} - {s.name} ({s.frameCount || 0} frames - {dateStr})
          </option>
        );
      })}
    </select>
  );
}
