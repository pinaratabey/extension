import React from 'react';

/**
 * DirectionTag — SENT/RECEIVED direction badge
 * Reusable across FrameTable and FrameInspector
 */
export default function DirectionTag({ direction }) {
  return (
    <span className={`tag ${direction.toLowerCase()}`}>
      {direction}
    </span>
  );
}
