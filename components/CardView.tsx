import type { Card, Suit } from "@/lib/game/types";

const suitArt: Record<Suit, string> = {
  yellow: "/assets/cards/yellow.png",
  green: "/assets/cards/green.png",
  white: "/assets/cards/white.png",
  red: "/assets/cards/red.png",
  blue: "/assets/cards/blue.png",
};

const suitLabels: Record<Suit, string> = {
  yellow: "Desert",
  green: "Jungle",
  white: "Mountain",
  red: "Volcano",
  blue: "Ocean",
};

export function CardBack({ label = "Deck" }: { label?: string }) {
  return (
    <div className="relative h-36 w-24 hidden overflow-hidden rounded-xl border-2 border-amber-100 bg-slate-900 shadow-lg">
      <img src="/assets/cards/card-back.png" alt="Card back" className="h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-x-1 bottom-2 rounded-md bg-black/55 px-1 py-1 text-center text-xs font-black uppercase text-white">
        {label}
      </div>
    </div>
  );
}

function CardFace({
  card,
  selected = false,
  compact = false,
  stacked = false,
}: {
  card: Card;
  selected?: boolean;
  compact?: boolean;
  stacked?: boolean;
}) {
  const badgeLabel = card.kind === "wager" ? "x2" : String(card.value);
  const cardSize = compact ? (stacked ? "h-28 w-[76px]" : "h-24 w-16") : "h-36 w-24";
  return (
    <div
      className={`relative ${cardSize} overflow-hidden rounded-xl border-2 bg-slate-900 text-left shadow-lg transition ${selected ? "-translate-y-2 scale-105 border-white ring-4 ring-amber-300/70" : "border-amber-100/80"}`}
      aria-label={`${suitLabels[card.suit]} ${card.kind === "wager" ? "wager x2" : card.value}`}
    >
      <img src={suitArt[card.suit]} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/70" />
      <div
        className={`absolute ${compact ? "left-0.5 top-0.5 h-8 w-10 rounded-lg" : "left-0.5 top-0.5 h-10 w-12 rounded-xl"} bg-white/95 shadow`}
        aria-hidden="true"
      />
      <div className={`absolute z-10 left-1 top-1 grid ${compact ? "h-7 w-8 text-sm" : "h-9 w-11 text-lg"} place-items-center rounded-lg bg-white/90 font-black text-slate-950 shadow`}>
        {badgeLabel}
      </div>
      <div className={`absolute inset-x-2 bottom-2 rounded-md bg-black/55 px-2 py-1 text-center ${compact ? "text-[8px]" : "text-[10px]"} font-black uppercase tracking-wide text-white`}>
        {suitLabels[card.suit]}
      </div>
    </div>
  );
}

export function CardView({
  card,
  selected,
  onClick,
  compact = false,
  stacked = false,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  compact?: boolean;
  stacked?: boolean;
}) {
  if (!onClick) return <CardFace card={card} selected={selected} compact={compact} stacked={stacked} />;

  return (
    <button onClick={onClick} className="transition hover:-translate-y-1" aria-label={`Select ${suitLabels[card.suit]} card`} draggable={false}>
      <CardFace card={card} selected={selected} compact={compact} stacked={stacked} />
    </button>
  );
}
