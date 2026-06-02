"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { applyMove, scorePlayer } from "@/lib/game/engine";
import type { Card, GameState, Suit } from "@/lib/game/types";
import { readStoredBoolean, SCROLL_ENABLED_KEY, SOUND_ENABLED_KEY, writeStoredBoolean } from "@/lib/preferences";
import { CardBack, CardView } from "./CardView";
import { playInvalidMoveBuzzer, playRoomReadyChime, playTurnReminder } from "@/lib/sound";

const suits: Suit[] = ["red", "blue", "green", "yellow", "white"];

export function GameBoard({
  state,
  playerId,
  onStateChange,
  shareLink,
}: {
  state: GameState;
  playerId: string;
  onStateChange: (state: GameState, move?: Parameters<typeof applyMove>[1]) => Promise<void>;
  shareLink?: string;
}) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [turnStage, setTurnStage] = useState<"pick-card" | "draw-card">("pick-card");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [turnToastMessage, setTurnToastMessage] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [error, setError] = useState("");
  const [errorSignal, setErrorSignal] = useState(0);
  const [toastSwipeX, setToastSwipeX] = useState(0);
  const [toastSwipeDragging, setToastSwipeDragging] = useState(false);
  const [errorSwipeX, setErrorSwipeX] = useState(0);
  const [errorSwipeDragging, setErrorSwipeDragging] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scrollModeEnabled, setScrollModeEnabled] = useState(false);
  const previousTurnPlayerId = useRef<string | null>(state.currentPlayerId);
  const previousGameStatus = useRef(state.status);
  const previousPlayerCount = useRef(state.players.length);
  const turnReminderTimeoutRef = useRef<number | null>(null);
  const toastPointerStartX = useRef<number | null>(null);
  const errorPointerStartX = useRef<number | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const boardScrollerRef = useRef<HTMLDivElement | null>(null);
  const selectedCard = useMemo(() => state.hands[playerId]?.find((card) => card.id === selectedCardId), [state.hands, playerId, selectedCardId]);
  const me = state.players.find((player) => player.id === playerId) ?? null;
  const opponent = state.players.find((player) => player.id !== playerId) ?? null;
  const isMyTurn = state.currentPlayerId === playerId;
  const hand = state.hands[playerId] ?? [];
  const isPlaying = state.status === "playing";
  const isRoundOver = state.status === "round-over";
  const isFinished = state.status === "finished";
  const isWaiting = state.status === "waiting";
  const turnGuide = !isPlaying || !isMyTurn ? null : turnStage === "pick-card" ? "Your turn to play. Pick a card, then Play or Discard." : "Now draw a card to finish your turn.";
  const roundWinner = getWinnerName(state.players, state.roundScores);
  const finalWinner = getWinnerName(state.players, state.totalScores);
  const startRoundReady = state.roundReadyPlayerIds.includes(playerId);
  const rematchReady = state.rematchReadyPlayerIds.includes(playerId);
  const roomReadyToPlay = state.players.length === 2;
  const [sharePanelOpen, setSharePanelOpen] = useState(!roomReadyToPlay);
  const liveMyTotal = scorePlayer(state, playerId);
  const liveOpponentTotal = opponent ? scorePlayer(state, opponent.id) : null;

  useEffect(() => {
    setSoundEnabled(readStoredBoolean(SOUND_ENABLED_KEY, true));
    setScrollModeEnabled(readStoredBoolean(SCROLL_ENABLED_KEY, false));
  }, []);

  useEffect(() => {
    if (!isMyTurn || !isPlaying) {
      setSelectedCardId(null);
      setTurnStage("pick-card");
      setToastMessage(null);
      setTurnToastMessage(null);
      setError("");
    }
  }, [isMyTurn, isPlaying, playerId]);

  useEffect(() => {
    setSharePanelOpen((current) => {
      if (roomReadyToPlay) return false;
      return current;
    });
  }, [roomReadyToPlay]);

  useEffect(() => {
    if (turnStage === "draw-card") {
      setSelectedCardId(null);
    }
  }, [turnStage]);

  useEffect(() => {
    if (!turnGuide) {
      setTurnToastMessage(null);
      return;
    }

    setTurnToastMessage(turnGuide);

    const timeout = window.setTimeout(() => {
      setTurnToastMessage(null);
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [turnGuide]);

  useEffect(() => {
    const previousTurnPlayer = previousTurnPlayerId.current;
    const turnChanged = previousTurnPlayer !== state.currentPlayerId;
    const statusChangedToPlaying = previousGameStatus.current !== "playing" && state.status === "playing";
    previousTurnPlayerId.current = state.currentPlayerId;
    previousGameStatus.current = state.status;

    if (!isPlaying || !turnChanged || statusChangedToPlaying || !previousTurnPlayer || state.currentPlayerId !== playerId) {
      return;
    }

    if (soundEnabled) playTurnChime();
  }, [isPlaying, state.currentPlayerId, state.status, playerId, soundEnabled]);

  useEffect(() => {
    if (!isMyTurn || !isPlaying || turnStage !== "pick-card" || selectedCardId) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setToastMessage("Still your turn. Pick a card first, then play or discard it. Drawing only unlocks after that.");
    }, 7000);

    return () => window.clearTimeout(timeout);
  }, [isMyTurn, isPlaying, selectedCardId, turnStage]);

  useEffect(() => {
    if (!error) return;

    const timeout = window.setTimeout(() => {
      setError("");
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!error) return;
    if (soundEnabled) playInvalidMoveBuzzer();
  }, [errorSignal, error, soundEnabled]);

  useEffect(() => {
    setToastSwipeX(0);
    setToastSwipeDragging(false);
    toastPointerStartX.current = null;
  }, [toastMessage]);

  useEffect(() => {
    setErrorSwipeX(0);
    setErrorSwipeDragging(false);
    errorPointerStartX.current = null;
  }, [error]);

  useEffect(() => {
    if (!scrollModeEnabled || !selectedCard) return;

    const scroller = boardScrollerRef.current;
    const laneElement = scroller?.querySelector<HTMLElement>(`[data-lane-suit="${selectedCard.suit}"]`);
    if (!scroller || !laneElement) return;

    const laneCenter = laneElement.offsetLeft + laneElement.offsetWidth / 2;
    const targetScrollLeft = laneCenter - scroller.clientWidth / 2;
    scroller.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: "smooth",
    });
  }, [scrollModeEnabled, selectedCard]);

  useEffect(() => {
    if (turnReminderTimeoutRef.current !== null) {
      window.clearTimeout(turnReminderTimeoutRef.current);
      turnReminderTimeoutRef.current = null;
    }

    if (!isPlaying || !isMyTurn || (turnStage !== "pick-card" && turnStage !== "draw-card")) {
      return;
    }

    const scheduleReminder = () => {
      turnReminderTimeoutRef.current = window.setTimeout(() => {
        if (state.currentPlayerId !== playerId || state.status !== "playing") {
          return;
        }

        if (turnStage !== "pick-card" && turnStage !== "draw-card") {
          return;
        }

        if (soundEnabled) playTurnReminder();
        setToastMessage("Still your turn. Please play, discard, or draw a card.");
        scheduleReminder();
      }, 30000);
    };

    scheduleReminder();

    return () => {
      if (turnReminderTimeoutRef.current !== null) {
        window.clearTimeout(turnReminderTimeoutRef.current);
        turnReminderTimeoutRef.current = null;
      }
    };
  }, [isPlaying, isMyTurn, playerId, state.currentPlayerId, state.status, turnStage, selectedCardId, soundEnabled]);

  useEffect(() => {
    const roomJustCompleted = isWaiting && state.players.length === 2 && previousPlayerCount.current < 2;
    previousPlayerCount.current = state.players.length;

    if (!roomJustCompleted) {
      return;
    }

    if (soundEnabled) playRoomReadyChime();
    setToastMessage("Room complete. Game can start.");

    const timeout = window.setTimeout(() => {
      setToastMessage(null);
    }, 4500);

    return () => window.clearTimeout(timeout);
  }, [isWaiting, state.players.length, soundEnabled]);

  async function commit(move: Parameters<typeof applyMove>[1]) {
    try {
      setError("");
      const next = applyMove(state, move);
      await onStateChange(next, move);
      if (move.type === "play" || move.type === "discard") {
        setTurnStage("draw-card");
        setToastMessage(null);
        setSelectedCardId(null);
      } else if (move.type === "drawDeck" || move.type === "drawDiscard") {
        setTurnStage("pick-card");
        setToastMessage(null);
        setSelectedCardId(null);
      } else if (move.type === "start" || move.type === "startRound") {
        setTurnStage("pick-card");
        setSelectedCardId(null);
        setToastMessage(move.type === "startRound" && next.status === "round-over" ? "Ready for the next round. Waiting for the other player." : null);
      } else if (move.type === "rematch") {
        setTurnStage("pick-card");
        setSelectedCardId(null);
        setToastMessage(next.status === "finished" ? "Ready for a rematch. Waiting for the other player." : "Rematch started.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown move error");
      setErrorSignal((value) => value + 1);
    }
  }

  function toggleSoundEnabled() {
    setSoundEnabled((current) => {
      const next = !current;
      writeStoredBoolean(SOUND_ENABLED_KEY, next);
      return next;
    });
  }

  function toggleScrollMode() {
    setScrollModeEnabled((current) => {
      const next = !current;
      writeStoredBoolean(SCROLL_ENABLED_KEY, next);
      return next;
    });
  }

  async function startGame() {
    await commit({ type: "start" });
  }

  async function copyShareLink() {
    if (!shareLink) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareLink);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = shareLink;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) {
          throw new Error("copy failed");
        }
      }
      setToastMessage("Room link copied.");
    } catch {
      setToastMessage("Could not copy the room link. Open QR instead.");
      setShowQr(true);
    }
  }

  async function shareRoomLink() {
    if (!shareLink) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Lost Expeditions room ${state.roomCode}`,
          text: "Join my Lost Expeditions room",
          url: shareLink,
        });
        return;
      } catch {
        // Fall back to QR below.
      }
    }

    setShowQr(true);
  }

  return (
    <div className="w-full space-y-6">
      <header className="overflow-hidden rounded-3xl border border-amber-100/10 bg-[url('/assets/asset-sheet.png')] bg-cover bg-center p-5 shadow-xl">
        <div className="rounded-2xl bg-slate-950/80 p-4 backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Private room</p>
              <h1 className="text-2xl font-black">Room {state.roomCode}</h1>
              <p className="text-slate-300">{state.lastAction}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-3 text-sm text-slate-300 backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Table</p>
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs uppercase tracking-[0.2em] text-slate-400">
                    <span>You: {me?.name ?? "You"}</span>
                    <span>Opponent: {opponent?.name ?? "Waiting..."}</span>
                    <span>Deck {state.deck.length}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={toggleScrollMode}
                    className={`rounded-xl border px-3 py-2 transition ${scrollModeEnabled ? "border-amber-200/40 bg-amber-200/15 text-amber-100" : "border-white/10 bg-slate-900/70 text-slate-300"}`}
                    aria-label={scrollModeEnabled ? "Disable auto-scroll" : "Enable auto-scroll"}
                    title={scrollModeEnabled ? "Auto-scroll on" : "Auto-scroll off"}
                    type="button"
                  >
                    {scrollModeEnabled ? (
                      <ScrollIcon className="h-5 w-5" />
                    ) : (
                      <ScrollOffIcon className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    onClick={toggleSoundEnabled}
                    className={`rounded-xl border px-3 py-2 transition ${soundEnabled ? "border-amber-200/40 bg-amber-200/15 text-amber-100" : "border-white/10 bg-slate-900/70 text-slate-300"}`}
                    aria-label={soundEnabled ? "Mute sounds" : "Unmute sounds"}
                    title={soundEnabled ? "Sound on" : "Muted"}
                    type="button"
                  >
                    {soundEnabled ? <SoundOnIcon className="h-5 w-5" /> : <SoundOffIcon className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {isWaiting && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/45 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-slate-400">
                  {roomReadyToPlay ? "Room is ready. Start the game when both players are set." : "Send this room URL to your second player."}
                </p>
                <button
                  onClick={() => setSharePanelOpen((value) => !value)}
                  className="rounded-xl bg-slate-800 px-4 py-2 text-sm font-bold text-slate-100"
                >
                  {sharePanelOpen ? "Hide" : roomReadyToPlay ? "Open invite" : "Show invite"}
                </button>
              </div>
              {sharePanelOpen && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={copyShareLink} disabled={!shareLink} className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
                    Copy link
                  </button>
                  <button onClick={shareRoomLink} disabled={!shareLink} className="rounded-xl bg-amber-200 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">
                    Share
                  </button>
                  <button onClick={() => setShowQr(true)} disabled={!shareLink} className="rounded-xl bg-slate-800 px-4 py-2 font-bold text-slate-100 disabled:cursor-not-allowed disabled:opacity-40">
                    Scan QR
                  </button>
                </div>
              )}
              {roomReadyToPlay && !sharePanelOpen && (
                <button onClick={startGame} className="mt-3 rounded-xl bg-white px-5 py-3 font-bold text-slate-950">
                  Start Game
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <section ref={boardRef} className="relative w-full overflow-hidden rounded-[2rem] border border-amber-100/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 shadow-2xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.08),transparent_44%)]" />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-36 -translate-y-1/2 rounded-[2rem] bg-[linear-gradient(90deg,#4b2517_0%,#6e3a23_12%,#874f2c_34%,#7a4729_66%,#4b2517_100%)] opacity-80 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]" />
        <div className="relative z-10 rounded-[1.5rem] border border-white/10 bg-slate-950/35 p-3 backdrop-blur">
          <div className="mb-3 flex items-start justify-between gap-3 md:mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-slate-400 md:text-sm">Main board</p>
              <h3 className="max-w-[15ch] text-sm font-black text-slate-100 md:max-w-none md:text-lg">
                Colors, discards, and played cards
              </h3>
            </div>
            <div className="hidden sm:block">
              <CardBack label={`${state.deck.length} left`} />
            </div>
          </div>
          <div ref={boardScrollerRef} className="overflow-x-auto overscroll-x-contain">
            <div className="grid min-w-[1280px] grid-cols-5 gap-0 overflow-hidden rounded-[1.4rem] border border-slate-800/80 bg-slate-950/55">
              {suits.map((suit) => {
                const opponentCards = opponent ? state.expeditions[opponent.id]?.[suit] ?? [] : [];
                const myCards = state.expeditions[playerId]?.[suit] ?? [];
                const discardTop = state.discards[suit].at(-1);

                return (
                  <div
                    key={suit}
                    data-lane-suit={suit}
                    className="min-h-[560px] border-r border-slate-800/80 p-3 last:border-r-0 first:rounded-l-[1.4rem] last:rounded-r-[1.4rem]"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-bold capitalize text-slate-100">{suit}</p>
                        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Board lane</p>
                      </div>
                      <span className="text-xs uppercase tracking-[0.2em] text-slate-400">Play here</span>
                    </div>

                    <div className="flex h-[500px] flex-col gap-3">
                      <LaneStack
                        label={opponent?.name ?? "Opponent"}
                        cards={opponentCards}
                        score={scoreExpedition(opponentCards)}
                        emptyText="Waiting"
                        className="flex-1"
                      />
                      <DiscardSpot
                        suit={suit}
                        top={discardTop}
                        isMyTurn={isMyTurn}
                        turnStage={turnStage}
                        onDrawDiscard={() => commit({ type: "drawDiscard", playerId, suit })}
                        className="flex-none"
                      />
                      <LaneStack
                        label={me?.name ?? "You"}
                        cards={myCards}
                        score={scoreExpedition(myCards)}
                        emptyText={state.players.length < 2 ? "Waiting" : "No cards yet"}
                        className="flex-1"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {isPlaying && (
        <section className="rounded-3xl bg-slate-900 p-4 shadow-xl w-full">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <CardBack label={`${state.deck.length} left`} />
              <div>
                <h2 className="text-xl font-black">
                  {isMyTurn ? "Your turn" : "Opponent turn"}{" "}
                  <span className="text-slate-400">
                    — {isMyTurn ? (turnStage === "pick-card" ? "playing" : "drawing") : "waiting"}
                  </span>
                </h2>
                <p className="text-sm text-slate-300">
                  {isMyTurn
                    ? turnStage === "pick-card"
                      ? "Select a card, then play or discard it."
                      : "Now draw a card from the deck or a discard pile to finish your turn."
                    : "Wait for the other player to finish their turn."}
                </p>
                <p className="mt-2 text-sm uppercase tracking-[0.2em] text-slate-400">
                  Current total: {liveMyTotal}
                  {liveOpponentTotal !== null && ` • Opponent: ${liveOpponentTotal}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                disabled={!isMyTurn || !selectedCard}
                onClick={() => selectedCard && commit({ type: "play", playerId, cardId: selectedCard.id })}
                draggable={false}
                className="rounded-xl bg-emerald-200 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Play
              </button>
              <button
                disabled={!isMyTurn || !selectedCard}
                onClick={() => selectedCard && commit({ type: "discard", playerId, cardId: selectedCard.id })}
                draggable={false}
                className="rounded-xl bg-amber-200 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Discard
              </button>
              <button
                disabled={!isMyTurn || turnStage !== "draw-card"}
                onClick={() => commit({ type: "drawDeck", playerId })}
                draggable={false}
                className="rounded-xl bg-white px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Draw Deck
              </button>
            </div>
          </div>
          <p className="mb-4 text-sm text-slate-400">
            {isMyTurn
              ? turnStage === "pick-card"
                ? "Choose a card to play or discard."
                : "Now draw a card from the deck or a discard pile to finish your turn."
              : "The active player’s hand is locked while they play."}
          </p>
          <div className="flex flex-wrap gap-3">
            {hand.map((card) => (
              <CardView
                key={card.id}
                card={card}
                selected={selectedCardId === card.id}
                onClick={
                  turnStage === "pick-card" && isMyTurn
                    ? () => {
                        setSelectedCardId(card.id);
                        setToastMessage(null);
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </section>
      )}

      {(isRoundOver || isFinished) && (
        <section className="rounded-3xl bg-slate-900 p-4 shadow-xl w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
                {isFinished ? "Game complete" : `Round ${state.roundNumber} complete`}
              </p>
              <h2 className="text-2xl font-black">
                {isFinished ? "Final scores" : `Round ${state.roundNumber} score`}
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                {isFinished
                  ? "All three rounds are done. Totals below decide the winner."
                  : `Round ${state.roundNumber} finished. Totals carry into round ${state.roundNumber + 1}.`}
              </p>
              <p className="mt-2 text-sm font-semibold text-amber-100">
                {isFinished
                  ? finalWinner
                    ? `Game winner is ${finalWinner}.`
                    : "Game ended with a tie."
                  : roundWinner
                    ? `Round winner is ${roundWinner}.`
                    : "Round ended in a tie."}
              </p>
              {isFinished && state.players.length === 2 && (
                <p className="mt-2 text-sm text-slate-300">Both players must press rematch to start a new game.</p>
              )}
            </div>
            {!isFinished && (
              <button
                onClick={() => commit({ type: "startRound", playerId })}
                disabled={startRoundReady}
                className="rounded-xl bg-amber-200 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {startRoundReady ? `Ready for Round ${state.roundNumber + 1}` : `Start Round ${state.roundNumber + 1}`}
              </button>
            )}
            {isFinished && (
              <button
                onClick={() => commit({ type: "rematch", playerId })}
                disabled={rematchReady || state.players.length !== 2}
                className="rounded-xl bg-amber-200 px-4 py-2 font-bold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state.players.length !== 2 ? "Need both players" : rematchReady ? "Ready for rematch" : "Rematch"}
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <ScorePanel title={`Round ${state.roundNumber} scores`} scores={state.roundScores} players={state.players} />
            <ScorePanel title="Total scores" scores={state.totalScores} players={state.players} />
          </div>

          {isFinished && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-sm text-slate-300">
              The room is ready for a fresh game if you want to start over with new rounds.
            </div>
          )}
        </section>
      )}

      {isWaiting && (
        <section className="rounded-3xl bg-slate-900 p-4 shadow-xl">
          <h2 className="text-xl font-black">Waiting for players</h2>
          <p className="mt-2 text-slate-300">
            Once both seats are filled, hit start and the hand / discard controls will appear here.
          </p>
        </section>
      )}

      {toastMessage && (
        <div
          className="fixed bottom-4 right-4 z-[1000] w-fit max-w-[calc(100vw-2rem)]"
          style={{ animation: "toast-rise 420ms ease-out" }}
          role="status"
          aria-live="polite"
        >
          <div
            className="cursor-grab rounded-2xl border border-amber-200/20 bg-slate-950/95 px-4 py-3 text-sm text-amber-100 shadow-2xl backdrop-blur active:cursor-grabbing whitespace-normal break-words"
            style={{
              transform: `translateX(${toastSwipeX}px)`,
              transition: toastSwipeDragging ? "none" : "transform 180ms ease, opacity 180ms ease",
              opacity: Math.max(0.25, 1 - Math.abs(toastSwipeX) / 240),
            }}
            onPointerDown={(event) => {
              toastPointerStartX.current = event.clientX;
              setToastSwipeDragging(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!toastSwipeDragging || toastPointerStartX.current === null) return;
              setToastSwipeX(event.clientX - toastPointerStartX.current);
            }}
            onPointerUp={(event) => {
              if (!toastSwipeDragging || toastPointerStartX.current === null) return;
              const distance = event.clientX - toastPointerStartX.current;
              setToastSwipeDragging(false);
              toastPointerStartX.current = null;
              if (Math.abs(distance) > 120) {
                setToastMessage(null);
                return;
              }
              setToastSwipeX(0);
            }}
            onPointerCancel={() => {
              setToastSwipeDragging(false);
              toastPointerStartX.current = null;
              setToastSwipeX(0);
            }}
          >
            {toastMessage}
          </div>
        </div>
      )}

      {turnToastMessage && (
        <div
          className="fixed bottom-4 right-4 z-[1000] max-w-xs rounded-2xl border border-emerald-200/20 bg-slate-950/95 px-4 py-3 text-sm font-semibold text-emerald-100 shadow-2xl backdrop-blur"
          role="status"
          aria-live="polite"
          style={{ animation: "toast-rise 420ms ease-out" }}
        >
          {turnToastMessage}
        </div>
      )}

      {error && (
        <div
          className="fixed bottom-4 right-4 z-[1000] w-fit max-w-[calc(100vw-2rem)]"
          role="alert"
          aria-live="assertive"
          style={{ animation: "toast-rise 420ms ease-out" }}
        >
          <div style={{ animation: "toast-bob 2.2s ease-in-out infinite alternate" }}>
            <div
              className="cursor-grab rounded-2xl border border-red-200/20 bg-red-950/95 px-4 py-3 text-sm text-red-100 shadow-2xl backdrop-blur active:cursor-grabbing whitespace-normal break-words"
              style={{
                transform: `translateX(${errorSwipeX}px)`,
                transition: errorSwipeDragging ? "none" : "transform 180ms ease, opacity 180ms ease",
                opacity: Math.max(0.25, 1 - Math.abs(errorSwipeX) / 240),
              }}
              onPointerDown={(event) => {
                errorPointerStartX.current = event.clientX;
                setErrorSwipeDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!errorSwipeDragging || errorPointerStartX.current === null) return;
                setErrorSwipeX(event.clientX - errorPointerStartX.current);
              }}
              onPointerUp={(event) => {
                if (!errorSwipeDragging || errorPointerStartX.current === null) return;
                const distance = event.clientX - errorPointerStartX.current;
                setErrorSwipeDragging(false);
                errorPointerStartX.current = null;
                if (Math.abs(distance) > 110) {
                  setError("");
                  return;
                }
                setErrorSwipeX(0);
              }}
              onPointerCancel={() => {
                setErrorSwipeDragging(false);
                errorPointerStartX.current = null;
                setErrorSwipeX(0);
              }}
            >
              {error}
            </div>
          </div>
        </div>
      )}

      {showQr && shareLink && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm uppercase tracking-[0.3em] text-slate-400">QR code</p>
                <h3 className="mt-1 text-2xl font-black text-slate-100">Scan to join</h3>
              </div>
              <button onClick={() => setShowQr(false)} className="rounded-xl bg-slate-800 px-3 py-2 text-sm font-bold text-slate-100">
                Close
              </button>
            </div>
            <div className="mt-5 flex justify-center rounded-2xl bg-white p-4">
              <QRCodeCanvas value={shareLink} size={220} includeMargin />
            </div>
            <p className="mt-4 break-all rounded-2xl bg-slate-950 px-4 py-3 text-sm text-slate-300">{shareLink}</p>
            <div className="mt-4 flex gap-2">
              <button onClick={copyShareLink} className="flex-1 rounded-xl bg-white px-4 py-3 font-bold text-slate-950">
                Copy link
              </button>
              <button onClick={() => setShowQr(false)} className="rounded-xl bg-slate-800 px-4 py-3 font-bold text-slate-100">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @keyframes toast-rise {
          from {
            opacity: 0;
            transform: translateY(18px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes toast-bob {
          from {
            transform: translateY(0px);
          }
          to {
            transform: translateY(-5px);
          }
        }
      `}</style>
    </div>
  );
}

function getWinnerName(players: Array<{ id: string; name: string }>, scores: Record<string, number>) {
  if (players.length === 0) return null;
  const ranked = players
    .map((player) => ({ player, score: scores[player.id] ?? 0 }))
    .sort((left, right) => right.score - left.score);
  if (ranked.length < 2) return ranked[0]?.player.name ?? null;
  if (ranked[0].score === ranked[1].score) return null;
  return ranked[0].player.name;
}

function playTurnChime() {
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
      { frequency: 523.25, start: 0 },
      { frequency: 659.25, start: 0.12 },
      { frequency: 783.99, start: 0.24 },
    ];

    for (const note of notes) {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      oscillator.connect(gainNode);
      oscillator.start(audioContext.currentTime + note.start);
      oscillator.stop(audioContext.currentTime + note.start + 0.14);
    }

    gainNode.gain.linearRampToValueAtTime(0.04, audioContext.currentTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(0.0001, audioContext.currentTime + 0.5);

    window.setTimeout(() => {
      audioContext.close().catch(() => {});
    }, 900);
  } catch {
    // Sound is best-effort only.
  }
}

function SoundOnIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M11 5 6.5 8.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.5L11 19V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 9a4 4 0 0 1 0 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17.5 6.5a7 7 0 0 1 0 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
    </svg>
  );
}

function SoundOffIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M11 5 6.5 8.5H4a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h2.5L11 19V5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16 9 4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m20 9-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ScrollIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M8 6h8a2 2 0 0 1 2 2v9a3 3 0 1 1-3-3H6a2 2 0 0 1 0-4h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 16h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" opacity="0.65" />
    </svg>
  );
}

function ScrollOffIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M8 6h8a2 2 0 0 1 2 2v9a3 3 0 1 1-3-3H6a2 2 0 0 1 0-4h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m4 4 16 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LaneStack({
  label,
  cards,
  score,
  emptyText,
  className = "",
}: {
  label: string;
  cards: Card[];
  score: number | null;
  emptyText: string;
  className?: string;
}) {
  const [isCompressed, setIsCompressed] = useState(false);

  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-950/50 p-2 ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          {score !== null && (
            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-amber-100">
              {score > 0 ? `+${score}` : score}
            </span>
          )}
          <span className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{cards.length ? `${cards.length} played` : emptyText}</span>
        </div>
      </div>
      {cards.length ? (
        <button
          type="button"
          onClick={() => setIsCompressed((value) => !value)}
          className="flex min-h-[96px] w-full max-w-full min-w-0 overflow-x-auto overscroll-x-contain pb-1 text-left"
          aria-label={`Toggle ${label} expedition stack`}
          title={isCompressed ? "Tap to spread cards" : "Tap to compress cards"}
        >
          {cards.map((card, index) => (
            <div
              key={card.id}
              className={`relative shrink-0 origin-left transition-[margin,transform] duration-300 ease-out ${
                isCompressed ? "scale-[0.88]" : ""
              } ${index === 0 ? "" : isCompressed ? "-ml-14" : "-ml-7"}`}
              style={{ zIndex: index + 1 }}
            >
              <CardView card={card} compact stacked />
            </div>
          ))}
        </button>
      ) : (
        <p className="text-sm text-slate-500">{emptyText}</p>
      )}
    </div>
  );
}

function scoreExpedition(cards: Card[]) {
  if (!cards.length) return null;
  const wagers = cards.filter((card) => card.kind === "wager").length;
  const sum = cards.reduce((total, card) => total + card.value, 0);
  return (sum - 20) * (wagers + 1);
}

function DiscardSpot({
  suit,
  top,
  isMyTurn,
  turnStage,
  onDrawDiscard,
  className = "",
}: {
  suit: Suit;
  top: Card | undefined;
  isMyTurn: boolean;
  turnStage: "pick-card" | "draw-card";
  onDrawDiscard: () => void;
  className?: string;
}) {
  return (
    <button
      disabled={!isMyTurn || turnStage !== "draw-card" || !top}
      onClick={onDrawDiscard}
      draggable={false}
      className={`flex min-h-[140px] w-full items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/80 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      <div>
        <p className="font-bold capitalize text-slate-100">{suit}</p>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Discard pile</p>
      </div>
      <div>{top ? <CardView card={top} compact stacked /> : <p className="text-sm text-slate-500">Empty</p>}</div>
    </button>
  );
}

function ScorePanel({
  title,
  scores,
  players,
}: {
  title: string;
  scores: Record<string, number>;
  players: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/45 p-4">
      <p className="text-sm uppercase tracking-[0.3em] text-slate-400">{title}</p>
      <div className="mt-3 space-y-2">
        {players.map((player) => (
          <div key={player.id} className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2">
            <span className="font-semibold text-slate-100">{player.name}</span>
            <span className="text-lg font-black text-amber-100">{scores[player.id] ?? 0}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
