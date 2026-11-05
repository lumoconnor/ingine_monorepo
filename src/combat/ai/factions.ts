import factionsJson from '@/content/combat/factions.json';

/** Who fights whom. Content: src/content/combat/factions.json. Hostility goes both ways. */
export interface FactionDef {
  name: string;
  hostile: string[];
}

export const Factions: Record<string, FactionDef> = structuredClone(factionsJson as Record<string, FactionDef>);

export function registerFaction(id: string, def: FactionDef): void {
  Factions[id] = def;
}

export function isHostile(a: string, b: string): boolean {
  if (a === b) return false;
  return !!(Factions[a]?.hostile.includes(b) || Factions[b]?.hostile.includes(a));
}

/** Turn two factions on each other (you attacked the townsfolk). */
export function declareHostile(a: string, b: string): void {
  if (a === b || isHostile(a, b)) return;
  (Factions[a] ??= { name: a, hostile: [] }).hostile.push(b);
}
