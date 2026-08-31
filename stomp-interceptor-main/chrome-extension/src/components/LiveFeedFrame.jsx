import React from 'react';

/**
 * LiveFeedFrame — Single frame entry in the live intercepted feed
 * Mirrors the original .frame-badge markup exactly
 */
export default function LiveFeedFrame({ direction, command, destination }) {
  const className = `frame-badge ${direction.toLowerCase()}`;

  return (
    <div className={className}>
      <span><strong>{direction}</strong> {command}</span>
      <span style={{ color: 'var(--text-muted)' }}>{destination || ''}</span>
    </div>
  );
}
