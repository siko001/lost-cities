export function playRoomReadyChime() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.0001;
    gainNode.connect(audioContext.destination);

    const notes = [
      { frequency: 392.0, start: 0 },
      { frequency: 523.25, start: 0.14 },
      { frequency: 659.25, start: 0.28 },
    ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      oscillator.connect(gainNode);
      oscillator.start(audioContext.currentTime + note.start);
      oscillator.stop(audioContext.currentTime + note.start + 0.16);
    }

    gainNode.gain.linearRampToValueAtTime(0.05, audioContext.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + 0.7);

    window.setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 1100);
  } catch {
    // Best effort only.
  }
}

export function playTurnReminder() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.([120, 60, 120]);
  }

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.0001;
    gainNode.connect(audioContext.destination);

    const notes = [
      { frequency: 392.0, start: 0 },
      { frequency: 392.0, start: 0.16 },
    ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      oscillator.connect(gainNode);
      oscillator.start(audioContext.currentTime + note.start);
      oscillator.stop(audioContext.currentTime + note.start + 0.12);
    }

    gainNode.gain.linearRampToValueAtTime(0.03, audioContext.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + 0.35);

    window.setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 600);
  } catch {
    // Best effort only.
  }
}

export function playInvalidMoveBuzzer() {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.([35, 20, 35]);
  }

  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;

  try {
    const audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }

    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.0001;
    gainNode.connect(audioContext.destination);

    const notes = [
      { frequency: 220.0, start: 0 },
      { frequency: 196.0, start: 0.1 },
    ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "square";
      oscillator.frequency.value = note.frequency;
      oscillator.connect(gainNode);
      oscillator.start(audioContext.currentTime + note.start);
      oscillator.stop(audioContext.currentTime + note.start + 0.11);
    }

    gainNode.gain.linearRampToValueAtTime(0.012, audioContext.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + 0.28);

    window.setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 450);
  } catch {
    // Best effort only.
  }
}
