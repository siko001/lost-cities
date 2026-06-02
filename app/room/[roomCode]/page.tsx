"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";
import { applyMove } from "@/lib/game/engine";
import type { GameState, Player } from "@/lib/game/types";
import { GameBoard } from "@/components/GameBoard";
import { playRoomReadyChime } from "@/lib/sound";
import { readStoredBoolean, SOUND_ENABLED_KEY } from "@/lib/preferences";

type GameRow = {
  id: string;
  room_code: string;
  state: GameState;
};

function normalizeGameState(state: GameState): GameState {
  return {
    ...state,
    roundNumber: state.roundNumber ?? 1,
    roundScores: state.roundScores ?? {},
    totalScores: state.totalScores ?? {},
    roundHistory: state.roundHistory ?? [],
    roundReadyPlayerIds: state.roundReadyPlayerIds ?? [],
    rematchReadyPlayerIds: state.rematchReadyPlayerIds ?? [],
  };
}

function getStoredPlayerId(roomCode: string) {
  const key = `lost-expeditions-player-${roomCode}`;
  let id = window.localStorage.getItem(key);
  if (!id) {
    const randomId =
      globalThis.crypto?.randomUUID?.() ??
      `player-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    id = randomId;
    window.localStorage.setItem(key, id);
  }
  return id;
}

export default function RoomPage() {
  const params = useParams<{ roomCode: string }>();
  const router = useRouter();
  const roomCode = params.roomCode.toUpperCase();
  const [shareLink, setShareLink] = useState("");
  const [game, setGame] = useState<GameRow | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [isLoadingGame, setIsLoadingGame] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const joined = useMemo(() => !!game?.state.players.some((player) => player.id === playerId), [game, playerId]);
  const roomIsFull = !!game && game.state.players.length >= 2 && !joined;

  useEffect(() => {
    setPlayerId(getStoredPlayerId(roomCode));
  }, [roomCode]);

  useEffect(() => {
    setShareLink(`${window.location.origin}/room/${roomCode}`);
  }, [roomCode]);

  useEffect(() => {
    const client = supabase;
    if (!client) return;
    const supabaseClient = client;

    async function loadGame() {
      setIsLoadingGame(true);
      const { data, error: loadError } = await supabaseClient
        .from("games")
        .select("id,room_code,state")
        .eq("room_code", roomCode)
        .maybeSingle();
      if (loadError) {
        setError(loadError.message);
        setToastMessage(loadError.message);
      }
      if (!data && !loadError) {
        setToastMessage("Room not found.");
        window.setTimeout(() => {
          router.replace("/");
        }, 1600);
      }
      if (data) setGame({ ...(data as GameRow), state: normalizeGameState((data as GameRow).state) });
      setIsLoadingGame(false);
    }

    loadGame();

    const channel = supabaseClient
      .channel(`game-${roomCode}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `room_code=eq.${roomCode}` },
        (payload) => setGame({ ...(payload.new as GameRow), state: normalizeGameState((payload.new as GameRow).state) })
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, [roomCode]);

  async function saveState(nextState: GameState, move?: Parameters<typeof applyMove>[1]) {
    const client = supabase;
    if (!client) {
      setError("Supabase is not configured yet, so online room updates are unavailable.");
      return;
    }
    if (!game) return;

    if (move?.type === "startRound") {
      const { data: latestRoom, error: latestError } = await client.from("games").select("state").eq("id", game.id).maybeSingle();
      if (latestError) {
        setError(latestError.message);
        return;
      }
      const latestState = latestRoom?.state as GameState | undefined;
      if (!latestState || latestState.players.length !== 2) {
        setError("The other player left. Waiting for both players again.");
        setToastMessage("The other player left. Waiting for both players again.");
        setGame((current) => (current ? { ...current, state: normalizeGameState(latestState ?? current.state) } : current));
        return;
      }

      if (latestState.status === "playing" && latestState.roundNumber >= nextState.roundNumber) {
        setGame({ ...game, state: normalizeGameState(latestState) });
        return;
      }

      const mergedState = applyMove(latestState, move);
      const { error: updateError } = await client.from("games").update({ state: mergedState }).eq("id", game.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setGame({ ...game, state: normalizeGameState(mergedState) });
      return;
    }

    const { error: updateError } = await client.from("games").update({ state: nextState }).eq("id", game.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setGame({ ...game, state: normalizeGameState(nextState) });
  }

  async function joinRoom() {
    if (!game || !playerId || !name.trim() || roomIsFull) return;
    try {
      setIsJoining(true);
      const player: Player = { id: playerId, name: name.trim().slice(0, 24) };
      const nextState = applyMove(game.state, { type: "join", player });
      setGame({ ...game, state: normalizeGameState(nextState) });
      await saveState(nextState);
      if (nextState.players.length === 2 && readStoredBoolean(SOUND_ENABLED_KEY, true)) {
        playRoomReadyChime();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join room");
    } finally {
      setIsJoining(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-6">
        <p className="rounded-xl bg-red-950 p-4 text-red-200">{error}</p>
        {!isSupabaseConfigured && <p className="text-slate-300">Open the local demo for now, then come back once Supabase is set up.</p>}
        {toastMessage && (
          <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-red-200/20 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl backdrop-blur">
            {toastMessage}
          </div>
        )}
      </main>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-4 p-6">
        <h1 className="text-4xl font-black">Room {roomCode}</h1>
        <p className="text-slate-300">Online rooms are waiting on Supabase setup. The demo version is ready to play locally.</p>
      </main>
    );
  }

  if (isLoadingGame || !playerId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
        <div className="rounded-3xl border border-amber-100/10 bg-slate-900 p-6 shadow-xl">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Joining room</p>
          <h1 className="mt-2 text-4xl font-black">Room {roomCode}</h1>
          <p className="mt-3 text-slate-300">Loading your room and preparing your seat...</p>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-amber-200/80" />
          </div>
        </div>
      </main>
    );
  }

  if (!joined) {
    if (roomIsFull) {
      return (
        <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
          <div className="rounded-3xl border border-amber-100/10 bg-slate-900 p-6 shadow-xl">
            <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Private room</p>
            <h1 className="mt-2 text-4xl font-black">Room {roomCode}</h1>
            <p className="mt-3 text-slate-300">This room is full.</p>
          </div>
          <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-red-200/20 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl backdrop-blur">
            Room is full.
          </div>
        </main>
      );
    }

    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
        <div className="rounded-3xl border border-amber-100/10 bg-slate-900 p-6 shadow-xl">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Private room</p>
          <h1 className="mt-2 text-4xl font-black">Join Room {roomCode}</h1>
          <p className="mt-3 text-slate-300">Enter your name, then continue into the room.</p>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your name"
            className="mt-6 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none"
            onKeyDown={(event) => {
              if (event.key === "Enter" && name.trim()) {
                joinRoom();
              }
            }}
          />
          <button
            onClick={joinRoom}
            disabled={!name.trim() || isJoining}
            className="mt-3 w-full rounded-xl bg-white px-5 py-3 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isJoining ? "Joining..." : "Continue"}
          </button>
        </div>
      </main>
    );
  }

  const currentGame = game;
  if (!currentGame || !playerId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
        <div className="rounded-3xl border border-amber-100/10 bg-slate-900 p-6 shadow-xl">
          <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Joining room</p>
          <h1 className="mt-2 text-4xl font-black">Room {roomCode}</h1>
          <p className="mt-3 text-slate-300">Preparing the table...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full p-4 md:p-8">
      <GameBoard state={currentGame.state} playerId={playerId} onStateChange={saveState} shareLink={shareLink} />
      {toastMessage && (
        <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-red-200/20 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl backdrop-blur">
          {toastMessage}
        </div>
      )}
    </main>
  );
}
