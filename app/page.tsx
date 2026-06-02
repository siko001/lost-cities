"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { createInitialGame } from "@/lib/game/engine";

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [error, setError] = useState("");
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const joinInputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (!showJoinForm) return;
    joinInputRef.current?.focus();
  }, [showJoinForm]);

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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6 text-center">
      <div>
        <p className="mb-3 text-sm uppercase tracking-[0.4em] text-slate-400">Private card battle</p>
        <h1 className="text-5xl font-black">Lost Expeditions</h1>
        <p className="mt-4 text-lg text-slate-300">Create a private room, send the link to your wife, and play as guests.</p>
        {!isSupabaseConfigured && (
          <p className="mt-3 rounded-xl border border-amber-200/20 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
            Supabase is not set up yet, so online rooms are disabled for now. The demo still works locally.
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
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
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-xl">
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
            <button onClick={joinRoom} disabled={loading} className="rounded-xl bg-white px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Checking..." : "Join"}
            </button>
          </div>
          <button
            onClick={openScanner}
            className="mt-3 w-full rounded-xl bg-slate-800 px-5 py-3 font-bold text-slate-100"
          >
            Scan QR
          </button>
        </div>
      )}
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
