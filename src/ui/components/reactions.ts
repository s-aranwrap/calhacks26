import type { Reaction } from '@/core/types';

/** Emoji reactions offered after completing an adventure. */
export const REACTION_META: Record<Reaction, { emoji: string; label: string }> = {
  loved: { emoji: '🤩', label: 'Loved it' },
  fun: { emoji: '😄', label: 'Fun' },
  calm: { emoji: '😌', label: 'Calming' },
  okay: { emoji: '😐', label: 'Okay' },
  meh: { emoji: '😕', label: 'Not for me' },
};
