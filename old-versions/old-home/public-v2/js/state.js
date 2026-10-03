// Shared state: the logged-in user and a tiny event bus for live updates.

export const state = { me: null };

const listeners = new Map();
export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}
export function emit(type, data) {
  for (const fn of listeners.get(type) || []) fn(data);
}
