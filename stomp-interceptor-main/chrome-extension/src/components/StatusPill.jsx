import React from 'react';

/**
 * StatusPill — Recording status indicator
 * Displays "Idle" or "Recording" with pulsing animation
 */
export default function StatusPill({ isRecording }) {
  const className = `status-pill${isRecording ? ' recording' : ''}`;
  const text = isRecording ? 'Recording' : 'Idle';

  return <span className={className}>{text}</span>;
}
