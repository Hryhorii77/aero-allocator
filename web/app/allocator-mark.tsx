/**
 * The same glyph the browser tab already carries (app/icon.svg), reused so
 * the wordmark has an owner instead of being type alone — deliberately this
 * app's own abstract mark, not an Aerodrome-derived one: this is an
 * unofficial third-party desk and shouldn't dress like the protocol.
 */
export function AllocatorMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[0.85em] w-[0.85em] shrink-0 text-sky-400">
      <path d="M6 20 L10 20 L14 7 L10 7 Z" fill="currentColor" />
      <path d="M12 20 L16 20 L19 9 L15 9 Z" fill="currentColor" />
      <path d="M15 9 L19 9 L22 2 Z" fill="currentColor" />
    </svg>
  );
}
