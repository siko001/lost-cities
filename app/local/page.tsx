"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { QRCodeCanvas } from "qrcode.react";
import { GameBoard } from "@/components/GameBoard";
import { applyMove, createInitialGame } from "@/lib/game/engine";
import type { GameState, Player } from "@/lib/game/types";

type LocalRole = "host" | "guest";
type ConnectionStage = "idle" | "creating" | "waiting-signal" | "connecting" | "connected";
type SignalPayload = {
  kind: "offer" | "answer";
  description: RTCSessionDescriptionInit;
};
type LocalMessage = { type: "hello"; player: Player } | { type: "state"; state: GameState };

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect(source: HTMLCanvasElement): Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

const SIGNAL_PREFIX = "LEX1.";
const LOCAL_MODULES = ["base", "long-journey"];
const LOCAL_ROLE_KEY = "lost-expeditions-local-role";
const LOCAL_NAME_PREFIX = "lost-expeditions-local-name";
const LOCAL_DEVICE_KEY = "lost-expeditions-local-device-id";

function getDefaultLocalName(role: LocalRole) {
  return role === "host" ? "Neil" : "Wife";
}

function getStoredLocalName(role: LocalRole) {
  return window.localStorage.getItem(`${LOCAL_NAME_PREFIX}-${role}`) ?? getDefaultLocalName(role);
}

function rememberLocalIdentity(role: LocalRole, name: string) {
  const trimmedName = name.trim().slice(0, 24);
  window.localStorage.setItem(LOCAL_ROLE_KEY, role);
  window.localStorage.setItem(`${LOCAL_NAME_PREFIX}-${role}`, trimmedName);
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);

  return copied;
}

function createLocalPlayerId(role: LocalRole) {
  let deviceId = window.localStorage.getItem(LOCAL_DEVICE_KEY);
  if (!deviceId) {
    deviceId =
      globalThis.crypto?.randomUUID?.() ??
      `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(LOCAL_DEVICE_KEY, deviceId);
  }

  return `${role}-${deviceId}`;
}

function encodeSignal(payload: SignalPayload) {
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }

  return `${SIGNAL_PREFIX}${window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;
}

function decodeSignal(value: string): SignalPayload {
  const token = extractSignalToken(value);
  if (!token) {
    throw new Error("That does not look like a Lost Expeditions pairing token.");
  }

  const base64 = token
    .slice(SIGNAL_PREFIX.length)
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil((token.length - SIGNAL_PREFIX.length) / 4) * 4, "=");
  const binary = window.atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as SignalPayload;

  if ((payload.kind !== "offer" && payload.kind !== "answer") || !payload.description?.sdp) {
    throw new Error("Pairing token is missing WebRTC signal data.");
  }

  return payload;
}

function extractSignalToken(value: string) {
  const trimmed = value.trim();
  const directIndex = trimmed.indexOf(SIGNAL_PREFIX);
  if (directIndex >= 0) {
    const candidate = trimmed.slice(directIndex).split(/\s/)[0];
    return candidate.startsWith(SIGNAL_PREFIX) ? candidate : "";
  }

  return "";
}

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 4500);
    const finish = () => {
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", onIceGatheringStateChange);
      resolve();
    };
    const onIceGatheringStateChange = () => {
      if (peer.iceGatheringState === "complete") {
        finish();
      }
    };

    peer.addEventListener("icegatheringstatechange", onIceGatheringStateChange);
  });
}

export default function LocalPage() {
  const [role, setRole] = useState<LocalRole | null>(null);
  const [playerName, setPlayerName] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [stage, setStage] = useState<ConnectionStage>("idle");
  const [statusText, setStatusText] = useState("Choose who hosts the local table.");
  const [offerToken, setOfferToken] = useState("");
  const [answerToken, setAnswerToken] = useState("");
  const [remoteSignalText, setRemoteSignalText] = useState("");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [scannerMode, setScannerMode] = useState<"offer" | "answer" | null>(null);
  const [toastMessage, setToastMessage] = useState("");
  const [error, setError] = useState("");
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const roleRef = useRef<LocalRole | null>(null);
  const playerRef = useRef<Player | null>(null);
  const gameStateRef = useRef<GameState | null>(null);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    return () => {
      channelRef.current?.close();
      peerRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!toastMessage) return;

    const timeout = window.setTimeout(() => {
      setToastMessage("");
    }, 2600);

    return () => window.clearTimeout(timeout);
  }, [toastMessage]);

  useEffect(() => {
    const rememberedRole = window.localStorage.getItem(LOCAL_ROLE_KEY);
    if (rememberedRole !== "host" && rememberedRole !== "guest") return;

    const nextPlayerId = createLocalPlayerId(rememberedRole);
    setRole(rememberedRole);
    setPlayerId(nextPlayerId);
    setPlayerName(getStoredLocalName(rememberedRole));
    setStatusText(
      rememberedRole === "host"
        ? "Your host seat is remembered. Create a fresh local table to reconnect."
        : "Your join seat is remembered. Paste or scan the host offer to reconnect."
    );
  }, []);

  function chooseRole(nextRole: LocalRole) {
    const nextPlayerId = createLocalPlayerId(nextRole);
    setRole(nextRole);
    setPlayerId(nextPlayerId);
    setPlayerName(getStoredLocalName(nextRole));
    setStatusText(
      nextRole === "host"
        ? "Create a local table, then let the second phone scan your offer."
        : "Scan or paste the host offer, then show your answer back."
    );
    setError("");
  }

  function resetLocalTable() {
    const confirmed = window.confirm("Delete this local table and clear the remembered local seats?");
    if (!confirmed) return;

    channelRef.current?.close();
    peerRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
    roleRef.current = null;
    playerRef.current = null;
    gameStateRef.current = null;

    window.localStorage.removeItem(LOCAL_ROLE_KEY);
    window.localStorage.removeItem(`${LOCAL_NAME_PREFIX}-host`);
    window.localStorage.removeItem(`${LOCAL_NAME_PREFIX}-guest`);
    window.localStorage.removeItem(LOCAL_DEVICE_KEY);

    setRole(null);
    setPlayerName("");
    setPlayerId("");
    setStage("idle");
    setStatusText("Choose who hosts the local table.");
    setOfferToken("");
    setAnswerToken("");
    setRemoteSignalText("");
    setGameState(null);
    setScannerMode(null);
    setToastMessage("");
    setError("");
  }

  function createPeer() {
    const peer = new RTCPeerConnection({ iceServers: [] });
    peerRef.current = peer;

    peer.addEventListener("connectionstatechange", () => {
      setStatusText(`Connection: ${peer.connectionState}`);
      if (peer.connectionState === "connected") {
        setStage("connected");
      }
    });
    peer.addEventListener("iceconnectionstatechange", () => {
      if (peer.iceConnectionState === "failed" || peer.iceConnectionState === "disconnected") {
        setStatusText(`Local link ${peer.iceConnectionState}. Keep both phones on the same hotspot/Wi‑Fi.`);
      }
    });

    return peer;
  }

  function attachDataChannel(channel: RTCDataChannel) {
    channelRef.current = channel;
    channel.addEventListener("open", () => {
      setStage("connected");
      setStatusText("Connected. Local game link is open.");
      const currentRole = roleRef.current;
      const currentPlayer = playerRef.current;
      const currentState = gameStateRef.current;

      if (currentRole === "guest" && currentPlayer) {
        sendMessage({ type: "hello", player: currentPlayer });
      }

      if (currentRole === "host" && currentState) {
        sendMessage({ type: "state", state: currentState });
      }
    });
    channel.addEventListener("close", () => {
      setStatusText("Local link closed. Recreate the pairing to continue.");
    });
    channel.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;

      try {
        const message = JSON.parse(event.data) as LocalMessage;
        handleMessage(message);
      } catch {
        setError("Received a message this app could not read.");
      }
    });
  }

  function sendMessage(message: LocalMessage) {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return;
    channel.send(JSON.stringify(message));
  }

  function setAndBroadcastState(nextState: GameState, broadcast = true) {
    gameStateRef.current = nextState;
    setGameState(nextState);
    if (broadcast) {
      sendMessage({ type: "state", state: nextState });
    }
  }

  function handleMessage(message: LocalMessage) {
    if (message.type === "state") {
      setAndBroadcastState(message.state, false);
      return;
    }

    if (message.type !== "hello" || roleRef.current !== "host") {
      return;
    }

    const currentState = gameStateRef.current;
    if (!currentState) return;

    const nextState = currentState.players.some((player) => player.id === message.player.id)
      ? currentState
      : applyMove(currentState, { type: "join", player: message.player });
    setAndBroadcastState(nextState);
  }

  async function createHostOffer() {
    if (!playerName.trim() || !playerId) {
      setError("Enter your name first.");
      return;
    }

    try {
      setError("");
      setStage("creating");
      setStatusText("Creating local WebRTC offer...");
      const hostPlayer: Player = { id: playerId, name: playerName.trim().slice(0, 24) };
      playerRef.current = hostPlayer;
      rememberLocalIdentity("host", hostPlayer.name);

      let nextState = createInitialGame("LOCAL", LOCAL_MODULES);
      nextState = applyMove(nextState, { type: "join", player: hostPlayer });
      setAndBroadcastState(nextState, false);

      const peer = createPeer();
      const channel = peer.createDataChannel("lost-expeditions-local", { ordered: true });
      attachDataChannel(channel);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);

      if (!peer.localDescription) {
        throw new Error("Could not create a local offer.");
      }

      setOfferToken(encodeSignal({ kind: "offer", description: peer.localDescription.toJSON() }));
      setStage("waiting-signal");
      setStatusText("Offer ready. The second phone should scan this, then show you its answer.");
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : "Could not create local host offer.");
    }
  }

  async function createGuestAnswer(signalText = remoteSignalText) {
    if (!playerName.trim() || !playerId) {
      setError("Enter your name first.");
      return;
    }

    try {
      setError("");
      setStage("connecting");
      setStatusText("Reading host offer...");
      const offer = decodeSignal(signalText);
      if (offer.kind !== "offer") {
        throw new Error("This token is not a host offer.");
      }

      const guestPlayer: Player = { id: playerId, name: playerName.trim().slice(0, 24) };
      playerRef.current = guestPlayer;
      rememberLocalIdentity("guest", guestPlayer.name);

      const peer = createPeer();
      peer.addEventListener("datachannel", (event) => attachDataChannel(event.channel));
      await peer.setRemoteDescription(offer.description);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);

      if (!peer.localDescription) {
        throw new Error("Could not create a local answer.");
      }

      setAnswerToken(encodeSignal({ kind: "answer", description: peer.localDescription.toJSON() }));
      setStage("waiting-signal");
      setStatusText("Answer ready. Show this QR/token to the host phone.");
    } catch (err) {
      setStage("idle");
      setError(err instanceof Error ? err.message : "Could not create local guest answer.");
    }
  }

  async function acceptGuestAnswer(signalText = remoteSignalText) {
    try {
      setError("");
      const answer = decodeSignal(signalText);
      if (answer.kind !== "answer") {
        throw new Error("This token is not a guest answer.");
      }
      if (!peerRef.current) {
        throw new Error("Create a host offer before adding an answer.");
      }

      if (peerRef.current.signalingState === "stable") {
        setRemoteSignalText("");
        setStage(peerRef.current.connectionState === "connected" ? "connected" : "connecting");
        setStatusText("Answer is already applied. Waiting for the local data channel to open...");
        return;
      }

      if (peerRef.current.signalingState !== "have-local-offer") {
        throw new Error("This host offer is no longer waiting for an answer. Create a fresh local table and answer pair.");
      }

      setStage("connecting");
      setStatusText("Applying guest answer...");
      await peerRef.current.setRemoteDescription(answer.description);
      setRemoteSignalText("");
      setStatusText("Answer applied. Waiting for the data channel to open...");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept guest answer.");
    }
  }

  async function copyToken(token: string) {
    if (await copyTextToClipboard(token)) {
      setStatusText("Pairing token copied.");
      setToastMessage("Pairing token copied.");
      return;
    }

    setStatusText("Could not copy automatically. Select the token text manually.");
    setToastMessage("Could not copy. Select the token manually.");
  }

  async function commitLocalState(nextState: GameState) {
    const connected = channelRef.current?.readyState === "open";
    setAndBroadcastState(nextState, connected);
    if (!connected && nextState.players.length === 2) {
      setStatusText("Move saved locally, but the phones are not connected right now.");
    }
  }

  const connectionReady = stage === "connected";
  const showPairingSetup = !connectionReady || !gameState || !playerId;
  const canCreateHostOffer = role === "host" && stage === "idle";
  const canCreateGuestAnswer = role === "guest" && (stage === "idle" || stage === "waiting-signal");

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl p-4 md:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.35em] text-slate-400">Offline nearby mode</p>
          <h1 className="mt-1 text-3xl font-black md:text-5xl">Local Play</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-100">
            Home
          </Link>
          {(role || gameState || offerToken || answerToken || stage !== "idle") && (
            <button onClick={resetLocalTable} className="rounded-xl bg-red-200 px-4 py-2 font-bold text-slate-950">
              Delete local table
            </button>
          )}
        </div>
      </div>

      {showPairingSetup && (
        <>
          {/* <section className="mb-5 rounded-3xl border border-amber-200/20 bg-amber-950/30 p-4 text-amber-100 shadow-xl">
            <h2 className="text-xl font-black">How this works</h2>
            <p className="mt-2 text-sm text-amber-50/90">
              No Supabase and no internet are used after the app is installed. Put both phones on the same hotspot/Wi‑Fi,
              exchange the offer and answer tokens, then the game syncs phone-to-phone.
            </p>
          </section> */}

          <section className="mb-5 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-xl">
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Setup</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  onClick={() => chooseRole("host")}
                  disabled={stage !== "idle" && role !== "host"}
                  className={`rounded-2xl px-5 py-4 text-left font-bold shadow-xl transition ${
                    role === "host" ? "bg-amber-200 text-slate-950" : "bg-slate-800 text-slate-100"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Host on this phone
                  <span className="mt-1 block text-sm font-medium opacity-75">Creates the table and first token.</span>
                </button>
                <button
                  onClick={() => chooseRole("guest")}
                  disabled={stage !== "idle" && role !== "guest"}
                  className={`rounded-2xl px-5 py-4 text-left font-bold shadow-xl transition ${
                    role === "guest" ? "bg-amber-200 text-slate-950" : "bg-slate-800 text-slate-100"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Join this phone
                  <span className="mt-1 block text-sm font-medium opacity-75">Pastes or scans the host token.</span>
                </button>
              </div>

              {role && (
                <div className="mt-4">
                  <label className="text-sm font-bold text-slate-200" htmlFor="local-name">
                    Your name
                  </label>
                  <input
                    id="local-name"
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value)}
                    disabled={stage !== "idle"}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none disabled:opacity-60"
                    maxLength={24}
                  />
                  <p className="mt-2 text-xs text-slate-400">This seat and name are remembered on this phone.</p>
                </div>
              )}

              {canCreateHostOffer && (
                <button onClick={createHostOffer} className="mt-4 w-full rounded-xl bg-white px-5 py-3 font-bold text-slate-950">
                  Create Local Table
                </button>
              )}

              {role === "guest" && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <p className="text-sm font-bold text-slate-200">Host offer token</p>
                  <textarea
                    value={remoteSignalText}
                    onChange={(event) => setRemoteSignalText(event.target.value)}
                    placeholder="Paste the host offer token here..."
                    rows={4}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none"
                  />
                  <p className="mt-2 text-xs text-slate-400">Safari may not support QR scanning here. Copy/paste is the reliable path.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => setScannerMode("offer")}
                      className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-100"
                    >
                      Camera
                    </button>
                    <button
                      onClick={() => createGuestAnswer()}
                      disabled={!remoteSignalText.trim() || !canCreateGuestAnswer}
                      className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Create Answer
                    </button>
                  </div>
                </div>
              )}

              {role === "host" && offerToken && (
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                  <p className="text-sm font-bold text-slate-200">Guest answer token</p>
                  <textarea
                    value={remoteSignalText}
                    onChange={(event) => setRemoteSignalText(event.target.value)}
                    placeholder="Paste the guest answer token here..."
                    rows={4}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none"
                  />
                  <p className="mt-2 text-xs text-slate-400">Paste the fresh answer from the other phone, then accept it once.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      onClick={() => setScannerMode("answer")}
                      className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-100"
                    >
                      Try Camera Scan
                    </button>
                    <button
                      onClick={() => acceptGuestAnswer()}
                      disabled={!remoteSignalText.trim() || stage !== "waiting-signal"}
                      className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Accept Answer
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4">
                <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Status</p>
                <p className="mt-2 text-slate-200">{statusText}</p>
                {error && <p className="mt-3 rounded-xl bg-red-950 p-3 text-sm text-red-200">{error}</p>}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-xl">
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Pairing token</p>
              {role === "host" && offerToken && (
                <SignalCard
                  title="1. Second phone uses this offer"
                  token={offerToken}
                  buttonLabel="Copy Offer Token"
                  onCopy={() => copyToken(offerToken)}
                />
              )}
              {role === "guest" && answerToken && (
                <SignalCard
                  title="2. Host phone uses this answer"
                  token={answerToken}
                  buttonLabel="Copy Answer Token"
                  onCopy={() => copyToken(answerToken)}
                />
              )}
              {!offerToken && !answerToken && (
                <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-dashed border-white/10 bg-slate-950/40 p-8 text-center text-slate-400">
                  Choose host or join, then create the first pairing token.
                </div>
              )}
            </div>
          </section>
        </>
      )}

      {connectionReady && gameState && playerId && (
        <section>
          <p className="mb-3 rounded-2xl border border-emerald-200/20 bg-emerald-950/70 px-4 py-3 text-sm text-emerald-100 shadow-xl">
            Local link active. Pairing is hidden now; this is the normal game board.
          </p>
          <GameBoard state={gameState} playerId={playerId} onStateChange={commitLocalState} />
        </section>
      )}

      {scannerMode && (
        <SignalScanner
          mode={scannerMode}
          onClose={() => setScannerMode(null)}
          onResult={(token) => {
            setRemoteSignalText(token);
            setScannerMode(null);
            if (scannerMode === "offer") {
              void createGuestAnswer(token);
            } else {
              void acceptGuestAnswer(token);
            }
          }}
        />
      )}

      {toastMessage && (
        <div
          className="fixed bottom-4 left-4 right-4 z-[1300] mx-auto max-w-sm rounded-2xl border border-emerald-200/20 bg-slate-950/95 px-4 py-3 text-center text-sm font-bold text-emerald-100 shadow-2xl backdrop-blur"
          role="status"
          aria-live="polite"
          style={{ animation: "toast-rise 220ms ease-out" }}
        >
          {toastMessage}
        </div>
      )}

      <style jsx global>{`
        @keyframes toast-rise {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </main>
  );
}

function SignalCard({
  title,
  token,
  buttonLabel,
  onCopy,
}: {
  title: string;
  token: string;
  buttonLabel: string;
  onCopy: () => void;
}) {
  return (
    <div>
      <h2 className="text-xl font-black text-slate-100">{title}</h2>
      <div className="mt-4 overflow-hidden rounded-[2rem] border border-white/20 bg-gradient-to-br from-slate-800 via-slate-800 to-slate-950 p-4 text-slate-950 shadow-2xl">
        {/* <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-900/70">Lost Expeditions</p>
            <p className="text-sm font-bold text-slate-700">Nearby pairing pass</p>
          </div>
          <div className="rounded-2xl border-2 border-slate-950 bg-slate-950 px-4 py-2 text-xl font-black tracking-[0.2em] text-amber-100 shadow-lg">
            LEX
          </div>
        </div> */}
        <div className="rounded-[1.5rem] border border-slate-950/10 bg-slate-800 p-3 shadow-inner">
          <div className="flex justify-center rounded-[1.15rem] bg-white">
            <QRCodeCanvas value={token} size={320} level="L" includeMargin fgColor="#0f172a" bgColor="#ffffff" />
          </div>
        </div>
        {/* <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.25em] text-slate-500">
          <span>Offer/Answer</span>
          <span>Local Wi‑Fi</span>
        </div> */}
      </div>
      <button onClick={onCopy} className="mt-3 w-full rounded-xl bg-white px-4 py-3 font-bold text-slate-950">
        {buttonLabel}
      </button>
      <details className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
        <summary className="cursor-pointer select-none text-sm font-bold text-slate-200">Show raw token</summary>
        <textarea
          readOnly
          value={token}
          rows={5}
          className="mt-3 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 outline-none"
        />
      </details>
      <p className="mt-3 text-sm text-slate-400">
        If the QR is too dense for the camera, use Copy Token. If copying is blocked, open the raw token.
      </p>
    </div>
  );
}

function SignalScanner({
  mode,
  onClose,
  onResult,
}: {
  mode: "offer" | "answer";
  onClose: () => void;
  onResult: (token: string) => void;
}) {
  const [scannerError, setScannerError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function startScanner() {
      try {
        setScannerError("");
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          setScannerError("Camera scanning needs HTTPS, localhost, or an installed PWA. Paste the token instead.");
          return;
        }

        const BarcodeDetectorClass = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
        if (!BarcodeDetectorClass) {
          setScannerError("This browser cannot scan QR codes in this app yet. Copy/paste the token instead.");
          return;
        }

        const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const scanFrame = async () => {
          if (cancelled) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (!video || !canvas || video.readyState < 2) {
            frameRef.current = window.requestAnimationFrame(scanFrame);
            return;
          }

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext("2d");
          if (!context) {
            frameRef.current = window.requestAnimationFrame(scanFrame);
            return;
          }

          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const barcodes = await detector.detect(canvas);
          const token = extractSignalToken(barcodes[0]?.rawValue ?? "");
          if (token) {
            onResult(token);
            return;
          }

          frameRef.current = window.requestAnimationFrame(scanFrame);
        };

        frameRef.current = window.requestAnimationFrame(scanFrame);
      } catch (err) {
        setScannerError(err instanceof Error ? err.message : "Could not start the camera scanner.");
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Scan QR</p>
            <h2 className="mt-1 text-2xl font-black text-slate-100">
              {mode === "offer" ? "Scan host offer" : "Scan guest answer"}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-bold text-slate-100">
            Close
          </button>
        </div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video ref={videoRef} className="h-72 w-full object-cover" playsInline muted />
        </div>
        <canvas ref={canvasRef} className="hidden" />
        <p className="mt-3 text-sm text-slate-300">Point this camera at the other phone’s pairing QR.</p>
        {scannerError && <p className="mt-3 rounded-xl bg-red-950 p-3 text-sm text-red-200">{scannerError}</p>}
      </div>
    </div>
  );
}
