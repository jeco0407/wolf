import type { DeathCause, Seat } from "./types";

export interface NightOutcome {
  knife: Seat | null;
  guard: Seat | null;
  saved: boolean;
  poison: Seat | null;
}

// 夜晚結算：守衛與解藥各自能擋刀，但同守同救會抵銷（仍然死亡）；毒藥無視守護
export function resolveNight({ knife, guard, saved, poison }: NightOutcome): { seat: Seat; cause: DeathCause }[] {
  const deaths = new Map<Seat, DeathCause>();
  if (knife !== null && (guard === knife) === saved) deaths.set(knife, "wolf");
  if (poison !== null) deaths.set(poison, "poison");
  return [...deaths].map(([seat, cause]) => ({ seat, cause })).sort((a, b) => a.seat - b.seat);
}
