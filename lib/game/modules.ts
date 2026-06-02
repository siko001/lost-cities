import type { GameModule } from "./types";

export const baseModule: GameModule = {
  id: "base",
  name: "Base Game",
};

export const longJourneyModule: GameModule = {
  id: "long-journey",
  name: "Long Journey Bonus",
  scoreBonus(state, playerId) {
    const expeditions = state.expeditions[playerId] ?? {};
    return Object.values(expeditions).reduce((bonus, cards) => {
      return bonus + ((cards?.length ?? 0) >= 8 ? 20 : 0);
    }, 0);
  },
};

export const modules: Record<string, GameModule> = {
  [baseModule.id]: baseModule,
  [longJourneyModule.id]: longJourneyModule,
};

export function getEnabledModules(ids: string[]) {
  return ids.map((id) => modules[id]).filter(Boolean);
}
