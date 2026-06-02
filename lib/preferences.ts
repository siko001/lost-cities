const SOUND_ENABLED_KEY = "lost-expeditions:sounds-enabled";
const SCROLL_ENABLED_KEY = "lost-expeditions:scroll-mode-enabled";

export function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;

  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "true";
}

export function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, String(value));
}

export { SCROLL_ENABLED_KEY, SOUND_ENABLED_KEY };
