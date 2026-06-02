import { getEnabledModules } from "./modules";
import type { Card, GameState, Move, Suit } from "./types";

const suits: Suit[] = ["red", "blue", "green", "yellow", "white"];

function shuffleWithRandom<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function buildDeck(enabledModules: string[] = ["base"], random: () => number = Math.random): Card[] {
  let deck: Card[] = [];
  for (const suit of suits) {
    for (let i = 1; i <= 3; i++) deck.push({ id: `${suit}-wager-${i}`, suit, kind: "wager", value: 0 });
    for (let value = 2; value <= 10; value++) deck.push({ id: `${suit}-${value}`, suit, kind: "number", value });
  }
  for (const mod of getEnabledModules(enabledModules)) {
    deck = mod.extendDeck ? mod.extendDeck(deck) : deck;
  }
  return shuffleWithRandom(deck, random);
}

export function createInitialGame(roomCode: string, enabledModules = ["base"], random: () => number = Math.random): GameState {
  const discards: GameState["discards"] = { red: [], blue: [], green: [], yellow: [], white: [] };
  return {
    version: 1,
    status: "waiting",
    roomCode,
    players: [],
    currentPlayerId: null,
    deck: buildDeck(enabledModules, random),
    hands: {},
    expeditions: {},
    discards,
    roundNumber: 1,
    roundScores: {},
    totalScores: {},
    roundHistory: [],
    roundReadyPlayerIds: [],
    rematchReadyPlayerIds: [],
    lastAction: "Room created",
    enabledModules,
    moduleState: {},
  };
}

function nextPlayer(state: GameState, playerId: string) {
  const index = state.players.findIndex((player) => player.id === playerId);
  return state.players[(index + 1) % state.players.length]?.id ?? null;
}

function removeCard(hand: Card[], cardId: string) {
  const card = hand.find((item) => item.id === cardId);
  if (!card) throw new Error("Card not found in hand");
  return { card, hand: hand.filter((item) => item.id !== cardId) };
}

function assertTurn(state: GameState, playerId: string) {
  if (state.status !== "playing") throw new Error("Game is not playing");
  if (state.currentPlayerId !== playerId) throw new Error("Not your turn");
}

function createEmptyDiscards(): GameState["discards"] {
  return { red: [], blue: [], green: [], yellow: [], white: [] };
}

function resetForNextRound(state: GameState, random: () => number = Math.random) {
  state.deck = buildDeck(state.enabledModules, random);
  state.hands = {};
  state.expeditions = {};
  state.discards = createEmptyDiscards();
  state.roundScores = {};
  state.roundReadyPlayerIds = [];
  state.currentPlayerId = state.players[0]?.id ?? null;
  for (const player of state.players) {
    state.hands[player.id] = state.deck.splice(0, 8);
    state.expeditions[player.id] = {};
  }
}

function resetForNewMatch(state: GameState, random: () => number = Math.random) {
  state.roundNumber = 1;
  state.roundScores = {};
  state.totalScores = {};
  state.roundHistory = [];
  state.roundReadyPlayerIds = [];
  state.rematchReadyPlayerIds = [];
  resetForNextRound(state, random);
  state.status = "playing";
  state.lastAction = "Rematch started";
}

function finalizeRound(state: GameState) {
  const roundScores: Record<string, number> = {};
  for (const player of state.players) {
    roundScores[player.id] = scorePlayer(state, player.id);
  }

  state.roundScores = roundScores;
  state.roundHistory = [...state.roundHistory, { round: state.roundNumber, scores: roundScores }];
  for (const player of state.players) {
    state.totalScores[player.id] = (state.totalScores[player.id] ?? 0) + (roundScores[player.id] ?? 0);
  }
  state.currentPlayerId = null;
  state.roundReadyPlayerIds = [];

  if (state.roundNumber >= 3) {
    state.status = "finished";
    state.lastAction = "Final round complete. Game finished.";
    return;
  }

  state.status = "round-over";
  state.lastAction = `Round ${state.roundNumber} complete. Start round ${state.roundNumber + 1}.`;
}

export function applyMove(input: GameState, move: Move): GameState {
  let state = structuredClone(input) as GameState;

  for (const mod of getEnabledModules(state.enabledModules)) {
    state = mod.onBeforeMove ? mod.onBeforeMove(state, move) : state;
  }

  switch (move.type) {
    case "join": {
      if (state.players.length >= 2) throw new Error("Room is full");
      if (state.players.some((p) => p.id === move.player.id)) return state;
      state.players.push(move.player);
      state.hands[move.player.id] = [];
      state.expeditions[move.player.id] = {};
      state.lastAction = `${move.player.name} joined`;
      break;
    }
    case "start": {
      if (state.players.length !== 2) throw new Error("Need exactly 2 players");
      if (state.status !== "waiting") throw new Error("Game already started");
      resetForNextRound(state);
      state.status = "playing";
      state.lastAction = "Game started";
      break;
    }
    case "startRound": {
      if (state.players.length !== 2) throw new Error("Need exactly 2 players");
      if (state.status !== "round-over") throw new Error("Round is not ready to start");
      if (!state.roundReadyPlayerIds.includes(move.playerId)) {
        state.roundReadyPlayerIds.push(move.playerId);
      }

      if (state.roundReadyPlayerIds.length < state.players.length) {
        const readyPlayer = state.players.find((player) => player.id === move.playerId);
        state.lastAction = `${readyPlayer?.name ?? "A player"} is ready for round ${state.roundNumber + 1}. Waiting for opponent.`;
        break;
      }

      state.roundNumber += 1;
      resetForNextRound(state);
      state.status = "playing";
      state.lastAction = `Round ${state.roundNumber} started`;
      break;
    }
    case "rematch": {
      if (state.players.length !== 2) throw new Error("Need exactly 2 players");
      if (state.status !== "finished") throw new Error("Game is not finished");
      if (!state.rematchReadyPlayerIds.includes(move.playerId)) {
        state.rematchReadyPlayerIds.push(move.playerId);
      }

      if (state.rematchReadyPlayerIds.length < state.players.length) {
        const readyPlayer = state.players.find((player) => player.id === move.playerId);
        state.lastAction = `${readyPlayer?.name ?? "A player"} is ready for a rematch. Waiting for opponent.`;
        break;
      }

      resetForNewMatch(state);
      break;
    }
    case "play": {
      assertTurn(state, move.playerId);
      const result = removeCard(state.hands[move.playerId], move.cardId);
      const pile = state.expeditions[move.playerId][result.card.suit] ?? [];
      const lastNumber = [...pile].reverse().find((card) => card.kind === "number");
      if (result.card.kind === "wager" && pile.some((card) => card.kind === "number")) {
        throw new Error("Wagers must be played before number cards");
      }
      if (result.card.kind === "number" && lastNumber && result.card.value < lastNumber.value) {
        throw new Error("Cards must ascend in each expedition");
      }
      state.hands[move.playerId] = result.hand;
      state.expeditions[move.playerId][result.card.suit] = [...pile, result.card];
      state.lastAction = `Played ${result.card.suit} ${result.card.kind === "wager" ? "wager" : result.card.value}`;
      break;
    }
    case "discard": {
      assertTurn(state, move.playerId);
      const result = removeCard(state.hands[move.playerId], move.cardId);
      state.hands[move.playerId] = result.hand;
      state.discards[result.card.suit].push(result.card);
      state.lastAction = `Discarded ${result.card.suit} ${result.card.kind === "wager" ? "wager" : result.card.value}`;
      break;
    }
    case "drawDeck": {
      assertTurn(state, move.playerId);
      const card = state.deck.shift();
      if (!card) {
        finalizeRound(state);
        break;
      }
      state.hands[move.playerId].push(card);
      if (state.deck.length === 0) {
        finalizeRound(state);
      } else {
        state.currentPlayerId = nextPlayer(state, move.playerId);
        state.lastAction = "Drew from deck";
      }
      break;
    }
    case "drawDiscard": {
      assertTurn(state, move.playerId);
      const card = state.discards[move.suit].pop();
      if (!card) throw new Error("Discard pile is empty");
      state.hands[move.playerId].push(card);
      state.currentPlayerId = nextPlayer(state, move.playerId);
      state.lastAction = `Drew from ${move.suit} discard`;
      break;
    }
  }

  for (const mod of getEnabledModules(state.enabledModules)) {
    state = mod.onAfterMove ? mod.onAfterMove(state, move) : state;
  }

  return state;
}

export function scorePlayer(state: GameState, playerId: string) {
  const expeditions = state.expeditions[playerId] ?? {};
  let total = 0;
  for (const pile of Object.values(expeditions)) {
    if (!pile || pile.length === 0) continue;
    const wagers = pile.filter((card) => card.kind === "wager").length;
    const sum = pile.reduce((acc, card) => acc + card.value, 0);
    total += (sum - 20) * (wagers + 1);
  }
  for (const mod of getEnabledModules(state.enabledModules)) {
    total += mod.scoreBonus?.(state, playerId) ?? 0;
  }
  return total;
}
