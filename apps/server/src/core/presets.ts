/**
 * Play-style presets: one click that sets a coherent bundle of game settings
 * instead of asking someone to reason about sixty multipliers.
 *
 * A preset is written in terms of catalogue *keys* (XPMultiplier, ...) rather
 * than full INI ids, so adding a setting to catalog.ts is enough to make it
 * usable here. resolve() turns a preset into the `file:section:key -> value`
 * map that core/config.ts writes, and refuses to silently skip a typo.
 *
 * Presets only ever touch INI settings. Mods, ports, passwords and launch
 * flags are deliberately left alone - those belong to a setup (core/setups.ts).
 */

import { SETTINGS } from './catalog.js';
import { settingId } from './config.js';

export interface PresetDef {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  /** Three or four plain-English consequences, shown on the preset card. */
  highlights: string[];
  /** Catalogue key -> value. Keys are validated against SETTINGS on resolve. */
  values: Record<string, string>;
}

/** Every catalogued setting back at its documented default. */
function officialValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of SETTINGS) {
    // Identity-ish keys are owned by the server form, not by a play style.
    if (def.key === 'MaxPlayers' || def.key === 'BanListURL' || def.key === 'RCONServerGameLogBuffer') continue;
    out[def.key] = def.default;
  }
  return out;
}

export const PRESETS: PresetDef[] = [
  // ------------------------------------------------------------- creative
  {
    id: 'creative',
    name: 'Creative',
    icon: '🎨',
    tagline: 'Build first, survive never',
    description:
      'A sandbox. Everything is unlocked, nothing decays, taming and breeding are near-instant and the world mostly leaves you alone. Use it for building, testing mods, or messing about.',
    highlights: [
      'All engrams unlocked, free mindwipes, creative mode available',
      'Taming and breeding near-instant, hunger and thirst barely move',
      'PvE, no structure decay, cave building and no placement collision',
      'Huge structure limits and a very fast resource respawn',
    ],
    values: {
      XPMultiplier: '25.0',
      HarvestAmountMultiplier: '20.0',
      HarvestHealthMultiplier: '0.2',
      TamingSpeedMultiplier: '100.0',
      ResourcesRespawnPeriodMultiplier: '0.1',
      ItemStackSizeMultiplier: '10.0',
      CraftingSkillBonusMultiplier: '5.0',

      MatingIntervalMultiplier: '0.01',
      EggHatchSpeedMultiplier: '50.0',
      BabyMatureSpeedMultiplier: '50.0',
      BabyFoodConsumptionSpeedMultiplier: '0.1',
      BabyCuddleIntervalMultiplier: '0.01',
      BabyImprintAmountMultiplier: '100.0',
      LayEggIntervalMultiplier: '0.1',
      AllowRaidDinoFeeding: 'True',

      PlayerCharacterFoodDrainMultiplier: '0.1',
      PlayerCharacterWaterDrainMultiplier: '0.1',
      PlayerCharacterStaminaDrainMultiplier: '0.1',
      PlayerCharacterHealthRecoveryMultiplier: '10.0',
      PlayerResistanceMultiplier: '0.1',
      bAllowUnlimitedRespecs: 'True',
      bAutoUnlockAllEngrams: 'True',
      bShowCreativeMode: 'True',
      bUseCorpseLocator: 'True',

      DinoDamageMultiplier: '0.5',
      TamedDinoDamageMultiplier: '3.0',
      TamedDinoResistanceMultiplier: '0.2',
      DinoCharacterFoodDrainMultiplier: '0.1',
      DinoCountMultiplier: '0.5',
      MaxTamedDinos: '20000',
      MaxPersonalTamedDinos: '0',
      bAllowFlyerSpeedLeveling: 'True',
      AllowFlyerCarryPvE: 'True',
      bForceCanRideFliers: 'True',

      StructureResistanceMultiplier: '0.1',
      TheMaxStructuresInRange: '50000',
      AlwaysAllowStructurePickup: 'True',
      StructurePickupTimeAfterPlacement: '600.0',
      StructurePickupHoldDuration: '0.0',
      DisableStructureDecayPvE: 'True',
      AllowCaveBuildingPvE: 'True',
      bAllowPlatformSaddleMultiFloors: 'True',
      bDisableStructurePlacementCollision: 'True',
      PlatformSaddleBuildAreaBoundsMultiplier: '3.0',

      GlobalSpoilingTimeMultiplier: '10.0',
      GlobalItemDecompositionTimeMultiplier: '10.0',
      GlobalCorpseDecompositionTimeMultiplier: '10.0',
      CropGrowthSpeedMultiplier: '10.0',
      CropDecaySpeedMultiplier: '0.1',
      SupplyCrateLootQualityMultiplier: '3.0',

      serverPVE: 'True',
      ServerHardcore: 'False',
      DisableFriendlyFire: 'True',

      KickIdlePlayersPeriod: '0',
      AutoSavePeriodMinutes: '15.0',
    },
  },

  // ----------------------------------------------------------------- easy
  {
    id: 'easy',
    name: 'Easy',
    icon: '🌤️',
    tagline: 'ARK without the grind',
    description:
      'For a small group that wants the game, not a second job. Generous rates, fast breeding and forgiving survival - you still tame and build, it just takes an evening rather than a fortnight.',
    highlights: [
      'x5 harvest, x10 taming, x3 XP - an evening gets you a base and a bird',
      'Breeding in minutes, and imprinting you can actually keep up with',
      'PvE, no structure decay, cave building allowed',
      'Food, water and stamina drain at half speed',
    ],
    values: {
      XPMultiplier: '3.0',
      HarvestAmountMultiplier: '5.0',
      HarvestHealthMultiplier: '0.5',
      TamingSpeedMultiplier: '10.0',
      ResourcesRespawnPeriodMultiplier: '0.5',
      ItemStackSizeMultiplier: '5.0',
      CraftingSkillBonusMultiplier: '2.0',

      MatingIntervalMultiplier: '0.1',
      EggHatchSpeedMultiplier: '20.0',
      BabyMatureSpeedMultiplier: '20.0',
      BabyFoodConsumptionSpeedMultiplier: '0.3',
      BabyCuddleIntervalMultiplier: '0.05',
      BabyImprintAmountMultiplier: '3.0',
      LayEggIntervalMultiplier: '0.5',

      PlayerCharacterFoodDrainMultiplier: '0.5',
      PlayerCharacterWaterDrainMultiplier: '0.5',
      PlayerCharacterStaminaDrainMultiplier: '0.5',
      PlayerCharacterHealthRecoveryMultiplier: '2.0',
      PlayerResistanceMultiplier: '0.7',
      bAllowUnlimitedRespecs: 'True',
      bUseCorpseLocator: 'True',

      DinoDamageMultiplier: '0.8',
      DinoResistanceMultiplier: '1.0',
      TamedDinoDamageMultiplier: '1.5',
      TamedDinoResistanceMultiplier: '0.7',
      DinoCharacterFoodDrainMultiplier: '0.5',
      DinoCharacterHealthRecoveryMultiplier: '2.0',
      DinoCountMultiplier: '1.0',
      MaxTamedDinos: '8000',
      MaxPersonalTamedDinos: '0',
      AllowFlyerCarryPvE: 'True',

      StructureDamageMultiplier: '1.0',
      StructureResistanceMultiplier: '0.5',
      TheMaxStructuresInRange: '20000',
      AlwaysAllowStructurePickup: 'True',
      StructurePickupTimeAfterPlacement: '120.0',
      DisableStructureDecayPvE: 'True',
      PvEStructureDecayPeriodMultiplier: '3.0',
      AllowCaveBuildingPvE: 'True',

      GlobalSpoilingTimeMultiplier: '3.0',
      GlobalItemDecompositionTimeMultiplier: '3.0',
      GlobalCorpseDecompositionTimeMultiplier: '3.0',
      CropGrowthSpeedMultiplier: '3.0',
      SupplyCrateLootQualityMultiplier: '1.5',
      FishingLootQualityMultiplier: '1.5',
      DifficultyOffset: '1.0',
      OverrideOfficialDifficulty: '5.0',

      serverPVE: 'True',
      ServerHardcore: 'False',
      DisableFriendlyFire: 'True',
      PreventOfflinePvP: 'False',

      KickIdlePlayersPeriod: '0',
      AutoSavePeriodMinutes: '10.0',
    },
  },

  // --------------------------------------------------------------- medium
  {
    id: 'medium',
    name: 'Medium',
    icon: '⚖️',
    tagline: 'Boosted, but you still earn it',
    description:
      'The usual sweet spot for a friends server. Rates high enough that a weeknight is worth playing, low enough that a bred giga still means something. Pick this one if you are not sure.',
    highlights: [
      'x3 harvest, x5 taming, x2 XP - progress without a grind wall',
      'Breeding around ten times official: a wyvern in an evening, not a weekend',
      'PvE, with slow structure decay still running',
      'Survival rates close to official, so the game still bites',
    ],
    values: {
      XPMultiplier: '2.0',
      HarvestAmountMultiplier: '3.0',
      HarvestHealthMultiplier: '0.75',
      TamingSpeedMultiplier: '5.0',
      ResourcesRespawnPeriodMultiplier: '0.75',
      ItemStackSizeMultiplier: '3.0',
      CraftingSkillBonusMultiplier: '1.5',

      MatingIntervalMultiplier: '0.3',
      EggHatchSpeedMultiplier: '10.0',
      BabyMatureSpeedMultiplier: '10.0',
      BabyFoodConsumptionSpeedMultiplier: '0.5',
      BabyCuddleIntervalMultiplier: '0.1',
      BabyImprintAmountMultiplier: '2.0',
      LayEggIntervalMultiplier: '0.75',

      PlayerCharacterFoodDrainMultiplier: '0.8',
      PlayerCharacterWaterDrainMultiplier: '0.8',
      PlayerCharacterStaminaDrainMultiplier: '0.8',
      PlayerCharacterHealthRecoveryMultiplier: '1.5',
      PlayerResistanceMultiplier: '1.0',
      bAllowUnlimitedRespecs: 'True',
      bUseCorpseLocator: 'True',

      DinoDamageMultiplier: '1.0',
      DinoResistanceMultiplier: '1.0',
      TamedDinoDamageMultiplier: '1.2',
      TamedDinoResistanceMultiplier: '0.85',
      DinoCharacterFoodDrainMultiplier: '0.8',
      DinoCharacterHealthRecoveryMultiplier: '1.5',
      DinoCountMultiplier: '1.0',
      MaxTamedDinos: '5000',
      MaxPersonalTamedDinos: '500',

      StructureDamageMultiplier: '1.0',
      StructureResistanceMultiplier: '0.75',
      TheMaxStructuresInRange: '15000',
      AlwaysAllowStructurePickup: 'True',
      StructurePickupTimeAfterPlacement: '60.0',
      DisableStructureDecayPvE: 'False',
      PvEStructureDecayPeriodMultiplier: '2.0',
      AllowCaveBuildingPvE: 'True',

      GlobalSpoilingTimeMultiplier: '2.0',
      GlobalItemDecompositionTimeMultiplier: '2.0',
      GlobalCorpseDecompositionTimeMultiplier: '2.0',
      CropGrowthSpeedMultiplier: '2.0',
      SupplyCrateLootQualityMultiplier: '1.0',
      FishingLootQualityMultiplier: '1.0',
      DifficultyOffset: '1.0',
      OverrideOfficialDifficulty: '5.0',

      serverPVE: 'True',
      ServerHardcore: 'False',
      PreventOfflinePvP: 'False',

      KickIdlePlayersPeriod: '0',
      AutoSavePeriodMinutes: '15.0',
    },
  },

  // ----------------------------------------------------------------- hard
  {
    id: 'hard',
    name: 'Hard',
    icon: '🔥',
    tagline: 'PvP, level 180 wilds, no safety net',
    description:
      'Official rates or worse, with PvP on and offline raid protection off. Wild dinos hit harder and reach level 180, your tames are made of paper and food spoils fast. For people who miss losing things.',
    highlights: [
      'PvP on, no offline raid protection, longer respawn timers',
      'Wild level cap raised to 180, and half again as many of them',
      'Wild dinos deal 50% more damage and shrug off more of yours',
      'Slower harvest, faster spoiling, a hard 300-tame tribe cap',
    ],
    values: {
      XPMultiplier: '1.0',
      HarvestAmountMultiplier: '1.0',
      HarvestHealthMultiplier: '1.5',
      TamingSpeedMultiplier: '0.75',
      ResourcesRespawnPeriodMultiplier: '1.5',
      ItemStackSizeMultiplier: '1.0',
      CraftingSkillBonusMultiplier: '1.0',

      MatingIntervalMultiplier: '1.0',
      EggHatchSpeedMultiplier: '1.0',
      BabyMatureSpeedMultiplier: '1.0',
      BabyFoodConsumptionSpeedMultiplier: '1.0',
      BabyCuddleIntervalMultiplier: '1.0',
      BabyImprintAmountMultiplier: '1.0',
      LayEggIntervalMultiplier: '1.0',
      AllowRaidDinoFeeding: 'False',

      PlayerCharacterFoodDrainMultiplier: '1.5',
      PlayerCharacterWaterDrainMultiplier: '1.5',
      PlayerCharacterStaminaDrainMultiplier: '1.25',
      PlayerCharacterHealthRecoveryMultiplier: '0.75',
      PlayerResistanceMultiplier: '1.25',
      bAllowUnlimitedRespecs: 'False',
      bUseCorpseLocator: 'False',

      DinoDamageMultiplier: '1.5',
      DinoResistanceMultiplier: '0.75',
      TamedDinoDamageMultiplier: '1.0',
      TamedDinoResistanceMultiplier: '1.25',
      DinoCharacterFoodDrainMultiplier: '1.25',
      DinoCharacterHealthRecoveryMultiplier: '1.0',
      DinoCountMultiplier: '1.5',
      MaxTamedDinos: '3000',
      MaxPersonalTamedDinos: '300',
      AllowFlyerCarryPvE: 'False',

      StructureDamageMultiplier: '1.5',
      StructureResistanceMultiplier: '1.25',
      TheMaxStructuresInRange: '10500',
      AlwaysAllowStructurePickup: 'False',
      StructurePickupTimeAfterPlacement: '30.0',
      DisableStructureDecayPvE: 'False',
      PvEStructureDecayPeriodMultiplier: '1.0',
      AllowCaveBuildingPvE: 'False',

      GlobalSpoilingTimeMultiplier: '0.75',
      GlobalItemDecompositionTimeMultiplier: '0.5',
      GlobalCorpseDecompositionTimeMultiplier: '0.5',
      CropGrowthSpeedMultiplier: '0.75',
      SupplyCrateLootQualityMultiplier: '1.0',
      FishingLootQualityMultiplier: '1.0',
      DifficultyOffset: '1.0',
      OverrideOfficialDifficulty: '6.0',

      serverPVE: 'False',
      ServerHardcore: 'False',
      EnablePvPGamma: 'False',
      DisableFriendlyFire: 'False',
      PreventOfflinePvP: 'False',
      bIncreasePvPRespawnInterval: 'True',

      KickIdlePlayersPeriod: '3600',
      AutoSavePeriodMinutes: '15.0',
    },
  },

  // ------------------------------------------------------------- official
  {
    id: 'official',
    name: 'Official',
    icon: '🎯',
    tagline: 'Vanilla rates, exactly as Wildcard ships them',
    description:
      'Resets every setting ASMS knows about back to its stock value. A clean slate before tuning your own, or a way back when a preset went further than you wanted.',
    highlights: [
      'Every curated multiplier back to 1.0',
      'Official difficulty - wild level cap 150',
      'Leaves ports, passwords, mods and launch flags alone',
    ],
    values: officialValues(),
  },
];

export function getPreset(id: string): PresetDef | undefined {
  return PRESETS.find((p) => p.id === id);
}

/**
 * Turn a preset into the `file:section:key -> value` map writeCurated wants.
 * Throws on a key that is not in the catalogue rather than dropping it, so a
 * typo surfaces the first time the preset is used instead of never.
 */
export function resolve(preset: PresetDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(preset.values)) {
    const def = SETTINGS.find((d) => d.key.toLowerCase() === key.toLowerCase());
    if (!def) throw new Error(`Preset "${preset.id}" refers to unknown setting "${key}"`);
    out[settingId(def)] = value;
  }
  return out;
}

export function resolveById(id: string): Record<string, string> {
  const preset = getPreset(id);
  if (!preset) throw new Error(`No preset called "${id}"`);
  return resolve(preset);
}
