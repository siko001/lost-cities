const ROOM_HISTORY_KEY = "lost-expeditions:room-history";

function readRoomHistory(): string[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(ROOM_HISTORY_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((roomCode) => typeof roomCode === "string").map((roomCode) => roomCode.toUpperCase());
  } catch {
    return [];
  }
}

function writeRoomHistory(roomCodes: string[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ROOM_HISTORY_KEY, JSON.stringify(roomCodes));
  } catch {
    // ignore storage errors
  }
}

export function rememberRoomCode(roomCode: string) {
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  if (!normalizedRoomCode) return;

  const history = readRoomHistory();
  const nextHistory = [normalizedRoomCode, ...history.filter((entry) => entry !== normalizedRoomCode)].slice(0, 20);
  writeRoomHistory(nextHistory);
}

export function readRoomHistoryCodes() {
  return readRoomHistory();
}

export function forgetRoomCode(roomCode: string) {
  const normalizedRoomCode = roomCode.trim().toUpperCase();
  if (!normalizedRoomCode) return;

  const history = readRoomHistory();
  writeRoomHistory(history.filter((entry) => entry !== normalizedRoomCode));
}
