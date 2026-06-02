"use client";

import { useMemo, useState } from "react";
import { GameBoard } from "@/components/GameBoard";
import { applyMove, createInitialGame } from "@/lib/game/engine";
import type { GameState } from "@/lib/game/types";

function seededRandom(seed: string) {
  let value = 0;
  for (let index = 0; index < seed.length; index++) {
    value = (value * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createDemoGame(): GameState {
  let state = createInitialGame("DEMO01", ["base", "long-journey"], seededRandom("DEMO01"));
  state = applyMove(state, { type: "join", player: { id: "player-one", name: "Neil" } });
  state = applyMove(state, { type: "join", player: { id: "player-two", name: "Wife" } });
  state = applyMove(state, { type: "start" });
  return state;
}

export default function DemoPage() {
  const initialState = useMemo(() => createDemoGame(), []);
  const [state, setState] = useState<GameState>(initialState);

  return (
    <main className="mx-auto min-h-screen w-full p-4 md:p-8">
      <div className="mb-4 rounded-2xl border border-amber-200/20 bg-amber-950/30 p-4 text-amber-100">
        <strong>Demo mode:</strong> this runs locally without Supabase, so you can see and click the game immediately.
      </div>
      <GameBoard state={state} playerId="player-one" onStateChange={async (nextState) => setState(nextState)} />
    </main>
  );
}
