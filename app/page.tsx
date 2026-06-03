"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { createInitialGame } from "@/lib/game/engine";
import { forgetRoomCode, readRoomHistoryCodes, rememberRoomCode } from "@/lib/room-history";

type OngoingRoom = {
  roomCode: string;
  roundNumber: number;
  status: string;
  currentPlayerId: string | null;
  players: Array<{ id: string; name: string }>;
  totalScores: Record<string, number>;
  updatedAt: string;
};

const EMPTY_ROOM_TTL_MS = 2 * 60 * 1000;

function isRecentEmptyRoom(room: OngoingRoom) {
  if (room.players.length > 0) return false;

  const updatedAt = new Date(room.updatedAt).getTime();
  if (Number.isNaN(updatedAt)) return false;

  return Date.now() - updatedAt <= EMPTY_ROOM_TTL_MS;
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [showOngoingRooms, setShowOngoingRooms] = useState(false);
  const [ongoingRooms, setOngoingRooms] = useState<OngoingRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [deletingRoomCode, setDeletingRoomCode] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [myRoomCodes, setMyRoomCodes] = useState<string[]>([]);
  const [showMyRoomsOnly, setShowMyRoomsOnly] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const joinInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const scannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerStreamRef = useRef<MediaStream | null>(null);
  const scannerFrameRef = useRef<number | null>(null);

  async function createRoom() {
    setLoading(true);
    setError("");
    if (!supabase) {
      setLoading(false);
      setError("Supabase is not configured yet. You can still try the local demo.");
      return;
    }
    const roomCode = makeRoomCode();
    const state = createInitialGame(roomCode, ["base", "long-journey"]);
    const { error: insertError } = await supabase.from("games").insert({ room_code: roomCode, state });
    setLoading(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    rememberRoomCode(roomCode);
    setMyRoomCodes(readRoomHistoryCodes());
    router.push(`/room/${roomCode}`);
  }

  function joinRoom() {
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    if (!normalizedRoomCode) {
      setError("Enter a room code first.");
      return;
    }
    if (!isSupabaseConfigured || !supabase) {
      setError("Supabase is not configured yet.");
      return;
    }

    setLoading(true);
    setError("");
    void supabase
      .from("games")
      .select("room_code")
      .eq("room_code", normalizedRoomCode)
      .maybeSingle()
      .then(({ data, error: lookupError }) => {
        setLoading(false);

        if (lookupError) {
          setError(lookupError.message);
          return;
        }

        if (!data) {
          setError("Room not found.");
          return;
        }

        rememberRoomCode(normalizedRoomCode);
        setMyRoomCodes(readRoomHistoryCodes());
        router.push(`/room/${normalizedRoomCode}`);
      });
  }

  function openJoinForm() {
    setShowJoinForm(true);
  }

  function openScanner() {
    setScannerError("");
    setShowScanner(true);
  }

  const visibleRooms = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const rooms = showMyRoomsOnly
      ? ongoingRooms.filter((room) => myRoomCodes.includes(room.roomCode.toUpperCase()))
      : ongoingRooms;
    if (!term) return rooms;

    return rooms.filter((room) => {
      const playerText = room.players.map((player) => player.name).join(" ").toLowerCase();
      return (
        room.roomCode.toLowerCase().includes(term) ||
        playerText.includes(term) ||
        String(room.roundNumber).includes(term) ||
        room.status.toLowerCase().includes(term)
      );
    });
  }, [ongoingRooms, searchTerm, showMyRoomsOnly, myRoomCodes]);

  const activeRooms = visibleRooms.filter((room) => room.players.length > 0);
  const emptyRooms = visibleRooms.filter(isRecentEmptyRoom);
  const isLobbyFiltered = searchTerm.trim().length > 0 || showMyRoomsOnly;
  const lobbyRoomCount = activeRooms.length;
  const lobbyRoomLabel = isLobbyFiltered ? "matching room" : "active room";

  useEffect(() => {
    if (!showJoinForm) return;
    joinInputRef.current?.focus();
  }, [showJoinForm]);

  useEffect(() => {
    const syncRoomHistory = () => {
      setMyRoomCodes(readRoomHistoryCodes());
    };

    syncRoomHistory();
    window.addEventListener("storage", syncRoomHistory);

    return () => {
      window.removeEventListener("storage", syncRoomHistory);
    };
  }, []);

  useEffect(() => {
    if (!showScanner) return;

    let cancelled = false;

    async function startScanner() {
      try {
        setScannerError("");
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          setScannerError("Camera scanning needs a secure browser context. Use localhost or try the QR link another way.");
          return;
        }

        const BarcodeDetectorClass = (
          window as Window & {
            BarcodeDetector?: {
              new (options?: { formats?: string[] }): {
                detect(source: HTMLCanvasElement): Promise<Array<{ rawValue?: string }>>;
              };
            };
          }
        ).BarcodeDetector;
        if (!BarcodeDetectorClass) {
          setScannerError("This browser doesn’t support camera scanning. Use Copy link or Share instead.");
          return;
        }

        const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        scannerStreamRef.current = stream;
        if (scannerVideoRef.current) {
          scannerVideoRef.current.srcObject = stream;
          await scannerVideoRef.current.play().catch(() => {});
        }

        const scanFrame = async () => {
          if (cancelled) return;
          const video = scannerVideoRef.current;
          const canvas = scannerCanvasRef.current;
          if (!video || !canvas || video.readyState < 2) {
            scannerFrameRef.current = window.requestAnimationFrame(scanFrame);
            return;
          }

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext("2d");
          if (!context) {
            scannerFrameRef.current = window.requestAnimationFrame(scanFrame);
            return;
          }

          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const barcodes = await detector.detect(canvas);
          const qrValue = barcodes[0]?.rawValue;
          const room = extractRoomCode(qrValue);
          if (room) {
            stopScanner();
            router.push(`/room/${room}`);
            return;
          }

          scannerFrameRef.current = window.requestAnimationFrame(scanFrame);
        };

        scannerFrameRef.current = window.requestAnimationFrame(scanFrame);
      } catch (err) {
        setScannerError(err instanceof Error ? err.message : "Could not start the camera scanner.");
      }
    }

    void startScanner();

    return () => {
      cancelled = true;
    };
  }, [showScanner, router]);

  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client) {
      setOngoingRooms([]);
      return;
    }
    const supabaseClient = client;

    let cancelled = false;

    async function loadOngoingRooms() {
      setRoomsLoading(true);
      const { data, error: roomsError } = await supabaseClient
        .from("games")
        .select("room_code,state,updated_at")
        .order("updated_at", { ascending: false })
        .limit(12);

      if (cancelled) return;

      if (roomsError) {
        setOngoingRooms([]);
        setRoomsLoading(false);
        return;
      }

      const activeRooms = (data ?? [])
        .map((row) => ({
          roomCode: row.room_code as string,
          roundNumber: Number(row.state?.roundNumber ?? 1),
          status: String(row.state?.status ?? "waiting"),
          currentPlayerId: (row.state?.currentPlayerId as string | null | undefined) ?? null,
          players: Array.isArray(row.state?.players) ? row.state.players : [],
          totalScores: row.state?.totalScores ?? {},
          updatedAt: String(row.updated_at ?? ""),
        }))
        .filter((room) => room.status !== "finished");

      setOngoingRooms(activeRooms);
      setRoomsLoading(false);
    }

    void loadOngoingRooms();
    const interval = window.setInterval(() => {
      void loadOngoingRooms();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function deleteRoom(roomCodeToDelete: string) {
    const client = supabase;
    if (!isSupabaseConfigured || !client) return;

    setDeletingRoomCode(roomCodeToDelete);
    setError("");

    try {
      const { data: currentRoom, error: lookupError } = await client
        .from("games")
        .select("state")
        .eq("room_code", roomCodeToDelete)
        .maybeSingle();
      if (lookupError) {
        setError(lookupError.message);
        return;
      }

      const nextState = {
        ...(currentRoom?.state ?? {}),
        status: "finished",
        lastAction: "Room retired",
      };

      const { error: deleteError } = await client.from("games").update({ state: nextState }).eq("room_code", roomCodeToDelete);
      if (deleteError) {
        setError(deleteError.message);
        return;
      }

      setOngoingRooms((current) => current.filter((room) => room.roomCode !== roomCodeToDelete));
      forgetRoomCode(roomCodeToDelete);
      setMyRoomCodes(readRoomHistoryCodes());
    } finally {
      setDeletingRoomCode("");
    }
  }

  function stopScanner() {
    if (scannerFrameRef.current) {
      window.cancelAnimationFrame(scannerFrameRef.current);
      scannerFrameRef.current = null;
    }
    scannerStreamRef.current?.getTracks().forEach((track) => track.stop());
    scannerStreamRef.current = null;
    if (scannerVideoRef.current) {
      scannerVideoRef.current.srcObject = null;
    }
    setShowScanner(false);
  }

  function extractRoomCode(value: string | undefined) {
    if (!value) return "";

    const trimmed = value.trim();
    const match = trimmed.match(/\/room\/([A-Z0-9]+)/i);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }

    if (/^[A-Z0-9]{4,12}$/i.test(trimmed)) {
      return trimmed.toUpperCase();
    }

    return "";
  }

    return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <p className="mb-3 text-sm uppercase tracking-[0.4em] text-slate-400">Private card battle</p>
        <h1 className="text-5xl font-black">Lost Expeditions</h1>
        <p className="mt-4 text-lg text-slate-300">Create a private room, share the link, and play as guests.</p>
        {/* <p className="mt-3 rounded-xl border border-emerald-200/20 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-100">
          New: local play lets two nearby phones pair over the same hotspot/Wi‑Fi without Supabase or internet.
        </p> */}
        {!isSupabaseConfigured && (
          <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Supabase is not set up yet, so online rooms are disabled for now. The demo still works locally.
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/local" className="rounded-2xl bg-emerald-200 px-8 py-4 font-bold text-slate-950 shadow-xl">
          Play Offline Nearby
        </Link>
        {isSupabaseConfigured ? (
          <button onClick={openJoinForm} className="rounded-2xl bg-amber-200 px-8 py-4 font-bold text-slate-950 shadow-xl">
            Join Room
          </button>
        ) : (
          <Link href="/demo" className="rounded-2xl bg-amber-200 px-8 py-4 font-bold text-slate-950 shadow-xl">
            Try Demo
          </Link>
        )}
        <button onClick={createRoom} disabled={loading || !isSupabaseConfigured} className="rounded-2xl bg-white px-8 py-4 font-bold text-slate-950 shadow-xl disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? "Creating..." : isSupabaseConfigured ? "Create Room" : "Set Up Later"}
        </button>
      </div>

      {isSupabaseConfigured && showJoinForm && (
        <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-xl">
          <button
            type="button"
            onClick={() => setShowJoinForm(false)}
            aria-label="Close join room"
            title="Close"
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-slate-200 transition hover:bg-slate-700 hover:text-white"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Join existing room</p>
          <div className="mt-4 flex gap-3">
            <input
              ref={joinInputRef}
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  joinRoom();
                }
              }}
              placeholder="Room code"
              className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-left outline-none"
              autoCapitalize="characters"
              spellCheck={false}
            />
            <button
              onClick={joinRoom}
              disabled={loading || !roomCode.trim()}
              className="rounded-xl bg-white px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Checking..." : "Join"}
            </button>
          </div>
          <button onClick={openScanner} className="mt-3 w-full rounded-xl bg-slate-800 px-5 py-3 font-bold text-slate-100">
            Scan QR
          </button>
        </div>
      )}

      <div className="w-full max-w-2xl">
        <button
          type="button"
          onClick={() => setShowOngoingRooms((value) => !value)}
          className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-left shadow-lg transition hover:bg-slate-950/60"
        >
          <div>
            <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Ongoing rooms</p>
            <p className="mt-1 text-sm text-slate-300">
              {roomsLoading ? "Loading live rooms..." : `${lobbyRoomCount} ${lobbyRoomLabel}${lobbyRoomCount === 1 ? "" : "s"}`}
            </p>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-200">
            {showOngoingRooms ? "Hide" : "Open"}
          </span>
        </button>

        {showOngoingRooms && (
          <div className="mt-3 space-y-4 rounded-3xl border border-white/10 bg-slate-900/75 p-4 text-left shadow-xl">
            {!isSupabaseConfigured ? (
              <p className="text-slate-300">Connect Supabase to see online rooms here.</p>
            ) : (
              <>
                <div className="space-y-3">
                  <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Active rooms</p>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="flex items-center gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-slate-300">
                      <SearchIcon className="h-4 w-4 shrink-0 text-slate-500" />
                      <input
                        ref={searchInputRef}
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Search..."
                        className="min-w-0 w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
                      />
                      {searchTerm.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            setSearchTerm("");
                            searchInputRef.current?.focus();
                          }}
                          className="rounded-full bg-slate-800 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-200"
                        >
                          Clear
                        </button>
                      )}
                    </label>

                    <button
                      type="button"
                      onClick={() => setShowMyRoomsOnly((value) => !value)}
                      disabled={myRoomCodes.length === 0}
                      aria-pressed={showMyRoomsOnly}
                      className={`rounded-2xl border px-4 py-3 text-sm font-bold transition ${
                        showMyRoomsOnly
                          ? "border-emerald-200/30 bg-emerald-200 text-slate-950"
                          : "border-slate-800 bg-slate-950/70 text-slate-200"
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      My room only
                    </button>
                  </div>

                  {ongoingRooms.length === 0 ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-slate-300">
                      No active rooms right now.
                    </div>
                  ) : activeRooms.length > 0 ? (
                    activeRooms.map((room) => {
                      const totalScores = room.totalScores ?? {};
                      const currentPlayerName = room.players.find((player) => player.id === room.currentPlayerId)?.name;
                      const isMyRoom = myRoomCodes.includes(room.roomCode.toUpperCase());
                      return (
                        <div key={room.roomCode} className="group relative space-y-2">
                          <div className="w-full rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-left transition hover:border-amber-200/30 hover:bg-slate-950">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div>
                                <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
                                  Room -{" "}
                                  <button
                                    type="button"
                                    onClick={() => router.push(`/room/${room.roomCode}`)}
                                    className="font-bold text-slate-200 underline decoration-slate-500 decoration-dotted underline-offset-4 transition hover:text-amber-100"
                                  >
                                    {room.roomCode}
                                  </button>
                                </p>
                                <p className="mt-1 text-base font-black text-slate-100">Round {room.roundNumber}</p>
                                <p className="mt-1 text-sm text-slate-300">
                                  {room.status === "waiting"
                                    ? "Waiting for players"
                                    : room.status === "round-over"
                                      ? "Round paused"
                                      : currentPlayerName
                                        ? `Game in progress - ${currentPlayerName} turn`
                                    : "Game in progress"}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="rounded-2xl border border-white/10 bg-slate-900 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300">
                                  {room.players.length} player{room.players.length === 1 ? "" : "s"}
                                </div>
                                {isMyRoom && (
                                  <button
                                    type="button"
                                    onClick={() => deleteRoom(room.roomCode)}
                                    disabled={deletingRoomCode === room.roomCode}
                                    aria-label={`Delete room ${room.roomCode}`}
                                    title={`Delete room ${room.roomCode}`}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-200/40 text-slate-950/90 shadow-sm opacity-60 transition hover:bg-red-200/70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                                  >
                                    {deletingRoomCode === room.roomCode ? (
                                      <span className="text-xs font-black">...</span>
                                    ) : (
                                      <TrashIcon className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {room.players.map((player) => (
                                <div key={player.id} className="rounded-xl bg-slate-900/80 px-3 py-2">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold text-slate-100">{player.name}</span>
                                    <span className="text-lg font-black text-amber-100">{totalScores[player.id] ?? 0}</span>
                                  </div>
                                  </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 text-slate-300">
                      {searchTerm.trim() || showMyRoomsOnly ? "No rooms match your filter." : "No active rooms in the lobby yet."}
                    </div>
                  )}
                </div>

                {emptyRooms.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">Recently empty rooms</p>
                    {emptyRooms.map((room) => (
                      <div key={room.roomCode} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 text-left">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.35em] text-slate-400">
                              Room -{" "}
                              <button
                                type="button"
                                onClick={() => router.push(`/room/${room.roomCode}`)}
                                className="font-bold text-slate-200 underline decoration-slate-500 decoration-dotted underline-offset-4 transition hover:text-amber-100"
                              >
                                {room.roomCode}
                              </button>
                            </p>
                            <p className="mt-1 text-base font-black text-slate-100">Round {room.roundNumber}</p>
                            <p className="mt-1 text-sm text-slate-300">No players right now. Auto deletes after a short while.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => deleteRoom(room.roomCode)}
                            disabled={deletingRoomCode === room.roomCode}
                            aria-label={`Delete room ${room.roomCode}`}
                            title={`Delete room ${room.roomCode}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-200/40 text-slate-950/90 shadow-sm opacity-60 transition hover:bg-red-200/70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {deletingRoomCode === room.roomCode ? (
                              <span className="text-xs font-black">...</span>
                            ) : (
                              <TrashIcon className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {error && <p className="rounded-xl bg-red-950 p-4 text-red-200">{error}</p>}
      {scannerError && <p className="rounded-xl bg-amber-950/60 p-4 text-amber-100">{scannerError}</p>}

      {showScanner && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Scan QR</p>
                <h2 className="mt-1 text-2xl font-black text-slate-100">Join by camera</h2>
              </div>
              <button onClick={stopScanner} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-bold text-slate-100">
                Close
              </button>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black">
              <video ref={scannerVideoRef} className="h-64 w-full object-cover" playsInline muted />
            </div>
            <canvas ref={scannerCanvasRef} className="hidden" />
            <p className="mt-3 text-sm text-slate-300">
              Point your camera at a room QR code. If scanning isn’t supported, use Copy link or Share instead.
            </p>
            {scannerError && <p className="mt-3 rounded-xl bg-red-950 p-3 text-sm text-red-200">{scannerError}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M3 6h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 11v6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M6 6l12 12" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
