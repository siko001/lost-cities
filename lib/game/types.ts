export type Suit = "red" | "blue" | "green" | "yellow" | "white";
export type CardKind = "wager" | "number";

export type Card = {
  id: string;
  suit: Suit;
  kind: CardKind;
  value: number;
};

export type Player = {
  id: string;
  name: string;
};

export type Expedition = Partial<Record<Suit, Card[]>>;
export type Discards = Record<Suit, Card[]>;

export type GameState = {
  version: 1;
  status: "waiting" | "playing" | "round-over" | "finished";
  roomCode: string;
  players: Player[];
  currentPlayerId: string | null;
  deck: Card[];
  hands: Record<string, Card[]>;
  expeditions: Record<string, Expedition>;
  discards: Discards;
  roundNumber: number;
  roundScores: Record<string, number>;
  totalScores: Record<string, number>;
  roundHistory: Array<{ round: number; scores: Record<string, number> }>;
  roundReadyPlayerIds: string[];
  rematchReadyPlayerIds: string[];
  lastAction: string;
  enabledModules: string[];
  moduleState: Record<string, unknown>;
};

export type Move =
  | { type: "join"; player: Player }
  | { type: "start" }
  | { type: "startRound"; playerId: string }
  | { type: "rematch"; playerId: string }
  | { type: "play"; playerId: string; cardId: string }
  | { type: "discard"; playerId: string; cardId: string }
  | { type: "drawDeck"; playerId: string }
  | { type: "drawDiscard"; playerId: string; suit: Suit };

export type GameModule = {
  id: string;
  name: string;
  extendDeck?: (cards: Card[]) => Card[];
  onBeforeMove?: (state: GameState, move: Move) => GameState;
  onAfterMove?: (state: GameState, move: Move) => GameState;
  scoreBonus?: (state: GameState, playerId: string) => number;
};
