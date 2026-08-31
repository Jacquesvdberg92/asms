/**
 * The curated knowledge base: which ARK maps exist, which settings are worth
 * a real form control, and what the RCON console can autocomplete.
 *
 * Anything NOT listed here is still fully editable through the raw INI editor —
 * this catalogue only decides what gets a friendly widget.
 */

export interface MapDef {
  code: string;
  name: string;
  official: boolean;
  note?: string;
}

export const MAPS: MapDef[] = [
  { code: 'TheIsland_WP', name: 'The Island', official: true },
  { code: 'ScorchedEarth_WP', name: 'Scorched Earth', official: true },
  { code: 'Aberration_WP', name: 'Aberration', official: true },
  { code: 'Extinction_WP', name: 'Extinction', official: true },
  { code: 'TheCenter_WP', name: 'The Center', official: true },
  { code: 'Astraeos_WP', name: 'Astraeos', official: true },
  { code: 'Ragnarok_WP', name: 'Ragnarok', official: true },
  { code: 'Valguero_WP', name: 'Valguero', official: true },
  { code: 'Svartalfheim_WP', name: 'Svartalfheim', official: false, note: 'Community map - also add its mod id under Mods' },
  { code: 'Amissa_WP', name: 'Amissa', official: false, note: 'Community map - also add its mod id under Mods' },
];

export type SettingType = 'float' | 'int' | 'bool' | 'string' | 'text';

export interface SettingDef {
  key: string;
  /** gus = GameUserSettings.ini, game = Game.ini */
  file: 'gus' | 'game';
  section: string;
  type: SettingType;
  default: string;
  label: string;
  group: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Hidden behind the "advanced" toggle in the UI. */
  advanced?: boolean;
}

const SS = 'ServerSettings';
const GM = '/script/shootergame.shootergamemode';

const rate = (
  key: string,
  label: string,
  group: string,
  def = '1.0',
  help?: string,
  file: 'gus' | 'game' = 'gus',
  section = SS,
): SettingDef => ({ key, file, section, type: 'float', default: def, label, group, help, min: 0, max: 100, step: 0.1 });

const flag = (
  key: string,
  label: string,
  group: string,
  def = 'False',
  help?: string,
  file: 'gus' | 'game' = 'gus',
  section = SS,
): SettingDef => ({ key, file, section, type: 'bool', default: def, label, group, help });

export const SETTINGS: SettingDef[] = [
  // ---------------------------------------------------------------- Rates
  rate('XPMultiplier', 'XP multiplier', 'Rates', '1.0', 'Global experience gain.'),
  rate('HarvestAmountMultiplier', 'Harvest amount', 'Rates', '1.0', 'How much you get per hit.'),
  rate('HarvestHealthMultiplier', 'Harvest health', 'Rates', '1.0', 'Durability of harvestable nodes - higher means more hits per node.'),
  rate('TamingSpeedMultiplier', 'Taming speed', 'Rates', '1.0'),
  rate('ResourcesRespawnPeriodMultiplier', 'Resource respawn period', 'Rates', '1.0', 'Lower is faster respawns.'),
  rate('ItemStackSizeMultiplier', 'Item stack size', 'Rates', '1.0'),
  rate('CraftingSkillBonusMultiplier', 'Crafting skill bonus', 'Rates', '1.0', undefined),
  rate('KillXPMultiplier', 'Kill XP', 'Rates', '1.0', undefined, 'game', GM),
  rate('HarvestXPMultiplier', 'Harvest XP', 'Rates', '1.0', undefined, 'game', GM),
  rate('CraftXPMultiplier', 'Craft XP', 'Rates', '1.0', undefined, 'game', GM),
  rate('GenericXPMultiplier', 'Generic XP', 'Rates', '1.0', undefined, 'game', GM),
  rate('SpecialXPMultiplier', 'Special XP', 'Rates', '1.0', undefined, 'game', GM),

  // -------------------------------------------------- Taming & breeding
  rate('MatingIntervalMultiplier', 'Mating interval', 'Breeding', '1.0', 'Lower means dinos can breed again sooner.', 'game', GM),
  rate('EggHatchSpeedMultiplier', 'Egg hatch speed', 'Breeding', '1.0', undefined, 'game', GM),
  rate('BabyMatureSpeedMultiplier', 'Baby maturation speed', 'Breeding', '1.0', undefined, 'game', GM),
  rate('BabyFoodConsumptionSpeedMultiplier', 'Baby food consumption', 'Breeding', '1.0', 'Lower means babies eat slower.', 'game', GM),
  rate('BabyCuddleIntervalMultiplier', 'Cuddle interval', 'Breeding', '1.0', 'Lower means imprint requests come more often.', 'game', GM),
  rate('BabyCuddleGracePeriodMultiplier', 'Cuddle grace period', 'Breeding', '1.0', undefined, 'game', GM),
  rate('BabyImprintAmountMultiplier', 'Imprint amount per cuddle', 'Breeding', '1.0', undefined, 'game', GM),
  rate('BabyImprintingStatScaleMultiplier', 'Imprint stat bonus scale', 'Breeding', '1.0', undefined, 'game', GM),
  rate('LayEggIntervalMultiplier', 'Egg lay interval', 'Breeding', '1.0', undefined, 'game', GM),
  flag('AllowRaidDinoFeeding', 'Allow feeding raid dinos (Titans/Wyverns)', 'Breeding', 'False'),
  rate('RaidDinoCharacterFoodDrainMultiplier', 'Raid dino food drain', 'Breeding', '1.0'),

  // -------------------------------------------------------------- Players
  rate('PlayerCharacterFoodDrainMultiplier', 'Player food drain', 'Players', '1.0'),
  rate('PlayerCharacterWaterDrainMultiplier', 'Player water drain', 'Players', '1.0'),
  rate('PlayerCharacterStaminaDrainMultiplier', 'Player stamina drain', 'Players', '1.0'),
  rate('PlayerCharacterHealthRecoveryMultiplier', 'Player health recovery', 'Players', '1.0'),
  rate('PlayerDamageMultiplier', 'Player damage', 'Players', '1.0'),
  rate('PlayerResistanceMultiplier', 'Player resistance', 'Players', '1.0', 'Lower means players take less damage.'),
  rate('OxygenSwimSpeedStatMultiplier', 'Oxygen swim speed', 'Players', '1.0'),
  {
    key: 'MaxPlayers',
    file: 'gus',
    section: '/Script/Engine.GameSession',
    type: 'int',
    default: '70',
    label: 'Max players (INI)',
    group: 'Players',
    help: 'ASA reads the real player cap from -WinLiveMaxPlayers, which ASMS sets from the server slots field. This INI value is kept in sync for tools that read it.',
    min: 1,
    max: 255,
    advanced: true,
  },
  flag('bAllowUnlimitedRespecs', 'Unlimited mindwipes', 'Players', 'False', undefined, 'game', GM),
  flag('bAutoUnlockAllEngrams', 'Auto-unlock all engrams', 'Players', 'False', undefined, 'game', GM),
  flag('bShowCreativeMode', 'Creative mode available', 'Players', 'False', undefined, 'game', GM),
  flag('bUseCorpseLocator', 'Show corpse locator beam', 'Players', 'True', undefined, 'game', GM),

  // ---------------------------------------------------------------- Dinos
  rate('DinoDamageMultiplier', 'Wild dino damage', 'Dinos', '1.0'),
  rate('DinoResistanceMultiplier', 'Wild dino resistance', 'Dinos', '1.0'),
  rate('TamedDinoDamageMultiplier', 'Tamed dino damage', 'Dinos', '1.0'),
  rate('TamedDinoResistanceMultiplier', 'Tamed dino resistance', 'Dinos', '1.0'),
  rate('DinoCharacterFoodDrainMultiplier', 'Dino food drain', 'Dinos', '1.0'),
  rate('DinoCharacterStaminaDrainMultiplier', 'Dino stamina drain', 'Dinos', '1.0'),
  rate('DinoCharacterHealthRecoveryMultiplier', 'Dino health recovery', 'Dinos', '1.0'),
  rate('DinoCountMultiplier', 'Wild dino count', 'Dinos', '1.0', 'Server restart required to take effect.'),
  rate('PoopIntervalMultiplier', 'Poop interval', 'Dinos', '1.0', undefined, 'game', GM),
  {
    key: 'MaxTamedDinos',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '5000',
    label: 'Max tamed dinos (server-wide)',
    group: 'Dinos',
    min: 0,
    max: 50000,
  },
  {
    key: 'MaxPersonalTamedDinos',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '0',
    label: 'Tame cap per tribe',
    group: 'Dinos',
    help: '0 disables the per-tribe cap.',
    min: 0,
    max: 5000,
  },
  flag('bAllowFlyerSpeedLeveling', 'Allow levelling flyer speed', 'Dinos', 'False', undefined, 'game', GM),
  flag('AllowFlyerCarryPvE', 'Flyers can carry wild dinos (PvE)', 'Dinos', 'False'),
  flag('bForceCanRideFliers', 'Allow flyers on maps that ban them', 'Dinos', 'False'),

  // ----------------------------------------------------------- Structures
  rate('StructureDamageMultiplier', 'Structure damage', 'Structures', '1.0'),
  rate('StructureResistanceMultiplier', 'Structure resistance', 'Structures', '1.0'),
  {
    key: 'TheMaxStructuresInRange',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '10500',
    label: 'Max structures in range',
    group: 'Structures',
    min: 1000,
    max: 100000,
  },
  flag('AlwaysAllowStructurePickup', 'Always allow structure pickup', 'Structures', 'True'),
  {
    key: 'StructurePickupTimeAfterPlacement',
    file: 'gus',
    section: SS,
    type: 'float',
    default: '30.0',
    label: 'Pickup window after placement (s)',
    group: 'Structures',
    min: 0,
    max: 600,
    step: 5,
  },
  {
    key: 'StructurePickupHoldDuration',
    file: 'gus',
    section: SS,
    type: 'float',
    default: '0.5',
    label: 'Pickup hold duration (s)',
    group: 'Structures',
    min: 0,
    max: 5,
    step: 0.1,
  },
  flag('DisableStructureDecayPvE', 'Disable structure decay (PvE)', 'Structures', 'False'),
  rate('PvEStructureDecayPeriodMultiplier', 'Structure decay period (PvE)', 'Structures', '1.0'),
  flag('AllowCaveBuildingPvE', 'Allow cave building (PvE)', 'Structures', 'False'),
  flag('bAllowPlatformSaddleMultiFloors', 'Multiple floors on platform saddles', 'Structures', 'False', undefined, 'game', GM),
  flag('bDisableStructurePlacementCollision', 'Ignore placement collision', 'Structures', 'False', undefined, 'game', GM),
  rate('PlatformSaddleBuildAreaBoundsMultiplier', 'Platform build area bounds', 'Structures', '1.0'),

  // ---------------------------------------------------------------- World
  rate('DayCycleSpeedScale', 'Day cycle speed', 'World', '1.0'),
  rate('DayTimeSpeedScale', 'Daytime speed', 'World', '1.0'),
  rate('NightTimeSpeedScale', 'Nighttime speed', 'World', '1.0'),
  {
    key: 'DifficultyOffset',
    file: 'gus',
    section: SS,
    type: 'float',
    default: '1.0',
    label: 'Difficulty offset',
    group: 'World',
    help: 'Use 1.0 together with an override below to raise the wild level cap.',
    min: 0,
    max: 1,
    step: 0.01,
  },
  {
    key: 'OverrideOfficialDifficulty',
    file: 'gus',
    section: SS,
    type: 'float',
    default: '5.0',
    label: 'Difficulty override',
    group: 'World',
    help: '5.0 gives max wild level 150. Every +1 adds 30 levels.',
    min: 0,
    max: 50,
    step: 0.5,
  },
  rate('GlobalSpoilingTimeMultiplier', 'Spoiling time', 'World', '1.0', 'Higher means food lasts longer.', 'game', GM),
  rate('GlobalItemDecompositionTimeMultiplier', 'Dropped item decay time', 'World', '1.0', undefined, 'game', GM),
  rate('GlobalCorpseDecompositionTimeMultiplier', 'Corpse decay time', 'World', '1.0', undefined, 'game', GM),
  rate('CropGrowthSpeedMultiplier', 'Crop growth speed', 'World', '1.0', undefined, 'game', GM),
  rate('CropDecaySpeedMultiplier', 'Crop decay speed', 'World', '1.0', undefined, 'game', GM),
  flag('bDisableLootCrates', 'Disable loot crates', 'World', 'False', undefined, 'game', GM),
  rate('SupplyCrateLootQualityMultiplier', 'Supply crate loot quality', 'World', '1.0'),
  rate('FishingLootQualityMultiplier', 'Fishing loot quality', 'World', '1.0'),

  // ------------------------------------------------------------ PvP / PvE
  flag('serverPVE', 'PvE mode (no player-vs-player damage)', 'PvP / PvE', 'False'),
  flag('ServerHardcore', 'Hardcore (death resets to level 1)', 'PvP / PvE', 'False'),
  flag('EnablePvPGamma', 'Allow gamma adjustment in PvP', 'PvP / PvE', 'False'),
  flag('DisableFriendlyFire', 'Disable tribe friendly fire', 'PvP / PvE', 'False'),
  flag('PreventOfflinePvP', 'Offline raid protection', 'PvP / PvE', 'False'),
  {
    key: 'PreventOfflinePvPInterval',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '900',
    label: 'Offline protection delay (s)',
    group: 'PvP / PvE',
    min: 0,
    max: 86400,
    step: 60,
  },
  flag('bIncreasePvPRespawnInterval', 'Increasing PvP respawn timer', 'PvP / PvE', 'False', undefined, 'game', GM),
  rate('PvPZoneStructureDamageMultiplier', 'PvP zone structure damage', 'PvP / PvE', '6.0', undefined, 'game', GM),

  // --------------------------------------------------------------- Tribes
  {
    key: 'MaxNumberOfPlayersInTribe',
    file: 'game',
    section: GM,
    type: 'int',
    default: '0',
    label: 'Max tribe members',
    group: 'Tribes',
    help: '0 means unlimited.',
    min: 0,
    max: 200,
  },
  {
    key: 'TribeNameChangeCooldown',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '15',
    label: 'Tribe rename cooldown (min)',
    group: 'Tribes',
    min: 0,
    max: 10080,
  },
  flag('PreventTribeAlliances', 'Prevent tribe alliances', 'Tribes', 'False'),
  flag('bPvEAllowTribeWar', 'Allow tribe wars (PvE)', 'Tribes', 'True', undefined, 'game', GM),

  // ------------------------------------------------------ Server & admin
  flag('ShowMapPlayerLocation', 'Show player location on map', 'Server', 'True'),
  flag('allowThirdPersonPlayer', 'Allow third person', 'Server', 'True'),
  flag('ServerCrosshair', 'Show crosshair', 'Server', 'True'),
  flag('ServerForceNoHUD', 'Force floating names off', 'Server', 'False'),
  flag('AllowHitMarkers', 'Show hit markers', 'Server', 'True'),
  flag('AdminLogging', 'Log admin commands to chat', 'Server', 'False'),
  flag('AllowHideDamageSourceFromLogs', 'Hide damage source in tribe logs', 'Server', 'True'),
  {
    key: 'AutoSavePeriodMinutes',
    file: 'gus',
    section: SS,
    type: 'float',
    default: '15.0',
    label: 'Autosave interval (min)',
    group: 'Server',
    min: 1,
    max: 240,
    step: 1,
  },
  {
    key: 'KickIdlePlayersPeriod',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '3600',
    label: 'Kick idle players after (s)',
    group: 'Server',
    min: 0,
    max: 86400,
    step: 60,
  },
  {
    key: 'RCONServerGameLogBuffer',
    file: 'gus',
    section: SS,
    type: 'int',
    default: '600',
    label: 'RCON game log buffer',
    group: 'Server',
    min: 100,
    max: 5000,
    advanced: true,
  },
  {
    key: 'BanListURL',
    file: 'gus',
    section: SS,
    type: 'string',
    default: '',
    label: 'Ban list URL',
    group: 'Server',
    help: 'Leave empty to use only your local ban list.',
    advanced: true,
  },
  flag('AutoDestroyDecayedDinos', 'Auto-destroy decayed dinos', 'Server', 'False'),
  flag('bUseSingleplayerSettings', 'Use singleplayer settings', 'Server', 'False', 'Applies the SP balance pass on top of your multipliers.', 'game', GM),
];

export const SETTING_GROUPS = [
  'Rates',
  'Breeding',
  'Players',
  'Dinos',
  'Structures',
  'World',
  'PvP / PvE',
  'Tribes',
  'Server',
];

export interface RconCommandDef {
  cmd: string;
  args?: string;
  help: string;
  danger?: boolean;
}

export const RCON_COMMANDS: RconCommandDef[] = [
  { cmd: 'ListPlayers', help: 'List connected players with their slot and platform id.' },
  { cmd: 'GetChat', help: 'Pull buffered chat since the last call.' },
  { cmd: 'Broadcast', args: '<message>', help: 'Big centre-screen message to everyone.' },
  { cmd: 'ServerChat', args: '<message>', help: 'Send a message into server chat.' },
  { cmd: 'ServerChatTo', args: '"<playerId>" <message>', help: 'Private message one player.' },
  { cmd: 'SaveWorld', help: 'Force a world save right now.' },
  { cmd: 'DoExit', help: 'Save and shut the server down.', danger: true },
  { cmd: 'DoRestartLevel', help: 'Restart the level without restarting the process.', danger: true },
  { cmd: 'KickPlayer', args: '<playerId>', help: 'Kick a player by platform id.' },
  { cmd: 'BanPlayer', args: '<playerId>', help: 'Ban a player by platform id.', danger: true },
  { cmd: 'UnbanPlayer', args: '<playerId>', help: 'Lift a ban.' },
  { cmd: 'AllowPlayerToJoinNoCheck', args: '<playerId>', help: 'Add to the whitelist.' },
  { cmd: 'DisallowPlayerToJoinNoCheck', args: '<playerId>', help: 'Remove from the whitelist.' },
  { cmd: 'SetTimeOfDay', args: '<hh:mm:ss>', help: 'Change the in-game clock.' },
  { cmd: 'DestroyWildDinos', help: 'Wipe and respawn all wild creatures. Tames are untouched.', danger: true },
  { cmd: 'DestroyAllTamedDinos', help: 'Destroy every tamed creature on the map, for every tribe.', danger: true },
  { cmd: 'DestroyAllEnemies', help: 'Destroy every non-player creature without triggering a respawn.', danger: true },
  { cmd: 'DestroyAll', args: '<ClassName>', help: 'Destroy every entity of a class.', danger: true },
  { cmd: 'ShowMessageOfTheDay', help: 'Re-display the MOTD.' },
  { cmd: 'GetGameLog', help: 'Fetch the buffered game log.' },
  { cmd: 'ListPlayerSteamIDs', help: 'List players with platform ids.' },
  { cmd: 'GetServerInfo', help: 'Server build and uptime info.' },
  { cmd: 'SetMessageOfTheDay', args: '<message>', help: 'Change the MOTD until restart.' },
  { cmd: 'DestroyWildDinoClasses', args: '<ClassName> <radius>', help: 'Targeted wild wipe.', danger: true },
  { cmd: 'ForceTame', args: '', help: 'Tame what the admin is looking at (console only).' },
  { cmd: 'Slomo', args: '<multiplier>', help: 'Change game speed. 1 is normal.', danger: true },
];

/** Launch flags surfaced as switches, with the argument each one produces. */
export const LAUNCH_FLAG_GROUPS = ['Dinos', 'Players & joining', 'Logging', 'World', 'Performance & anti-cheat', 'Mods & config'];

export const LAUNCH_FLAGS: Array<{
  key: string;
  arg: string;
  label: string;
  group: string;
  help: string;
  recommended?: boolean;
  /** Shown with a warning tint: these change or destroy world content. */
  danger?: boolean;
}> = [
  // ------------------------------------------------------------------ dinos
  {
    key: 'forceAllowCaveFlyers',
    arg: '-ForceAllowCaveFlyers',
    label: 'Allow flyers in caves',
    group: 'Dinos',
    help: 'Lets tamed flyers into cave systems, which official servers block. Pair it with "Allow flyers on maps that ban them" under Game settings for Aberration.',
  },
  {
    key: 'forceRespawnDinos',
    arg: '-ForceRespawnDinos',
    label: 'Force respawn dinos',
    group: 'Dinos',
    help: 'Wipes and respawns every wild creature on the next boot. One-shot: turn it back off afterwards.',
    danger: true,
  },
  {
    key: 'noWildBabies',
    arg: '-NoWildBabies',
    label: 'No wild babies',
    group: 'Dinos',
    help: 'Stops wild creatures spawning as babies, which some people find clutters the map.',
  },
  {
    key: 'unstasisDinoObstruction',
    arg: '-UnstasisDinoObstruction',
    label: 'Check obstruction when unstasising',
    group: 'Dinos',
    help: 'Stops dinos waking up inside terrain or structures after being out of range.',
  },
  {
    key: 'noAI',
    arg: '-NoAI',
    label: 'Disable creature AI',
    group: 'Dinos',
    help: 'Creatures stand still and do nothing. A debugging switch, not a play setting.',
    danger: true,
  },
  {
    key: 'noDinos',
    arg: '-NoDinos',
    label: 'No creatures at all',
    group: 'Dinos',
    help: 'The world spawns with no wild creatures whatsoever. A debugging switch.',
    danger: true,
  },

  // ------------------------------------------------------- players & joining
  { key: 'crossplay', arg: '-crossplay', label: 'Enable crossplay', group: 'Players & joining', help: 'Let console and PC players join the same server.' },
  {
    key: 'noBattlEye',
    arg: '-NoBattlEye',
    label: 'Disable BattlEye',
    group: 'Players & joining',
    help: 'Players must also join with BattlEye off. Cuts a common source of random kicks.',
  },
  { key: 'exclusiveJoin', arg: '-exclusivejoin', label: 'Whitelist only', group: 'Players & joining', help: 'Only players on the whitelist may join.' },
  {
    key: 'noTransferFromFiltering',
    arg: '-NoTransferFromFiltering',
    label: 'No transfer filtering',
    group: 'Players & joining',
    help: 'Allows uploads from any server in a cluster.',
  },

  // ---------------------------------------------------------------- logging
  {
    key: 'serverGameLog',
    arg: '-servergamelog',
    label: 'Write game log',
    group: 'Logging',
    help: 'Required for the Logs tab, for GetGameLog over RCON, and for ASMS to spot when the server has finished booting.',
    recommended: true,
  },
  { key: 'includeTribeLogs', arg: '-servergamelogincludetribelogs', label: 'Include tribe logs', group: 'Logging', help: 'Adds tribe events to the game log.' },
  { key: 'rconOutputTribeLogs', arg: '-ServerRCONOutputTribeLogs', label: 'Tribe logs over RCON', group: 'Logging', help: 'Streams tribe events to RCON clients.' },

  // ------------------------------------------------------------------ world
  {
    key: 'autoDestroyStructures',
    arg: '-AutoDestroyStructures',
    label: 'Auto-destroy old structures',
    group: 'World',
    help: 'Cleans up structures that have passed their decay time. Works with the decay settings under Game settings.',
    danger: true,
  },
  {
    key: 'disableCustomCosmetics',
    arg: '-DisableCustomCosmetics',
    label: 'Disable custom cosmetics',
    group: 'World',
    help: 'Blocks cosmetic mods.',
  },

  // ------------------------------------------------- performance & anti-cheat
  {
    key: 'noHangDetection',
    arg: '-NoHangDetection',
    label: 'Disable hang detection',
    group: 'Performance & anti-cheat',
    help: 'Useful on slow disks where a long save looks like a hang and the server kills itself.',
  },
  {
    key: 'stasisKeepControllers',
    arg: '-StasisKeepControllers',
    label: 'Keep controllers in stasis',
    group: 'Performance & anti-cheat',
    help: 'Reduces the stutter when creatures come back into range, at the cost of some memory.',
  },
  {
    key: 'alwaysTickDedicatedSkeletalMeshes',
    arg: '-AlwaysTickDedicatedSkeletalMeshes',
    label: 'Always tick skeletal meshes',
    group: 'Performance & anti-cheat',
    help: 'Fixes some animation and hit-detection oddities on a dedicated server. Costs CPU.',
  },
  {
    key: 'useServerNetSpeedCheck',
    arg: '-UseServerNetSpeedCheck',
    label: 'Server-side net speed check',
    group: 'Performance & anti-cheat',
    help: 'Validates movement speed on the server rather than trusting the client.',
  },
  {
    key: 'noAntiSpeedHack',
    arg: '-noantispeedhack',
    label: 'Disable speed-hack detection',
    group: 'Performance & anti-cheat',
    help: 'Turn this on only if legitimate players are being kicked for speed hacking.',
  },
  {
    key: 'ignoreDupedItems',
    arg: '-IgnoreDupedItems',
    label: 'Ignore duped items',
    group: 'Performance & anti-cheat',
    help: 'Stops the server destroying items it believes were duplicated. Useful after a bad restore.',
  },

  // ---------------------------------------------------------- mods & config
  { key: 'automanagedmods', arg: '-automanagedmods', label: 'Auto-manage mods', group: 'Mods & config', help: 'Let the server update mods on boot.' },
  {
    key: 'useDynamicConfig',
    arg: '-UseDynamicConfig',
    label: 'Use dynamic config',
    group: 'Mods & config',
    help: 'Honours the event and rate config Wildcard pushes to official servers.',
  },
];

/** Seasonal events, applied as -ActiveEvent=<name>. */
export const ACTIVE_EVENTS: Array<{ id: string; label: string }> = [
  { id: '', label: 'None' },
  { id: 'Easter', label: 'Eggcellent Adventure (Easter)' },
  { id: 'Summer', label: 'Summer Bash' },
  { id: 'FearEvolved', label: 'Fear Evolved (Halloween)' },
  { id: 'TurkeyTrial', label: 'Turkey Trial (Thanksgiving)' },
  { id: 'WinterWonderland', label: 'Winter Wonderland' },
  { id: 'Valentines', label: 'Love Evolved (Valentines)' },
  { id: 'Birthday', label: 'ARK Anniversary' },
  { id: 'Pride', label: 'Pride' },
];
