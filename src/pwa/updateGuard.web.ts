import { useLayoutEffect } from 'react';

const blockers = new Set<symbol>();
export function updatesBlocked() { return blockers.size > 0; }
export function holdUpdate() {
  const id = Symbol('update-blocker'); blockers.add(id);
  return () => { blockers.delete(id); };
}

// Every sheet owns its unsaved buffer, including extraction review. Also guard
// playback and asynchronous foreground work that may not have a sheet.
export function useUpdateGuard(blocked = true) {
  useLayoutEffect(() => {
    if (!blocked) return;
    return holdUpdate();
  }, [blocked]);
}
