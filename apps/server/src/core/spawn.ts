/**
 * The spawn catalogue: creature entity ids and item blueprint paths, so the
 * Spawn tab can offer "Rex" by name instead of asking someone to remember how
 * to spell `Rex_Character_BP_C` at bedtime.
 *
 * These identifiers are ARK's own. They are the class names Wildcard ships
 * inside the game's asset files, which is why every admin tool, wiki and
 * community site quotes exactly the same strings - there is only one correct
 * spelling of each. The list here was assembled from the ARK Official
 * Community Wiki and trimmed to what people actually ask for on a family
 * server.
 *
 * Dododex is credited and linked rather than copied: the UI sends you there
 * for the part Dododex actually authors - taming times, food counts, stat
 * calculators and strategy - instead of reproducing any of it. See
 * SPAWN_SOURCES, which the Spawn tab renders as visible credit.
 */

export interface SpawnCreature {
  /** Display name. */
  name: string;
  /** Entity id / class name, as taken by Summon and GMSummon. */
  cls: string;
  group: string;
  /** GFI code of the saddle it wears, so gear can follow the creature. */
  saddle?: string;
  /** Extra words the search box should match. */
  tags?: string;
  /** Popular enough to pin at the top of the list. */
  fav?: boolean;
  /** Bosses and titans get a confirmation before anyone drops one on a base. */
  boss?: boolean;
}

export interface SpawnItem {
  name: string;
  /** Short fragment taken by GFI. */
  gfi: string;
  /**
   * Full blueprint path, which is what GiveItemToPlayer needs.
   *
   * Absent where the path could not be confirmed against the wiki tables. A
   * wrong path does not error - ARK just quietly hands over nothing - so the
   * UI would rather offer only the GFI route than a give that silently fails.
   */
  path?: string;
  group: string;
  /** A sensible starting quantity for the amount box. */
  qty?: number;
  tags?: string;
}

export interface SpawnKitItem {
  gfi: string;
  qty: number;
  /** 0-100. Armour and weapons are worth handing over at full quality. */
  quality?: number;
}

export interface SpawnKit {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  items: SpawnKitItem[];
}

export interface SpawnSource {
  name: string;
  url: string;
  note: string;
}

// ---------------------------------------------------------------- creatures

const c = (name: string, cls: string, group: string, extra: Partial<SpawnCreature> = {}): SpawnCreature => ({
  name,
  cls,
  group,
  ...extra,
});

export const CREATURE_GROUPS = [
  'Land',
  'Flyers',
  'Water',
  'Small & utility',
  'Aberration',
  'Extinction',
  'Bosses & titans',
  'Variants & event',
];

export const CREATURES: SpawnCreature[] = [
  // ------------------------------------------------------------------ Land
  c('Rex', 'Rex_Character_BP_C', 'Land', { saddle: 'RexSaddle', fav: true, tags: 't-rex tyrannosaurus' }),
  c('Giganotosaurus', 'Gigant_Character_BP_C', 'Land', { saddle: 'GigantSaddle', fav: true, tags: 'giga' }),
  c('Spino', 'Spino_Character_BP_C', 'Land', { saddle: 'SpinoSaddle', fav: true, tags: 'spinosaurus' }),
  c('Raptor', 'Raptor_Character_BP_C', 'Land', { saddle: 'RaptorSaddle', fav: true }),
  c('Triceratops', 'Trike_Character_BP_C', 'Land', { saddle: 'TrikeSaddle', fav: true, tags: 'trike' }),
  c('Parasaur', 'Para_Character_BP_C', 'Land', { saddle: 'ParaSaddle', fav: true }),
  c('Stegosaurus', 'Stego_Character_BP_C', 'Land', { saddle: 'StegoSaddle', tags: 'stego' }),
  c('Ankylosaurus', 'Ankylo_Character_BP_C', 'Land', { saddle: 'AnkyloSaddle', tags: 'ankylo metal harvest' }),
  c('Doedicurus', 'Doed_Character_BP_C', 'Land', { saddle: 'DoedSaddle', tags: 'doed stone harvest' }),
  c('Brontosaurus', 'Sauropod_Character_BP_C', 'Land', { saddle: 'SauroSaddle', tags: 'bronto sauropod' }),
  c('Diplodocus', 'Diplodocus_Character_BP_C', 'Land', { saddle: 'DiplodocusSaddle', tags: 'diplo' }),
  c('Paraceratherium', 'Paracer_Character_BP_C', 'Land', { saddle: 'Paracer_Saddle', tags: 'paracer' }),
  c('Carnotaurus', 'Carno_Character_BP_C', 'Land', { saddle: 'CarnoSaddle', tags: 'carno' }),
  c('Allosaurus', 'Allo_Character_BP_C', 'Land', { saddle: 'AlloSaddle', tags: 'allo' }),
  c('Baryonyx', 'Baryonyx_Character_BP_C', 'Land', { saddle: 'BaryonyxSaddle', tags: 'bary' }),
  c('Carcharodontosaurus', 'Carcha_Character_BP_C', 'Land', { saddle: 'CarchaSaddle', tags: 'carcha' }),
  c('Acrocanthosaurus', 'Acrocanthosaurus_Character_BP_C', 'Land', { tags: 'acro' }),
  c('Ceratosaurus', 'Ceratosaurus_Character_BP_ASA_C', 'Land', { tags: 'cerato' }),
  c('Therizinosaur', 'Therizino_Character_BP_C', 'Land', { saddle: 'TherizinosaurusSaddle', tags: 'theri' }),
  c('Yutyrannus', 'Yutyrannus_Character_BP_C', 'Land', { saddle: 'YutySaddle', tags: 'yuty roar' }),
  c('Megalosaurus', 'Megalosaurus_Character_BP_C', 'Land', { saddle: 'MegalosaurusSaddle' }),
  c('Sabertooth', 'Saber_Character_BP_C', 'Land', { saddle: 'SaberSaddle', tags: 'saber' }),
  c('Direwolf', 'Direwolf_Character_BP_C', 'Land', { tags: 'wolf' }),
  c('Dire Bear', 'Direbear_Character_BP_C', 'Land', { saddle: 'DireBearSaddle', tags: 'bear' }),
  c('Thylacoleo', 'Thylacoleo_Character_BP_C', 'Land', { saddle: 'ThylacoSaddle', tags: 'thyla climb' }),
  c('Megatherium', 'Megatherium_Character_BP_C', 'Land', { saddle: 'MegatheriumSaddle', tags: 'sloth' }),
  c('Mammoth', 'Mammoth_Character_BP_C', 'Land', { saddle: 'MammothSaddle' }),
  c('Woolly Rhino', 'Rhino_Character_BP_C', 'Land', { saddle: 'RhinoSaddle', tags: 'rhino' }),
  c('Castoroides', 'Beaver_Character_BP_C', 'Land', { saddle: 'BeaverSaddle', tags: 'beaver' }),
  c('Chalicotherium', 'Chalico_Character_BP_C', 'Land', { saddle: 'ChalicoSaddle', tags: 'chalico' }),
  c('Daeodon', 'Daeodon_Character_BP_C', 'Land', { saddle: 'DaeodonSaddle', tags: 'pig healer' }),
  c('Megaloceros', 'Stag_Character_BP_C', 'Land', { saddle: 'StagSaddle', tags: 'stag deer' }),
  c('Equus', 'Equus_Character_BP_C', 'Land', { saddle: 'EquusSaddle', tags: 'horse' }),
  c('Unicorn', 'Equus_Character_BP_Unicorn_C', 'Land', { saddle: 'EquusSaddle', tags: 'horse rare' }),
  c('Procoptodon', 'Procoptodon_Character_BP_C', 'Land', { saddle: 'ProcoptodonSaddle', tags: 'kangaroo' }),
  c('Gigantopithecus', 'Bigfoot_Character_BP_C', 'Land', { tags: 'bigfoot ape' }),
  c('Iguanodon', 'Iguanodon_Character_BP_C', 'Land', { saddle: 'IguanodonSaddle' }),
  c('Pachy', 'Pachy_Character_BP_C', 'Land', { saddle: 'PachySaddle' }),
  c('Pachyrhinosaurus', 'Pachyrhino_Character_BP_C', 'Land', { saddle: 'PachyrhinoSaddle' }),
  c('Kentrosaurus', 'Kentro_Character_BP_C', 'Land', { tags: 'kentro' }),
  c('Gallimimus', 'Galli_Character_BP_C', 'Land', { saddle: 'Gallimimus', tags: 'galli' }),
  c('Terror Bird', 'TerrorBird_Character_BP_C', 'Land', { saddle: 'TerrorBirdSaddle' }),
  c('Hyaenodon', 'Hyaenodon_Character_BP_C', 'Land', { saddle: 'HyaenodonSaddle', tags: 'hyena' }),
  c('Kaprosuchus', 'Kaprosuchus_Character_BP_C', 'Land', { saddle: 'KaprosuchusSaddle', tags: 'kapro' }),
  c('Sarco', 'Sarco_Character_BP_C', 'Land', { saddle: 'SarcoSaddle', tags: 'crocodile' }),
  c('Deinosuchus', 'Deinosuchusasa_Character_BP_C', 'Land', { tags: 'croc' }),
  c('Deinotherium', 'DeinotheriumASA_Character_BP_C', 'Land', { tags: 'elephant' }),
  c('Deinonychus', 'Deinonychus_Character_BP_C', 'Land', { saddle: 'DeinonychusSaddle', tags: 'deino valguero' }),
  c('Gigantoraptor', 'Gigantoraptor_Character_BP_C', 'Land'),
  c('Fasolasuchus', 'Fasola_Character_BP_C', 'Land', { tags: 'fasola' }),
  c('Megalania', 'Megalania_Character_BP_C', 'Land', { saddle: 'MegalaniaSaddle', tags: 'lizard climb' }),
  c('Purlovia', 'Purlovia_Character_BP_C', 'Land'),
  c('Titanoboa', 'BoaFrill_Character_BP_C', 'Land', { tags: 'snake boa' }),
  c('Arthropluera', 'Arthro_Character_BP_C', 'Land', { saddle: 'ArthroSaddle', tags: 'centipede' }),
  c('Pulmonoscorpius', 'Scorpion_Character_BP_C', 'Land', { saddle: 'ScorpionSaddle', tags: 'scorpion' }),
  c('Araneo', 'SpiderS_Character_BP_C', 'Land', { saddle: 'SpiderSaddle', tags: 'spider' }),
  c('Beelzebufo', 'Toad_Character_BP_C', 'Land', { saddle: 'ToadSaddle', tags: 'frog toad' }),
  c('Carbonemys', 'Turtle_Character_BP_C', 'Land', { saddle: 'TurtleSaddle', tags: 'turtle' }),
  c('Phiomia', 'Phiomia_Character_BP_C', 'Land', { saddle: 'PhiomiaSaddle' }),
  c('Ovis', 'Sheep_Character_BP_C', 'Land', { tags: 'sheep mutton' }),
  c('Bison', 'Bison_Character_BP_C', 'Land', { tags: 'ragnarok' }),
  c('Boaratos', 'Boaratos_Character_BP_C', 'Land', { tags: 'astraeos boar' }),
  c('Grand Tortugar', 'GrandTortugar_Character_BP_C', 'Land', { tags: 'astraeos tortoise' }),
  c('Maeguana', 'Maelizard_Character_BP_C', 'Land', { tags: 'astraeos iguana' }),
  c('Titanosaur', 'Titanosaur_Character_BP_C', 'Land', { saddle: 'TitanSaddle_Platform', tags: 'huge platform' }),

  // ---------------------------------------------------------------- Flyers
  c('Argentavis', 'Argent_Character_BP_C', 'Flyers', { saddle: 'ArgentavisSaddle', fav: true, tags: 'argy bird' }),
  c('Pteranodon', 'Ptero_Character_BP_C', 'Flyers', { saddle: 'PteroSaddle', fav: true, tags: 'ptera' }),
  c('Quetzal', 'Quetz_Character_BP_C', 'Flyers', { saddle: 'QuetzSaddle', fav: true, tags: 'quetz' }),
  c('Fire Wyvern', 'Wyvern_Character_BP_Fire_C', 'Flyers', { fav: true, tags: 'wyvern dragon' }),
  c('Lightning Wyvern', 'Wyvern_Character_BP_Lightning_C', 'Flyers', { tags: 'wyvern dragon' }),
  c('Poison Wyvern', 'Wyvern_Character_BP_Poison_C', 'Flyers', { tags: 'wyvern dragon' }),
  c('Ice Wyvern', 'Wyvern_Character_BP_Ice_C', 'Flyers', { tags: 'wyvern dragon' }),
  c('Griffin', 'Griffin_Character_BP_C', 'Flyers', { tags: 'ragnarok' }),
  c('Tapejara', 'Tapejara_Character_BP_C', 'Flyers', { saddle: 'TapejaraSaddle', tags: 'tapa' }),
  c('Pelagornis', 'Pela_Character_BP_C', 'Flyers', { saddle: 'PelaSaddle', tags: 'pela' }),
  c('Snow Owl', 'Owl_Character_BP_C', 'Flyers', { saddle: 'OwlSaddle', tags: 'owl extinction' }),
  c('Managarmr', 'IceJumper_Character_BP_C', 'Flyers', { saddle: 'IceJumperSaddle', tags: 'mana extinction' }),
  c('Rhyniognatha', 'Rhynio_Character_BP_C', 'Flyers', { saddle: 'RhynioSaddle', tags: 'rhynio' }),
  c('Lymantria', 'Moth_Character_BP_C', 'Flyers', { saddle: 'MothSaddle', tags: 'moth' }),
  c('Dimorphodon', 'Dimorph_Character_BP_C', 'Flyers', { tags: 'dimorph' }),
  c('Vulture', 'Vulture_Character_BP_C', 'Flyers'),
  c('Phoenix', 'Phoenix_Character_BP_C', 'Flyers', { tags: 'fire rare' }),
  c('Dreadmare', 'DarkPegasus_Character_BP_C', 'Flyers', { tags: 'pegasus' }),

  // ----------------------------------------------------------------- Water
  c('Mosasaurus', 'Mosa_Character_BP_C', 'Water', { saddle: 'MosaSaddle', fav: true, tags: 'mosa' }),
  c('Megalodon', 'Megalodon_Character_BP_C', 'Water', { saddle: 'MegalodonSaddle', tags: 'shark' }),
  c('Basilosaurus', 'Basilosaurus_Character_BP_C', 'Water', { saddle: 'BasiloSaddle', tags: 'basilo whale' }),
  c('Plesiosaur', 'Plesiosaur_Character_BP_C', 'Water', { saddle: 'PlesiaSaddle', tags: 'plesio' }),
  c('Ichthyosaurus', 'Dolphin_Character_BP_C', 'Water', { saddle: 'DolphinSaddle', tags: 'dolphin ichthy' }),
  c('Tusoteuthis', 'Tusoteuthis_Character_BP_C', 'Water', { saddle: 'TusoSaddle', tags: 'squid tuso' }),
  c('Dunkleosteus', 'Dunkle_Character_BP_C', 'Water', { saddle: 'DunkleosteusSaddle', tags: 'dunkle' }),
  c('Manta', 'Manta_Character_BP_C', 'Water', { saddle: 'MantaSaddle', tags: 'ray' }),
  c('Liopleurodon', 'Liopleurodon_Character_BP_C', 'Water', { tags: 'lio luck' }),
  c('Leedsichthys', 'Leedsichthys_Character_BP_C', 'Water', { tags: 'leeds' }),
  c('Archelon', 'Archelon_Character_BP_ASA_C', 'Water', { tags: 'turtle' }),
  c('Shastasaurus', 'Shastasaurus_Character_BP_C', 'Water', { tags: 'the center' }),
  c('Helicoprion', 'Helicoprion_Character_BP_C', 'Water', { tags: 'shark' }),
  c('Xiphactinus', 'Xiphactinus_Character_BP_ASA_C', 'Water', { tags: 'fish' }),
  c('Anglerfish', 'Angler_Character_BP_C', 'Water', { tags: 'angler' }),
  c('Electrophorus', 'Eel_Character_BP_C', 'Water', { tags: 'eel' }),
  c('Cnidaria', 'Cnidaria_Character_BP_C', 'Water', { tags: 'jellyfish' }),
  c('Piranha', 'Piranha_Character_BP_C', 'Water'),
  c('Coelacanth', 'Coel_Character_BP_C', 'Water', { tags: 'coel fish' }),
  c('Sabertooth Salmon', 'Salmon_Character_BP_C', 'Water', { tags: 'fish' }),
  c('Diplocaulus', 'Diplocaulus_Character_BP_C', 'Water', { tags: 'oxygen' }),
  c('Trilobite', 'Trilobite_Character_C', 'Water'),
  c('Ammonite', 'Ammonite_Character_C', 'Water'),
  c('Eurypterid', 'Euryp_Character_C', 'Water'),

  // ------------------------------------------------------- Small & utility
  c('Dodo', 'Dodo_Character_BP_C', 'Small & utility', { fav: true }),
  c('Otter', 'Otter_Character_BP_C', 'Small & utility', { fav: true, tags: 'cute shoulder' }),
  c('Jerboa', 'Jerboa_Character_BP_C', 'Small & utility', { tags: 'cute shoulder weather' }),
  c('Cat', 'Cat_Character_BP_C', 'Small & utility', { tags: 'pet' }),
  c('Mesopithecus', 'Monkey_Character_BP_C', 'Small & utility', { tags: 'monkey shoulder' }),
  c('Compy', 'Compy_Character_BP_C', 'Small & utility'),
  c('Dilophosaur', 'Dilo_Character_BP_C', 'Small & utility', { tags: 'dilo' }),
  c('Lystrosaurus', 'Lystro_Character_BP_C', 'Small & utility', { tags: 'xp' }),
  c('Oviraptor', 'Oviraptor_Character_BP_C', 'Small & utility', { tags: 'eggs' }),
  c('Dung Beetle', 'DungBeetle_Character_BP_C', 'Small & utility', { tags: 'fertiliser oil' }),
  c('Achatina', 'Achatina_Character_BP_C', 'Small & utility', { tags: 'snail paste' }),
  c('Giant Bee', 'Bee_Character_BP_C', 'Small & utility', { tags: 'honey' }),
  c('Meganeura', 'Dragonfly_Character_BP_C', 'Small & utility', { tags: 'dragonfly' }),
  c('Titanomyrma', 'Ant_Character_BP_C', 'Small & utility', { tags: 'ant' }),
  c('Archaeopteryx', 'Archa_Character_BP_C', 'Small & utility', { tags: 'archa glide' }),
  c('Microraptor', 'Microraptor_Character_BP_C', 'Small & utility'),
  c('Ichthyornis', 'Ichthyornis_Character_BP_C', 'Small & utility', { tags: 'seagull' }),
  c('Hesperornis', 'Hesperornis_Character_BP_C', 'Small & utility'),
  c('Kairuku', 'Kairuku_Character_BP_C', 'Small & utility', { tags: 'penguin' }),
  c('Pegomastax', 'Pegomastax_Character_BP_C', 'Small & utility', { tags: 'thief' }),
  c('Troodon', 'Troodon_Character_BP_C', 'Small & utility'),
  c('Onyc', 'Bat_Character_BP_C', 'Small & utility', { tags: 'bat' }),
  c('Dimetrodon', 'Dimetro_Character_BP_C', 'Small & utility', { tags: 'incubate' }),
  c('Moschops', 'Moschops_Character_BP_C', 'Small & utility', { tags: 'harvest' }),
  c('Morellatops', 'camelsaurus_Character_BP_C', 'Small & utility', { saddle: 'CamelsaurusSaddle', tags: 'camel water' }),
  c('Thorny Dragon', 'SpineyLizard_Character_BP_C', 'Small & utility', { saddle: 'SpineyLizardSaddle', tags: 'thorny' }),
  c('Mantis', 'Mantis_Character_BP_C', 'Small & utility', { saddle: 'MantisSaddle' }),
  c('Oil Jug Bug', 'Jugbug_Oil_Character_BP_C', 'Small & utility', { tags: 'oil' }),
  c('Water Jug Bug', 'Jugbug_Water_Character_BP_C', 'Small & utility', { tags: 'water' }),
  c('Burrowbuck', 'Jackalope_Character_BP_C', 'Small & utility', { tags: 'jackalope' }),
  c('Cryolophosaurus', 'Cryolophosaurus_Character_BP_C', 'Small & utility', { tags: 'cryo' }),
  c('Pyromane', 'FireLion_Character_BP_C', 'Small & utility', { tags: 'fire lion' }),
  c('Elderclaw', 'SpiritBear_Character_BP_C', 'Small & utility', { tags: 'bear spirit' }),

  // ------------------------------------------------------------ Aberration
  c('Rock Drake', 'RockDrake_Character_BP_C', 'Aberration', { saddle: 'RockDrakeSaddle', fav: true, tags: 'drake glide' }),
  c('Karkinos', 'Crab_Character_BP_C', 'Aberration', { saddle: 'CrabSaddle', tags: 'crab' }),
  c('Ravager', 'CaveWolf_Character_BP_C', 'Aberration', { saddle: 'CavewolfSaddle', tags: 'wolf zipline' }),
  c('Roll Rat', 'MoleRat_Character_BP_C', 'Aberration', { saddle: 'MoleRatSaddle', tags: 'rat' }),
  c('Basilisk', 'Basilisk_Character_BP_C', 'Aberration', { saddle: 'BasiliskSaddle', tags: 'snake' }),
  c('Reaper King (tamed)', 'Xenomorph_Character_BP_Male_Tamed_C', 'Aberration', { tags: 'reaper' }),
  c('Reaper Queen', 'Xenomorph_Character_BP_Female_C', 'Aberration', { tags: 'reaper' }),
  c('Bulbdog', 'LanternPug_Character_BP_C', 'Aberration', { tags: 'pet light charge' }),
  c('Featherlight', 'LanternBird_Character_BP_C', 'Aberration', { tags: 'pet light charge' }),
  c('Glowtail', 'LanternLizard_Character_BP_C', 'Aberration', { tags: 'pet light charge' }),
  c('Cosmo', 'JumpingSpider_Character_BP_C', 'Aberration', { tags: 'spider' }),
  c('Glowbug', 'Lightbug_Character_BaseBP_C', 'Aberration'),
  c('Nameless', 'ChupaCabra_Character_BP_C', 'Aberration'),
  c('Lamprey', 'Lamprey_Character_C', 'Aberration'),

  // ------------------------------------------------------------ Extinction
  c('Gasbags', 'GasBags_Character_BP_C', 'Extinction', { saddle: 'GasBagsSaddle' }),
  c('Velonasaur', 'Spindles_Character_BP_C', 'Extinction', { saddle: 'SpindlesSaddle', tags: 'spindles' }),
  c('Gacha', 'Gacha_Character_BP_C', 'Extinction', { saddle: 'GachaSaddle' }),
  c('Enforcer', 'Enforcer_Character_BP_C', 'Extinction', { tags: 'robot' }),
  c('Scout', 'Scout_Character_BP_C', 'Extinction', { tags: 'robot drone' }),
  c('Defense Unit', 'Defender_Character_BP_C', 'Extinction', { tags: 'robot' }),
  c('Mek', 'Mek_Character_BP_C', 'Extinction', { tags: 'robot mech' }),
  c('Dreadnoughtus', 'Dreadnoughtus_Character_BP_C', 'Extinction', { tags: 'sauropod' }),
  c('Armadoggo', 'Doggo_Character_BP_C', 'Extinction', { tags: 'dog' }),

  // ------------------------------------------------------- Bosses & titans
  c('Broodmother (Gamma)', 'SpiderL_Character_BP_Easy_C', 'Bosses & titans', { boss: true, tags: 'spider boss' }),
  c('Broodmother (Beta)', 'SpiderL_Character_BP_Medium_C', 'Bosses & titans', { boss: true, tags: 'spider boss' }),
  c('Broodmother (Alpha)', 'SpiderL_Character_BP_Hard_C', 'Bosses & titans', { boss: true, tags: 'spider boss' }),
  c('Megapithecus (Gamma)', 'Gorilla_Character_BP_Easy_C', 'Bosses & titans', { boss: true, tags: 'ape boss' }),
  c('Megapithecus (Beta)', 'Gorilla_Character_BP_Medium_C', 'Bosses & titans', { boss: true, tags: 'ape boss' }),
  c('Megapithecus (Alpha)', 'Gorilla_Character_BP_Hard_C', 'Bosses & titans', { boss: true, tags: 'ape boss' }),
  c('Dragon (Gamma)', 'Dragon_Character_BP_Boss_Easy_C', 'Bosses & titans', { boss: true }),
  c('Dragon (Beta)', 'Dragon_Character_BP_Boss_Medium_C', 'Bosses & titans', { boss: true }),
  c('Dragon (Alpha)', 'Dragon_Character_BP_Boss_Hard_C', 'Bosses & titans', { boss: true }),
  c('Manticore (Gamma)', 'Manticore_Character_BP_Easy_C', 'Bosses & titans', { boss: true }),
  c('Manticore (Beta)', 'Manticore_Character_BP_Medium_C', 'Bosses & titans', { boss: true }),
  c('Manticore (Alpha)', 'Manticore_Character_BP_Hard_C', 'Bosses & titans', { boss: true }),
  c('Overseer (Gamma)', 'EndBoss_Character_Easy_C', 'Bosses & titans', { boss: true }),
  c('Overseer (Beta)', 'EndBoss_Character_Medium_C', 'Bosses & titans', { boss: true }),
  c('Overseer (Alpha)', 'EndBoss_Character_Hard_C', 'Bosses & titans', { boss: true }),
  c('Rockwell (Gamma)', 'Rockwell_Character_BP_Easy_C', 'Bosses & titans', { boss: true }),
  c('Rockwell (Beta)', 'Rockwell_Character_BP_Medium_C', 'Bosses & titans', { boss: true }),
  c('Rockwell (Alpha)', 'Rockwell_Character_BP_Hard_C', 'Bosses & titans', { boss: true }),
  c('Desert Titan', 'DesertKaiju_Character_BP_C', 'Bosses & titans', { boss: true, tags: 'extinction' }),
  c('Forest Titan', 'ForestKaiju_Character_BP_C', 'Bosses & titans', { boss: true, tags: 'extinction' }),
  c('Ice Titan', 'IceKaiju_Character_BP_C', 'Bosses & titans', { boss: true, tags: 'extinction' }),
  c('Mega Mek', 'MegaMek_Character_BP_C', 'Bosses & titans', { boss: true, tags: 'extinction robot' }),
  c('Rock Elemental', 'RockGolem_Character_BP_C', 'Bosses & titans', { saddle: 'RockGolemSaddle', tags: 'golem' }),
  c('Chalk Golem', 'ChalkGolem_Character_BP_C', 'Bosses & titans', { tags: 'valguero golem' }),
  c('Ice Golem', 'IceGolem_Character_BP_C', 'Bosses & titans', { tags: 'valguero golem' }),
  c('Deathworm', 'Deathworm_Character_BP_C', 'Bosses & titans', { boss: true, tags: 'scorched earth' }),
  c('Yeti', 'Yeti_Character_BP_C', 'Bosses & titans', { tags: 'megapithecus cave' }),
  c('DodoRex', 'DodoRex_Character_BP_C', 'Bosses & titans', { boss: true, tags: 'event halloween' }),
  c('Oasisaur', 'Oasisaur_Character_BP_C', 'Bosses & titans', { tags: 'scorched earth' }),

  // ------------------------------------------------------ Variants & event
  c('Alpha Rex', 'MegaRex_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Raptor', 'MegaRaptor_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Carno', 'MegaCarno_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Megalodon', 'MegaMegalodon_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Mosasaur', 'Mosa_Character_BP_Mega_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Tusoteuthis', 'Mega_Tusoteuthis_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Leedsichthys', 'Alpha_Leedsichthys_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Fire Wyvern', 'MegaWyvern_Character_BP_Fire_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Deathworm', 'MegaDeathworm_Character_BP_C', 'Variants & event', { tags: 'alpha' }),
  c('Alpha Basilisk', 'MegaBasilisk_Character_BP_C', 'Variants & event', { tags: 'alpha aberration' }),
  c('Alpha Karkinos', 'MegaCrab_Character_BP_C', 'Variants & event', { tags: 'alpha aberration' }),
  c('Tek Rex', 'BionicRex_Character_BP_C', 'Variants & event', { saddle: 'RexSaddle', tags: 'tek' }),
  c('Tek Raptor', 'BionicRaptor_Character_BP_C', 'Variants & event', { saddle: 'RaptorSaddle', tags: 'tek' }),
  c('Tek Parasaur', 'BionicPara_Character_BP_C', 'Variants & event', { saddle: 'ParaSaddle', tags: 'tek' }),
  c('Tek Stegosaurus', 'BionicStego_Character_BP_C', 'Variants & event', { saddle: 'StegoSaddle', tags: 'tek' }),
  c('Tek Quetzal', 'BionicQuetz_Character_BP_C', 'Variants & event', { saddle: 'QuetzSaddle', tags: 'tek' }),
  c('Skeletal Rex', 'Bone_MegaRex_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Raptor', 'Bone_MegaRaptor_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Carnotaurus', 'Bone_MegaCarno_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Giganotosaurus', 'Bone_Gigant_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Quetzal', 'Bone_Quetz_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Bronto', 'Bone_Sauropod_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Stego', 'Bone_Stego_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Trike', 'Bone_Trike_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Skeletal Jerboa', 'Bone_Jerboa_Character_BP_C', 'Variants & event', { tags: 'bone halloween' }),
  c('Zomdodo', 'ZombieDodo_Character_BP_C', 'Variants & event', { tags: 'halloween' }),
  c('Zombie Fire Wyvern', 'Wyvern_Character_BP_ZombieFire_C', 'Variants & event', { tags: 'halloween' }),
  c('Ghost Rex', 'Ghost_Rex_Character_BP_C', 'Variants & event', { tags: 'halloween ghost' }),
  c('Ghost Direwolf', 'Ghost_Direwolf_Character_BP_C', 'Variants & event', { tags: 'halloween ghost' }),
  c('Ghost Basilisk', 'Ghost_Basilisk_Character_BP_C', 'Variants & event', { tags: 'halloween ghost' }),
  c('Ghost Snow Owl', 'Ghost_Owl_Character_BP_C', 'Variants & event', { tags: 'halloween ghost' }),
  c('Ghost Mantis', 'Ghost_Mantis_Character_BP_C', 'Variants & event', { tags: 'halloween ghost' }),
  c('Bunny Dodo', 'Dodo_Character_BP_Bunny_C', 'Variants & event', { tags: 'easter' }),
  c('Super Turkey', 'Turkey_Character_BP_C', 'Variants & event', { tags: 'thanksgiving' }),
  c('GachaClaus', 'Gacha_Claus_Character_BP_C', 'Variants & event', { tags: 'christmas winter' }),
  c('Corrupted Rex', 'Rex_Character_BP_Corrupt_C', 'Variants & event', { tags: 'extinction corrupted' }),
  c('Corrupted Giganotosaurus', 'Gigant_Character_BP_Corrupt_C', 'Variants & event', { tags: 'extinction corrupted' }),
  c('Corrupted Rock Drake', 'RockDrake_Character_BP_Corrupt_C', 'Variants & event', { tags: 'extinction corrupted' }),
  c('Corrupted Wyvern', 'Wyvern_Character_BP_Fire_Corrupt_C', 'Variants & event', { tags: 'extinction corrupted' }),
  c('Aberrant Rex', 'Rex_Character_BP_Aberrant_C', 'Variants & event', { saddle: 'RexSaddle', tags: 'aberrant' }),
  c('Aberrant Spino', 'Spino_Character_BP_Aberrant_C', 'Variants & event', { saddle: 'SpinoSaddle', tags: 'aberrant' }),
  c('Aberrant Raptor', 'Raptor_Character_BP_Aberrant_C', 'Variants & event', { saddle: 'RaptorSaddle', tags: 'aberrant' }),
  c('Aberrant Dire Bear', 'Direbear_Character_BP_Aberrant_C', 'Variants & event', { saddle: 'DireBearSaddle', tags: 'aberrant' }),
  c('Aberrant Otter', 'Otter_Character_BP_Aberrant_C', 'Variants & event', { tags: 'aberrant' }),
  c('Aberrant Dodo', 'Dodo_Character_BP_Aberrant_C', 'Variants & event', { tags: 'aberrant' }),
];

// -------------------------------------------------------------------- items

/**
 * ARK asset paths are written `Blueprint'/Game/.../Foo.Foo'` - the class name
 * repeated after a dot. The tables these came from sometimes drop the repeat,
 * so it is restored here rather than in three hundred literals.
 */
const p = (path: string): string => {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return last.includes('.') ? path : `${path}.${last}`;
};

const ARMOR = '/Game/PrimalEarth/CoreBlueprints/Items/Armor/';
const SADDLES = `${ARMOR}Saddles/PrimalItemArmor_`;
const WEAPON = '/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItem_';
const AMMO = '/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItemAmmo_';
const ATTACH = '/Game/PrimalEarth/CoreBlueprints/Items/WeaponAttachments/PrimalItemWeaponAttachment_';
/** Several hand tools live under Test/ rather than Weapons/ - Wildcard's doing. */
const TOOL = '/Game/PrimalEarth/Test/PrimalItem_';
const RESOURCE = '/Game/PrimalEarth/CoreBlueprints/Resources/PrimalItemResource_';
const CONSUM_DIR = '/Game/PrimalEarth/CoreBlueprints/Items/Consumables/';
const CONSUM = `${CONSUM_DIR}PrimalItemConsumable_`;
const STRUCT = '/Game/PrimalEarth/CoreBlueprints/Items/Structures/';

const item = (name: string, gfi: string, path: string | null, group: string, extra: Partial<SpawnItem> = {}): SpawnItem => ({
  name,
  gfi,
  ...(path ? { path: p(path) } : {}),
  group,
  ...extra,
});

/** Armour lives in a per-set folder named after the material. */
const armour = (name: string, gfi: string, set: string, extra: Partial<SpawnItem> = {}): SpawnItem =>
  item(name, gfi, `${ARMOR}${set}/PrimalItemArmor_${gfi}`, 'Armour', extra);

/** Most saddles sit together; the DLC ones pass their own path. */
const saddle = (name: string, gfi: string, path?: string): SpawnItem =>
  item(name, gfi, path ?? `${SADDLES}${gfi}`, 'Saddles');

export const ITEM_GROUPS = ['Armour', 'Saddles', 'Weapons & tools', 'Resources', 'Food & medicine', 'Structures'];

export const ITEMS: SpawnItem[] = [
  // ---------------------------------------------------------------- Armour
  armour('Cloth Hat', 'ClothHelmet', 'Cloth', { tags: 'starter head' }),
  armour('Cloth Shirt', 'ClothShirt', 'Cloth', { tags: 'starter chest' }),
  armour('Cloth Pants', 'ClothPants', 'Cloth', { tags: 'starter legs' }),
  armour('Cloth Gloves', 'ClothGloves', 'Cloth', { tags: 'starter hands' }),
  armour('Cloth Boots', 'ClothBoots', 'Cloth', { tags: 'starter feet' }),
  armour('Hide Hat', 'HideHelmet', 'Leather', { tags: 'hide head' }),
  armour('Hide Shirt', 'HideShirt', 'Leather', { tags: 'hide chest' }),
  armour('Hide Pants', 'HidePants', 'Leather', { tags: 'hide legs' }),
  armour('Hide Gloves', 'HideGloves', 'Leather', { tags: 'hide hands' }),
  armour('Hide Boots', 'HideBoots', 'Leather', { tags: 'hide feet' }),
  armour('Fur Cap', 'FurHelmet', 'Fur', { tags: 'cold head' }),
  armour('Fur Chestpiece', 'FurShirt', 'Fur', { tags: 'cold chest' }),
  armour('Fur Leggings', 'FurPants', 'Fur', { tags: 'cold legs' }),
  armour('Fur Gauntlets', 'FurGloves', 'Fur', { tags: 'cold hands' }),
  armour('Fur Boots', 'FurBoots', 'Fur', { tags: 'cold feet' }),
  armour('Chitin Helmet', 'ChitinHelmet', 'Chitin', { tags: 'head' }),
  armour('Chitin Chestpiece', 'ChitinShirt', 'Chitin', { tags: 'chest' }),
  armour('Chitin Leggings', 'ChitinPants', 'Chitin', { tags: 'legs' }),
  armour('Chitin Gauntlets', 'ChitinGloves', 'Chitin', { tags: 'hands' }),
  armour('Chitin Boots', 'ChitinBoots', 'Chitin', { tags: 'feet' }),
  armour('Ghillie Mask', 'GhillieHelmet', 'Ghillie', { tags: 'head heat' }),
  armour('Ghillie Chestpiece', 'GhillieShirt', 'Ghillie', { tags: 'chest heat' }),
  armour('Ghillie Leggings', 'GhilliePants', 'Ghillie', { tags: 'legs heat' }),
  armour('Ghillie Gauntlets', 'GhillieGloves', 'Ghillie', { tags: 'hands heat' }),
  armour('Ghillie Boots', 'GhillieBoots', 'Ghillie', { tags: 'feet heat' }),
  armour('Flak Helmet', 'MetalHelmet', 'Metal', { tags: 'head armour metal' }),
  armour('Flak Chestpiece', 'MetalShirt', 'Metal', { tags: 'chest armour metal' }),
  armour('Flak Leggings', 'MetalPants', 'Metal', { tags: 'legs armour metal' }),
  armour('Flak Gauntlets', 'MetalGloves', 'Metal', { tags: 'hands armour metal' }),
  armour('Flak Boots', 'MetalBoots', 'Metal', { tags: 'feet armour metal' }),
  armour('Riot Helmet', 'RiotHelmet', 'Riot', { tags: 'head' }),
  armour('Riot Chestpiece', 'RiotShirt', 'Riot', { tags: 'chest' }),
  armour('Riot Leggings', 'RiotPants', 'Riot', { tags: 'legs' }),
  armour('Riot Gauntlets', 'RiotGloves', 'Riot', { tags: 'hands' }),
  armour('Riot Boots', 'RiotBoots', 'Riot', { tags: 'feet' }),
  armour('Tek Helmet', 'TekHelmet', 'TEK', { tags: 'head endgame' }),
  armour('Tek Chestpiece', 'TekShirt', 'TEK', { tags: 'chest endgame' }),
  armour('Tek Leggings', 'TekPants', 'TEK', { tags: 'legs endgame' }),
  armour('Tek Gauntlets', 'TekGloves', 'TEK', { tags: 'hands endgame' }),
  armour('Tek Boots', 'TekBoots', 'TEK', { tags: 'feet endgame' }),
  armour('SCUBA Mask', 'ScubaHelmet_Goggles', 'SCUBA', { tags: 'water diving head' }),
  armour('SCUBA Tank', 'ScubaShirt_SuitWithTank', 'SCUBA', { tags: 'water diving chest oxygen' }),
  armour('SCUBA Leggings', 'ScubaPants', 'SCUBA', { tags: 'water diving legs' }),
  armour('SCUBA Flippers', 'ScubaBoots_Flippers', 'SCUBA', { tags: 'water diving feet' }),
  armour('Gas Mask', 'GasMask', 'SCUBA', { tags: 'head poison' }),
  armour('Night Vision Goggles', 'NightVisionGoggles', 'SCUBA', { tags: 'head dark' }),
  armour('Heavy Miner Helmet', 'MinersHelmet', 'Metal', { tags: 'head light' }),
  item('Hazard Suit Hat', 'HazardSuitHelmet', '/Game/Aberration/CoreBlueprints/Items/Armor/HazardSuit/PrimalItemArmor_HazardSuitHelmet', 'Armour', { tags: 'radiation head aberration' }),
  item('Hazard Suit Shirt', 'HazardSuitShirt', '/Game/Aberration/CoreBlueprints/Items/Armor/HazardSuit/PrimalItemArmor_HazardSuitShirt', 'Armour', { tags: 'radiation chest aberration' }),
  item('Hazard Suit Pants', 'HazardSuitPants', '/Game/Aberration/CoreBlueprints/Items/Armor/HazardSuit/PrimalItemArmor_HazardSuitPants', 'Armour', { tags: 'radiation legs aberration' }),
  item('Hazard Suit Gloves', 'HazardSuitGloves', '/Game/Aberration/CoreBlueprints/Items/Armor/HazardSuit/PrimalItemArmor_HazardSuitGloves', 'Armour', { tags: 'radiation hands aberration' }),
  item('Hazard Suit Boots', 'HazardSuitBoots', '/Game/Aberration/CoreBlueprints/Items/Armor/HazardSuit/PrimalItemArmor_HazardSuitBoots', 'Armour', { tags: 'radiation feet aberration' }),
  item('Desert Goggles and Hat', 'DesertClothGogglesHelmet', '/Game/ScorchedEarth/Outfits/PrimalItemArmor_DesertClothGogglesHelmet', 'Armour', { tags: 'desert head scorched' }),
  item('Desert Cloth Shirt', 'DesertClothShirt', '/Game/ScorchedEarth/Outfits/PrimalItemArmor_DesertClothShirt', 'Armour', { tags: 'desert chest scorched' }),
  item('Desert Cloth Pants', 'DesertClothPants', '/Game/ScorchedEarth/Outfits/PrimalItemArmor_DesertClothPants', 'Armour', { tags: 'desert legs scorched' }),
  item('Desert Cloth Gloves', 'DesertClothGloves', '/Game/ScorchedEarth/Outfits/PrimalItemArmor_DesertClothGloves', 'Armour', { tags: 'desert hands scorched' }),
  item('Desert Cloth Boots', 'DesertClothBoots', '/Game/ScorchedEarth/Outfits/PrimalItemArmor_DesertClothBoots', 'Armour', { tags: 'desert feet scorched' }),
  item('Wooden Shield', 'WoodShield', `${ARMOR}Shields/PrimalItemArmor_WoodShield`, 'Armour', { tags: 'shield block' }),
  item('Metal Shield', 'MetalShield', `${ARMOR}Shields/PrimalItemArmor_MetalShield`, 'Armour', { tags: 'shield block' }),
  item('Riot Shield', 'TransparentRiotShield', `${ARMOR}Shields/PrimalItemArmor_TransparentRiotShield`, 'Armour', { tags: 'shield block' }),
  item('Tek Shield', 'ShieldTek', `${ARMOR}Shields/PrimalItemArmor_ShieldTek`, 'Armour', { tags: 'shield block endgame' }),
  item('Parachute', 'Parachute', `${CONSUM_DIR}BaseBPs/PrimalItemConsumableBuff_Parachute`, 'Armour', { qty: 5, tags: 'fall safe' }),

  // --------------------------------------------------------------- Saddles
  saddle('Rex Saddle', 'RexSaddle'),
  saddle('Rex Tek Saddle', 'RexSaddle_Tek'),
  saddle('Raptor Saddle', 'RaptorSaddle'),
  saddle('Trike Saddle', 'TrikeSaddle'),
  saddle('Parasaur Saddle', 'ParaSaddle'),
  saddle('Stego Saddle', 'StegoSaddle'),
  saddle('Ankylo Saddle', 'AnkyloSaddle'),
  saddle('Doedicurus Saddle', 'DoedSaddle'),
  saddle('Bronto Saddle', 'SauroSaddle'),
  saddle('Bronto Platform Saddle', 'SauroSaddle_Platform'),
  saddle('Diplodocus Saddle', 'DiplodocusSaddle'),
  saddle('Paracer Saddle', 'Paracer_Saddle'),
  saddle('Paracer Platform Saddle', 'ParacerSaddle_Platform'),
  saddle('Carno Saddle', 'CarnoSaddle'),
  saddle('Allosaurus Saddle', 'AlloSaddle'),
  saddle('Baryonyx Saddle', 'BaryonyxSaddle'),
  saddle('Carcharo Saddle', 'CarchaSaddle'),
  saddle('Spino Saddle', 'SpinoSaddle'),
  saddle('Giganotosaurus Saddle', 'GigantSaddle'),
  saddle('Therizinosaurus Saddle', 'TherizinosaurusSaddle'),
  saddle('Yutyrannus Saddle', 'YutySaddle'),
  saddle('Megalosaurus Saddle', 'MegalosaurusSaddle'),
  saddle('Sabertooth Saddle', 'SaberSaddle'),
  saddle('Direbear Saddle', 'DireBearSaddle'),
  saddle('Thylacoleo Saddle', 'ThylacoSaddle'),
  saddle('Megatherium Saddle', 'MegatheriumSaddle'),
  saddle('Mammoth Saddle', 'MammothSaddle'),
  saddle('Woolly Rhino Saddle', 'RhinoSaddle'),
  saddle('Castoroides Saddle', 'BeaverSaddle'),
  saddle('Chalicotherium Saddle', 'ChalicoSaddle'),
  saddle('Daeodon Saddle', 'DaeodonSaddle'),
  saddle('Megaloceros Saddle', 'StagSaddle'),
  saddle('Equus Saddle', 'EquusSaddle'),
  saddle('Procoptodon Saddle', 'ProcoptodonSaddle'),
  saddle('Iguanodon Saddle', 'IguanodonSaddle'),
  saddle('Pachy Saddle', 'PachySaddle'),
  saddle('Pachyrhinosaurus Saddle', 'PachyrhinoSaddle'),
  saddle('Gallimimus Saddle', 'Gallimimus'),
  saddle('Terror Bird Saddle', 'TerrorBirdSaddle'),
  saddle('Hyaenodon Meatpack', 'HyaenodonSaddle'),
  saddle('Kaprosuchus Saddle', 'KaprosuchusSaddle'),
  saddle('Sarco Saddle', 'SarcoSaddle'),
  saddle('Megalania Saddle', 'MegalaniaSaddle'),
  saddle('Arthropluera Saddle', 'ArthroSaddle'),
  saddle('Pulmonoscorpius Saddle', 'ScorpionSaddle'),
  saddle('Araneo Saddle', 'SpiderSaddle'),
  saddle('Beelzebufo Saddle', 'ToadSaddle'),
  saddle('Carbonemys Saddle', 'TurtleSaddle'),
  saddle('Phiomia Saddle', 'PhiomiaSaddle'),
  saddle('Titanosaur Platform Saddle', 'TitanSaddle_Platform'),
  saddle('Argentavis Saddle', 'ArgentavisSaddle'),
  saddle('Pteranodon Saddle', 'PteroSaddle'),
  saddle('Quetz Saddle', 'QuetzSaddle'),
  saddle('Quetz Platform Saddle', 'QuetzSaddle_Platform'),
  saddle('Tapejara Saddle', 'TapejaraSaddle'),
  saddle('Tapejara Tek Saddle', 'Tapejara_Tek'),
  saddle('Pelagornis Saddle', 'PelaSaddle'),
  saddle('Rhyniognatha Saddle', 'RhynioSaddle'),
  saddle('Mosasaur Saddle', 'MosaSaddle'),
  saddle('Mosasaur Platform Saddle', 'MosaSaddle_Platform'),
  saddle('Mosasaur Tek Saddle', 'MosaSaddle_Tek'),
  saddle('Megalodon Saddle', 'MegalodonSaddle'),
  saddle('Megalodon Tek Saddle', 'MegalodonSaddle_Tek'),
  saddle('Basilosaurus Saddle', 'BasiloSaddle'),
  saddle('Plesiosaur Saddle', 'PlesiaSaddle'),
  saddle('Plesiosaur Platform Saddle', 'PlesiSaddle_Platform'),
  saddle('Ichthyosaurus Saddle', 'DolphinSaddle'),
  saddle('Tusoteuthis Saddle', 'TusoSaddle'),
  saddle('Dunkleosteus Saddle', 'DunkleosteusSaddle'),
  saddle('Manta Saddle', 'MantaSaddle'),
  saddle('Tropeognathus Saddle', 'TropeSaddle', '/Game/PrimalEarth/Dinos/Tropeognathus/PrimalItemArmor_TropeSaddle'),
  saddle('Morellatops Saddle', 'CamelsaurusSaddle', '/Game/ScorchedEarth/Dinos/Camelsaurus/PrimalItemArmor_CamelsaurusSaddle'),
  saddle('Thorny Dragon Saddle', 'SpineyLizardSaddle', '/Game/ScorchedEarth/Dinos/SpineyLizard/PrimalItemArmor_SpineyLizardSaddle'),
  saddle('Mantis Saddle', 'MantisSaddle', '/Game/ScorchedEarth/Dinos/Mantis/PrimalItemArmor_MantisSaddle'),
  saddle('Lymantria Saddle', 'MothSaddle', '/Game/ScorchedEarth/Dinos/Moth/PrimalItemArmor_MothSaddle'),
  saddle('Rock Golem Saddle', 'RockGolemSaddle', '/Game/ScorchedEarth/Dinos/RockGolem/PrimalItemArmor_RockGolemSaddle'),
  saddle('Rock Drake Saddle', 'RockDrakeSaddle', '/Game/Aberration/Dinos/RockDrake/PrimalItemArmor_RockDrakeSaddle'),
  saddle('Rock Drake Tek Saddle', 'RockDrakeSaddle_Tek', '/Game/Aberration/Dinos/RockDrake/PrimalItemArmor_RockDrakeSaddle_Tek'),
  saddle('Karkinos Saddle', 'CrabSaddle', '/Game/Aberration/Dinos/Crab/PrimalItemArmor_CrabSaddle'),
  saddle('Ravager Saddle', 'CavewolfSaddle', '/Game/Aberration/Dinos/CaveWolf/PrimalItemArmor_CavewolfSaddle'),
  saddle('Roll Rat Saddle', 'MoleRatSaddle', '/Game/Aberration/Dinos/MoleRat/PrimalItemArmor_MoleRatSaddle'),
  saddle('Basilisk Saddle', 'BasiliskSaddle', '/Game/Aberration/Dinos/Basilisk/PrimalItemArmor_BasiliskSaddle'),
  saddle('Snow Owl Saddle', 'OwlSaddle', '/Game/Extinction/CoreBlueprints/Items/Saddle/PrimalItemArmor_OwlSaddle'),
  saddle('Managarmr Saddle', 'IceJumperSaddle', '/Game/Extinction/CoreBlueprints/Items/Saddle/PrimalItemArmor_IceJumperSaddle'),
  saddle('Gasbags Saddle', 'GasBagsSaddle', '/Game/Extinction/CoreBlueprints/Items/Saddle/PrimalItemArmor_GasBagsSaddle'),
  saddle('Velonasaur Saddle', 'SpindlesSaddle', '/Game/Extinction/CoreBlueprints/Items/Saddle/PrimalItemArmor_SpindlesSaddle'),
  saddle('Gacha Saddle', 'GachaSaddle', '/Game/Extinction/CoreBlueprints/Items/Saddle/PrimalItemArmor_GachaSaddle'),
  saddle('Deinonychus Saddle', 'DeinonychusSaddle', '/Game/Valguero/Dinos/Deinonychus/PrimalItemArmor_DeinonychusSaddle'),

  // ------------------------------------------------------- Weapons & tools
  item('Stone Pick', 'StonePick', `${WEAPON}WeaponStonePick`, 'Weapons & tools', { tags: 'harvest starter' }),
  item('Stone Hatchet', 'StoneHatchet', `${WEAPON}WeaponStoneHatchet`, 'Weapons & tools', { tags: 'harvest starter' }),
  item('Metal Pick', 'MetalPick', `${WEAPON}WeaponMetalPick`, 'Weapons & tools', { tags: 'harvest' }),
  item('Metal Hatchet', 'MetalHatchet', `${WEAPON}WeaponMetalHatchet`, 'Weapons & tools', { tags: 'harvest' }),
  item('Metal Sickle', 'Sickle', `${WEAPON}WeaponSickle`, 'Weapons & tools', { tags: 'harvest fibre' }),
  item('Chainsaw', 'ChainSaw', '/Game/ScorchedEarth/WeaponChainsaw/PrimalItem_ChainSaw', 'Weapons & tools', { tags: 'harvest' }),
  item('Fishing Rod', 'WeaponFishingRod', `${WEAPON}WeaponFishingRod`, 'Weapons & tools', { tags: 'fish' }),
  item('Whip', 'WeaponWhip', '/Game/ScorchedEarth/WeaponWhip/PrimalItem_WeaponWhip', 'Weapons & tools', { tags: 'pickup' }),
  item('Torch', 'WeaponTorch', `${WEAPON}WeaponTorch`, 'Weapons & tools', { tags: 'light starter' }),
  item('Spear', 'WeaponSpear', `${WEAPON}WeaponSpear`, 'Weapons & tools', { tags: 'starter melee' }),
  item('Pike', 'WeaponPike', `${WEAPON}WeaponPike`, 'Weapons & tools', { tags: 'melee' }),
  item('Sword', 'WeaponSword', `${WEAPON}WeaponSword`, 'Weapons & tools', { tags: 'melee' }),
  item('Wooden Club', 'WeaponStoneClub', `${WEAPON}WeaponStoneClub`, 'Weapons & tools', { tags: 'melee knockout' }),
  item('Slingshot', 'WeaponSlingshot', `${WEAPON}WeaponSlingshot`, 'Weapons & tools', { tags: 'knockout starter' }),
  item('Bow', 'WeaponBow', `${WEAPON}WeaponBow`, 'Weapons & tools', { tags: 'ranged starter' }),
  item('Crossbow', 'WeaponCrossbow', `${WEAPON}WeaponCrossbow`, 'Weapons & tools', { tags: 'ranged' }),
  item('Compound Bow', 'WeaponCompoundBow', `${WEAPON}WeaponCompoundBow`, 'Weapons & tools', { tags: 'ranged' }),
  item('Simple Pistol', 'WeaponGun', `${WEAPON}WeaponGun`, 'Weapons & tools', { tags: 'gun' }),
  item('Longneck Rifle', 'WeaponOneShotRifle', `${WEAPON}WeaponOneShotRifle`, 'Weapons & tools', { tags: 'gun sniper tranq' }),
  item('Shotgun', 'WeaponShotgun', `${WEAPON}WeaponShotgun`, 'Weapons & tools', { tags: 'gun' }),
  item('Fabricated Pistol', 'WeaponMachinedPistol', `${WEAPON}WeaponMachinedPistol`, 'Weapons & tools', { tags: 'gun' }),
  item('Pump-Action Shotgun', 'WeaponMachinedShotgun', `${WEAPON}WeaponMachinedShotgun`, 'Weapons & tools', { tags: 'gun' }),
  item('Assault Rifle', 'WeaponRifle', `${WEAPON}WeaponRifle`, 'Weapons & tools', { tags: 'gun' }),
  item('Fabricated Sniper Rifle', 'WeaponMachinedSniper', `${WEAPON}WeaponMachinedSniper`, 'Weapons & tools', { tags: 'gun sniper' }),
  item('Rocket Launcher', 'WeaponRocketLauncher', `${WEAPON}WeaponRocketLauncher`, 'Weapons & tools', { tags: 'gun explosive' }),
  item('Tek Rifle', 'TekRifle', `${WEAPON}TekRifle`, 'Weapons & tools', { tags: 'gun endgame' }),
  item('Tek Sword', 'WeaponTekSword', `${WEAPON}WeaponTekSword`, 'Weapons & tools', { tags: 'melee endgame' }),
  item('Tek Railgun', 'TekSniper', '/Game/Aberration/WeaponTekSniper/PrimalItem_TekSniper', 'Weapons & tools', { tags: 'gun endgame' }),
  item('Tek Bow', 'WeaponTekBow', '/Game/Genesis2/Weapons/TekBow/PrimalItem_WeaponTekBow', 'Weapons & tools', { tags: 'ranged endgame' }),
  item('Electric Prod', 'WeaponProd', `${WEAPON}WeaponProd`, 'Weapons & tools', { tags: 'knockout' }),
  item('Bola', 'WeaponBola', `${WEAPON}WeaponBola`, 'Weapons & tools', { qty: 5, tags: 'trap taming' }),
  item('Chain Bola', 'ChainBola', `${AMMO}ChainBola`, 'Weapons & tools', { qty: 5, tags: 'trap taming' }),
  item('Lasso', 'WeaponLasso', `${WEAPON}WeaponLasso`, 'Weapons & tools', { tags: 'trap' }),
  item('Grappling Hook', 'GrapplingHook', null, 'Weapons & tools', { qty: 5, tags: 'climb' }),
  item('Spyglass', 'WeaponSpyglass', `${TOOL}WeaponSpyglass`, 'Weapons & tools', { tags: 'look levels' }),
  item('GPS', 'WeaponGPS', `${TOOL}WeaponGPS`, 'Weapons & tools', { tags: 'coordinates map' }),
  item('Compass', 'WeaponCompass', `${TOOL}WeaponCompass`, 'Weapons & tools', { tags: 'direction' }),
  item('Radio', 'Radio', '/Game/PrimalEarth/CoreBlueprints/Weapons/PrimalItemRadio', 'Weapons & tools', { tags: 'chat voice' }),
  item('Scissors', 'WeaponScissors', `${WEAPON}WeaponScissors`, 'Weapons & tools', { tags: 'haircut' }),
  item('Magnifying Glass', 'WeaponMagnifyingGlass', `${TOOL}WeaponMagnifyingGlass`, 'Weapons & tools', { tags: 'stats look' }),
  item('Spray Painter', 'WeaponSprayPaint', `${WEAPON}WeaponSprayPaint`, 'Weapons & tools', { tags: 'paint' }),
  item('Paintbrush', 'WeaponPaintbrush', `${WEAPON}WeaponPaintbrush`, 'Weapons & tools', { tags: 'paint' }),
  item('Flare Gun', 'WeaponFlareGun', `${WEAPON}WeaponFlareGun`, 'Weapons & tools', { tags: 'signal' }),
  item('Glow Stick', 'GlowStick', '/Game/Aberration/WeaponGlowStickThrow/PrimalItem_GlowStick', 'Weapons & tools', { qty: 10, tags: 'light aberration' }),
  item('Climbing Pick', 'WeaponClimbPick', '/Game/Aberration/CoreBlueprints/Weapons/PrimalItem_WeaponClimbPick', 'Weapons & tools', { tags: 'climb aberration' }),
  item('Cryopod', 'WeaponEmptyCryopod', '/Game/Extinction/CoreBlueprints/Weapons/PrimalItem_WeaponEmptyCryopod', 'Weapons & tools', { qty: 10, tags: 'store dino pokeball' }),
  item('Bear Trap', 'BearTrap', `${STRUCT}Misc/PrimalItemStructure_BearTrap`, 'Weapons & tools', { qty: 5, tags: 'trap taming' }),
  item('Large Bear Trap', 'BearTrap_Large', `${STRUCT}Misc/PrimalItemStructure_BearTrap_Large`, 'Weapons & tools', { qty: 5, tags: 'trap taming' }),
  item('Stone Arrow', 'ArrowStone', `${AMMO}ArrowStone`, 'Weapons & tools', { qty: 100, tags: 'ammo bow' }),
  item('Tranquilizer Arrow', 'ArrowTranq', `${AMMO}ArrowTranq`, 'Weapons & tools', { qty: 100, tags: 'ammo taming knockout' }),
  item('Metal Arrow', 'CompoundBowArrow', `${AMMO}CompoundBowArrow`, 'Weapons & tools', { qty: 100, tags: 'ammo bow' }),
  item('Simple Bullet', 'SimpleBullet', `${AMMO}SimpleBullet`, 'Weapons & tools', { qty: 100, tags: 'ammo gun' }),
  item('Advanced Rifle Bullet', 'AdvancedRifleBullet', `${AMMO}AdvancedRifleBullet`, 'Weapons & tools', { qty: 100, tags: 'ammo gun' }),
  item('Tranquilizer Dart', 'TranqDart', `${AMMO}TranqDart`, 'Weapons & tools', { qty: 50, tags: 'ammo taming knockout' }),
  item('Shotgun Shell', 'SimpleShotgunBullet', `${AMMO}SimpleShotgunBullet`, 'Weapons & tools', { qty: 100, tags: 'ammo gun' }),
  item('Rocket Propelled Grenade', 'Rocket', `${AMMO}Rocket`, 'Weapons & tools', { qty: 20, tags: 'ammo explosive' }),
  item('Scope Attachment', 'Scope', `${ATTACH}Scope`, 'Weapons & tools', { tags: 'attachment' }),
  item('Flashlight Attachment', 'Flashlight', `${ATTACH}Flashlight`, 'Weapons & tools', { tags: 'attachment light' }),

  // ------------------------------------------------------------- Resources
  item('Wood', 'Wood', `${RESOURCE}Wood`, 'Resources', { qty: 500 }),
  item('Thatch', 'Thatch', `${RESOURCE}Thatch`, 'Resources', { qty: 500 }),
  item('Fiber', 'Fibers', `${RESOURCE}Fibers`, 'Resources', { qty: 500, tags: 'fibre' }),
  item('Stone', 'Stone', `${RESOURCE}Stone`, 'Resources', { qty: 500 }),
  item('Flint', 'Flint', `${RESOURCE}Flint`, 'Resources', { qty: 300 }),
  item('Hide', 'Hide', `${RESOURCE}Hide`, 'Resources', { qty: 300 }),
  item('Pelt', 'Pelt', `${RESOURCE}Pelt`, 'Resources', { qty: 200 }),
  item('Metal', 'Metal', `${RESOURCE}Metal`, 'Resources', { qty: 300, tags: 'ore' }),
  item('Metal Ingot', 'MetalIngot', `${RESOURCE}MetalIngot`, 'Resources', { qty: 300 }),
  item('Chitin', 'Chitin', `${RESOURCE}Chitin`, 'Resources', { qty: 200 }),
  item('Keratin', 'Keratin', `${RESOURCE}Keratin`, 'Resources', { qty: 200 }),
  item('Crystal', 'Crystal', `${RESOURCE}Crystal`, 'Resources', { qty: 200 }),
  item('Obsidian', 'Obsidian', `${RESOURCE}Obsidian`, 'Resources', { qty: 200 }),
  item('Oil', 'Oil', `${RESOURCE}Oil`, 'Resources', { qty: 200 }),
  item('Silica Pearls', 'Silicon', `${RESOURCE}Silicon`, 'Resources', { qty: 200, tags: 'pearls' }),
  item('Cementing Paste', 'ChitinPaste', `${RESOURCE}ChitinPaste`, 'Resources', { qty: 200, tags: 'paste' }),
  item('Charcoal', 'Charcoal', `${RESOURCE}Charcoal`, 'Resources', { qty: 200 }),
  item('Sparkpowder', 'Sparkpowder', `${RESOURCE}Sparkpowder`, 'Resources', { qty: 200 }),
  item('Gunpowder', 'Gunpowder', `${RESOURCE}Gunpowder`, 'Resources', { qty: 200 }),
  item('Electronics', 'Electronics', `${RESOURCE}Electronics`, 'Resources', { qty: 100 }),
  item('Polymer', 'Polymer', `${RESOURCE}Polymer`, 'Resources', { qty: 100 }),
  item('Organic Polymer', 'Polymer_Organic', `${RESOURCE}Polymer_Organic`, 'Resources', { qty: 100 }),
  item('Gasoline', 'Gasoline', `${RESOURCE}Gasoline`, 'Resources', { qty: 100 }),
  item('Element', 'Element', `${RESOURCE}Element`, 'Resources', { qty: 100, tags: 'tek' }),
  item('Element Shard', 'ElementShard', `${RESOURCE}ElementShard`, 'Resources', { qty: 100, tags: 'tek' }),
  item('Black Pearl', 'BlackPearl', `${RESOURCE}BlackPearl`, 'Resources', { qty: 100 }),
  item('Angler Gel', 'AnglerGel', `${RESOURCE}AnglerGel`, 'Resources', { qty: 100 }),
  item('Rare Flower', 'RareFlower', `${RESOURCE}RareFlower`, 'Resources', { qty: 50 }),
  item('Rare Mushroom', 'RareMushroom', `${RESOURCE}RareMushroom`, 'Resources', { qty: 50 }),
  item('Wool', 'Wool', `${RESOURCE}Wool`, 'Resources', { qty: 100 }),
  item('Dinosaur Bone', 'ARKBone', `${RESOURCE}ARKBone`, 'Resources', { qty: 100, tags: 'bone' }),
  item('Sulfur', 'Sulfur', '/Game/ScorchedEarth/CoreBlueprints/Resources/PrimalItemResource_Sulfur', 'Resources', { qty: 100 }),
  item('Clay', 'Clay', '/Game/ScorchedEarth/CoreBlueprints/Resources/PrimalItemResource_Clay', 'Resources', { qty: 100 }),
  item('Silk', 'Silk', '/Game/ScorchedEarth/CoreBlueprints/Resources/PrimalItemResource_Silk', 'Resources', { qty: 100 }),
  item('Sand', 'Sand', '/Game/ScorchedEarth/CoreBlueprints/Resources/PrimalItemResource_Sand', 'Resources', { qty: 100 }),
  item('Propellant', 'Propellant', '/Game/ScorchedEarth/CoreBlueprints/Resources/PrimalItemResource_Propellant', 'Resources', { qty: 100 }),
  item('Preserving Salt', 'PreservingSalt', '/Game/ScorchedEarth/CoreBlueprints/Resources/PrimalItemResource_PreservingSalt', 'Resources', { qty: 50 }),
  item('Blue Gem', 'Gem_BioLum', '/Game/Aberration/CoreBlueprints/Resources/PrimalItemResource_Gem_BioLum', 'Resources', { qty: 100, tags: 'aberration' }),
  item('Green Gem', 'Gem_Fertile', '/Game/Aberration/CoreBlueprints/Resources/PrimalItemResource_Gem_Fertile', 'Resources', { qty: 100, tags: 'aberration' }),
  item('Red Gem', 'Gem_Element', '/Game/Aberration/CoreBlueprints/Resources/PrimalItemResource_Gem_Element', 'Resources', { qty: 100, tags: 'aberration' }),
  item('Congealed Gas Ball', 'Gas', '/Game/Aberration/CoreBlueprints/Resources/PrimalItemResource_Gas', 'Resources', { qty: 100, tags: 'aberration' }),
  item('Fungal Wood', 'FungalWood', '/Game/Aberration/CoreBlueprints/Resources/PrimalItemResource_FungalWood', 'Resources', { qty: 200, tags: 'aberration' }),
  item('Charge Battery', 'ChargeBattery', '/Game/Aberration/WeaponGlowStickCharge/PrimalItem_ChargeBattery', 'Resources', { qty: 10, tags: 'aberration' }),
  item('Element Dust', 'ElementDust', '/Game/Extinction/CoreBlueprints/Resources/PrimalItemResource_ElementDust', 'Resources', { qty: 200, tags: 'extinction' }),
  item('Scrap Metal Ingot', 'ScrapMetalIngot', '/Game/Extinction/CoreBlueprints/Resources/PrimalItemResource_ScrapMetalIngot', 'Resources', { qty: 200, tags: 'extinction' }),
  item('Blood Pack', 'BloodPack', `${CONSUM}BloodPack`, 'Resources', { qty: 50, tags: 'heal' }),
  item('Narcotic', 'Narcotic', `${CONSUM}Narcotic`, 'Resources', { qty: 100, tags: 'taming torpor' }),
  item('Stimulant', 'Stimulant', `${CONSUM}Stimulant`, 'Resources', { qty: 100, tags: 'torpor' }),
  item('Fertilizer', 'Fertilizer_Compost', `${CONSUM}Fertilizer_Compost`, 'Resources', { qty: 50, tags: 'crops farming' }),
  item('Re-Fertilizer', 'MiracleGro', `${CONSUM_DIR}BaseBPs/PrimalItemConsumableMiracleGro`, 'Resources', { qty: 20, tags: 'trees regrow' }),

  // ------------------------------------------------------- Food & medicine
  item('Cooked Meat', 'CookedMeat', `${CONSUM}CookedMeat`, 'Food & medicine', { qty: 50, tags: 'food' }),
  item('Cooked Prime Meat', 'CookedPrimeMeat', `${CONSUM}CookedPrimeMeat`, 'Food & medicine', { qty: 50, tags: 'food' }),
  item('Cooked Meat Jerky', 'CookedMeat_Jerky', `${CONSUM}CookedMeat_Jerky`, 'Food & medicine', { qty: 50, tags: 'food keeps' }),
  item('Prime Meat Jerky', 'CookedPrimeMeat_Jerky', `${CONSUM}CookedPrimeMeat_Jerky`, 'Food & medicine', { qty: 50, tags: 'food taming' }),
  item('Raw Meat', 'RawMeat', `${CONSUM}RawMeat`, 'Food & medicine', { qty: 100, tags: 'food carnivore taming' }),
  item('Raw Prime Meat', 'RawPrimeMeat', `${CONSUM}RawPrimeMeat`, 'Food & medicine', { qty: 50, tags: 'food taming' }),
  item('Raw Mutton', 'RawMutton', `${CONSUM}RawMutton`, 'Food & medicine', { qty: 50, tags: 'food taming best' }),
  item('Cooked Lamb Chop', 'CookedLambChop', `${CONSUM}CookedLambChop`, 'Food & medicine', { qty: 50, tags: 'food' }),
  item('Mejoberry', 'Berry_Mejoberry', `${CONSUM}Berry_Mejoberry`, 'Food & medicine', { qty: 200, tags: 'berry herbivore taming' }),
  item('Narcoberry', 'Berry_Narcoberry', `${CONSUM}Berry_Narcoberry`, 'Food & medicine', { qty: 100, tags: 'berry torpor' }),
  item('Stimberry', 'Berry_Stimberry', `${CONSUM}Berry_Stimberry`, 'Food & medicine', { qty: 100, tags: 'berry' }),
  item('Amarberry', 'Berry_Amarberry', `${CONSUM}Berry_Amarberry`, 'Food & medicine', { qty: 100, tags: 'berry dye' }),
  item('Azulberry', 'Berry_Azulberry', `${CONSUM}Berry_Azulberry`, 'Food & medicine', { qty: 100, tags: 'berry dye' }),
  item('Tintoberry', 'Berry_Tintoberry', `${CONSUM}Berry_Tintoberry`, 'Food & medicine', { qty: 100, tags: 'berry dye' }),
  item('Citronal', 'Veggie_Citronal', `${CONSUM}Veggie_Citronal`, 'Food & medicine', { qty: 50, tags: 'crop' }),
  item('Longrass', 'Veggie_Longrass', `${CONSUM}Veggie_Longrass`, 'Food & medicine', { qty: 50, tags: 'crop' }),
  item('Rockarrot', 'Veggie_Rockarrot', `${CONSUM}Veggie_Rockarrot`, 'Food & medicine', { qty: 50, tags: 'crop' }),
  item('Savoroot', 'Veggie_Savoroot', `${CONSUM}Veggie_Savoroot`, 'Food & medicine', { qty: 50, tags: 'crop' }),
  item('Basic Kibble', 'Kibble_Base_XSmall', `${CONSUM}Kibble_Base_XSmall`, 'Food & medicine', { qty: 30, tags: 'taming kibble' }),
  item('Simple Kibble', 'Kibble_Base_Small', `${CONSUM}Kibble_Base_Small`, 'Food & medicine', { qty: 30, tags: 'taming kibble' }),
  item('Regular Kibble', 'Kibble_Base_Medium', `${CONSUM}Kibble_Base_Medium`, 'Food & medicine', { qty: 30, tags: 'taming kibble' }),
  item('Superior Kibble', 'Kibble_Base_Large', `${CONSUM}Kibble_Base_Large`, 'Food & medicine', { qty: 30, tags: 'taming kibble' }),
  item('Exceptional Kibble', 'Kibble_Base_XLarge', `${CONSUM}Kibble_Base_XLarge`, 'Food & medicine', { qty: 30, tags: 'taming kibble' }),
  item('Extraordinary Kibble', 'Kibble_Base_Special', `${CONSUM}Kibble_Base_Special`, 'Food & medicine', { qty: 30, tags: 'taming kibble' }),
  item('Medical Brew', 'HealSoup', `${CONSUM}HealSoup`, 'Food & medicine', { qty: 30, tags: 'heal health' }),
  item('Energy Brew', 'StaminaSoup', `${CONSUM}StaminaSoup`, 'Food & medicine', { qty: 30, tags: 'stamina' }),
  item('Mindwipe Tonic', 'RespecSoup', `${CONSUM_DIR}BaseBPs/PrimalItemConsumableRespecSoup`, 'Food & medicine', { qty: 1, tags: 'respec stats' }),
  item('Lesser Antidote', 'CureLow', `${CONSUM}CureLow`, 'Food & medicine', { qty: 10, tags: 'disease swamp fever' }),
  item('Bug Repellant', 'BugRepellant', `${CONSUM}BugRepellant`, 'Food & medicine', { qty: 10, tags: 'insects' }),
  item('Waterskin (Filled)', 'WaterskinRefill', `${CONSUM}WaterskinRefill`, 'Food & medicine', { qty: 2, tags: 'water thirst' }),
  item('Canteen (Full)', 'CanteenRefill', `${CONSUM}CanteenRefill`, 'Food & medicine', { qty: 2, tags: 'water thirst' }),
  item('Battle Tartare', 'Soup_BattleTartare', `${CONSUM}Soup_BattleTartare`, 'Food & medicine', { qty: 10, tags: 'buff soup' }),
  item('Focal Chili', 'Soup_FocalChili', `${CONSUM}Soup_FocalChili`, 'Food & medicine', { qty: 10, tags: 'buff soup speed' }),
  item('Enduro Stew', 'Soup_EnduroStew', `${CONSUM}Soup_EnduroStew`, 'Food & medicine', { qty: 10, tags: 'buff soup' }),
  item('Fria Curry', 'Soup_FriaCurry', `${CONSUM}Soup_FriaCurry`, 'Food & medicine', { qty: 10, tags: 'buff soup cold' }),
  item('Calien Soup', 'Soup_CalienSoup', `${CONSUM}Soup_CalienSoup`, 'Food & medicine', { qty: 10, tags: 'buff soup heat' }),
  item('Lazarus Chowder', 'Soup_LazarusChowder', `${CONSUM}Soup_LazarusChowder`, 'Food & medicine', { qty: 10, tags: 'buff soup oxygen' }),
  item('Shadow Steak Saute', 'Soup_ShadowSteak', `${CONSUM}Soup_ShadowSteak`, 'Food & medicine', { qty: 10, tags: 'buff soup' }),
  item('Sweet Vegetable Cake', 'SweetVeggieCake', `${CONSUM}SweetVeggieCake`, 'Food & medicine', { qty: 20, tags: 'herbivore heal taming' }),
  item('Giant Bee Honey', 'Honey', `${CONSUM}Honey`, 'Food & medicine', { qty: 30, tags: 'taming bait' }),
  item('Wyvern Milk', 'WyvernMilk', null, 'Food & medicine', { qty: 10, tags: 'baby wyvern' }),

  // -------------------------------------------------------------- Structures
  item('Simple Bed', 'Bed_Simple', `${STRUCT}Misc/PrimalItemStructure_Bed_Simple`, 'Structures', { tags: 'respawn sleep' }),
  item('Campfire', 'Campfire', `${STRUCT}Misc/PrimalItemStructure_Campfire`, 'Structures', { tags: 'cook warm' }),
  item('Standing Torch', 'StandingTorch', `${STRUCT}Misc/PrimalItemStructure_StandingTorch`, 'Structures', { tags: 'light' }),
  item('Storage Box', 'StorageBox', `${STRUCT}Misc/PrimalItemStructure_StorageBox`, 'Structures', { qty: 5, tags: 'chest' }),
  item('Large Storage Box', 'StorageBox_Large', `${STRUCT}Misc/PrimalItemStructure_StorageBox_Large`, 'Structures', { qty: 5, tags: 'chest' }),
  item('Smithy', 'AnvilBench', `${STRUCT}Misc/PrimalItemStructure_AnvilBench`, 'Structures', { tags: 'craft' }),
  item('Refining Forge', 'Forge', `${STRUCT}Misc/PrimalItemStructure_Forge`, 'Structures', { tags: 'craft smelt' }),
  item('Cooking Pot', 'CookingPot', `${STRUCT}Misc/PrimalItemStructure_CookingPot`, 'Structures', { tags: 'craft food' }),
  item('Fabricator', 'Fabricator', `${STRUCT}Misc/PrimalItemStructure_Fabricator`, 'Structures', { tags: 'craft' }),
  item('Refrigerator', 'IceBox', `${STRUCT}Misc/PrimalItemStructure_IceBox`, 'Structures', { tags: 'fridge food' }),
  item('Electrical Generator', 'PowerGenerator', `${STRUCT}Pipes/PrimalItemStructure_PowerGenerator`, 'Structures', { tags: 'power electric' }),
  item('Feeding Trough', 'FeedingTrough', `${STRUCT}Misc/PrimalItemStructure_FeedingTrough`, 'Structures', { qty: 3, tags: 'dino food' }),
  item('Wooden Foundation', 'WoodFloor', `${STRUCT}Wooden/PrimalItemStructure_WoodFloor`, 'Structures', { qty: 20, tags: 'build floor' }),
  item('Wooden Wall', 'WoodWall', `${STRUCT}Wooden/PrimalItemStructure_WoodWall`, 'Structures', { qty: 20, tags: 'build' }),
  item('Wooden Ceiling', 'WoodCeiling', `${STRUCT}Wooden/PrimalItemStructure_WoodCeiling`, 'Structures', { qty: 20, tags: 'build roof' }),
  item('Wooden Door', 'WoodDoor', `${STRUCT}Wooden/PrimalItemStructure_WoodDoor`, 'Structures', { qty: 10, tags: 'build' }),
  item('Stone Foundation', 'StoneFloor', `${STRUCT}Stone/PrimalItemStructure_StoneFloor`, 'Structures', { qty: 20, tags: 'build floor' }),
  item('Stone Wall', 'StoneWall', `${STRUCT}Stone/PrimalItemStructure_StoneWall`, 'Structures', { qty: 20, tags: 'build' }),
  item('Stone Ceiling', 'StoneCeiling', `${STRUCT}Stone/PrimalItemStructure_StoneCeiling`, 'Structures', { qty: 20, tags: 'build roof' }),
  item('Stone Door', 'StoneDoor', `${STRUCT}Stone/PrimalItemStructure_StoneDoor`, 'Structures', { qty: 10, tags: 'build' }),
  item('Metal Foundation', 'MetalFloor', `${STRUCT}Metal/PrimalItemStructure_MetalFloor`, 'Structures', { qty: 20, tags: 'build floor' }),
  item('Metal Wall', 'MetalWall', `${STRUCT}Metal/PrimalItemStructure_MetalWall`, 'Structures', { qty: 20, tags: 'build' }),
  item('Metal Ceiling', 'MetalCeiling', `${STRUCT}Metal/PrimalItemStructure_MetalCeiling`, 'Structures', { qty: 20, tags: 'build roof' }),
  item('Metal Door', 'MetalDoor', `${STRUCT}Metal/PrimalItemStructure_MetalDoor`, 'Structures', { qty: 10, tags: 'build' }),
  item('Metal Ramp', 'MetalRamp', `${STRUCT}Metal/PrimalItemStructure_MetalRamp`, 'Structures', { qty: 20, tags: 'build' }),
  item('Auto Turret', 'Turret', `${STRUCT}Misc/PrimalItemStructure_Turret`, 'Structures', { qty: 5, tags: 'defence' }),
];

// --------------------------------------------------------------------- kits

/**
 * A kit is a handful of gives in one press. They exist because "everything he
 * needs to survive the first night" is one thought, not eleven.
 */
export const KITS: SpawnKit[] = [
  {
    id: 'starter',
    name: 'Starter kit',
    icon: '🎒',
    blurb: 'Hide armour, tools, a bed and enough food to get going.',
    items: [
      { gfi: 'HideHelmet', qty: 1, quality: 0 },
      { gfi: 'HideShirt', qty: 1, quality: 0 },
      { gfi: 'HidePants', qty: 1, quality: 0 },
      { gfi: 'HideGloves', qty: 1, quality: 0 },
      { gfi: 'HideBoots', qty: 1, quality: 0 },
      { gfi: 'StonePick', qty: 1 },
      { gfi: 'StoneHatchet', qty: 1 },
      { gfi: 'WeaponTorch', qty: 1 },
      { gfi: 'WeaponSpear', qty: 1 },
      { gfi: 'Bed_Simple', qty: 1 },
      { gfi: 'CookedMeat', qty: 40 },
      { gfi: 'WaterskinRefill', qty: 2 },
    ],
  },
  {
    id: 'taming',
    name: 'Taming kit',
    icon: '🥩',
    blurb: 'Bow, tranq arrows, narcotics and the meat to finish a tame.',
    items: [
      { gfi: 'WeaponCrossbow', qty: 1, quality: 0 },
      { gfi: 'ArrowTranq', qty: 200 },
      { gfi: 'WeaponOneShotRifle', qty: 1, quality: 0 },
      { gfi: 'TranqDart', qty: 100 },
      { gfi: 'Narcotic', qty: 200 },
      { gfi: 'RawPrimeMeat', qty: 100 },
      { gfi: 'Berry_Mejoberry', qty: 300 },
      { gfi: 'WeaponBola', qty: 10 },
      { gfi: 'WeaponEmptyCryopod', qty: 10 },
    ],
  },
  {
    id: 'builder',
    name: 'Builder kit',
    icon: '🧱',
    blurb: 'A pile of every raw material, plus the benches to spend it on.',
    items: [
      { gfi: 'Wood', qty: 2000 },
      { gfi: 'Thatch', qty: 2000 },
      { gfi: 'Fibers', qty: 2000 },
      { gfi: 'Stone', qty: 2000 },
      { gfi: 'MetalIngot', qty: 1000 },
      { gfi: 'ChitinPaste', qty: 500 },
      { gfi: 'Crystal', qty: 500 },
      { gfi: 'Polymer', qty: 300 },
      { gfi: 'Electronics', qty: 300 },
      { gfi: 'AnvilBench', qty: 1 },
      { gfi: 'Forge', qty: 1 },
      { gfi: 'Fabricator', qty: 1 },
    ],
  },
  {
    id: 'flak',
    name: 'Flak & guns',
    icon: '🛡️',
    blurb: 'A full flak set at top quality, a rifle and plenty of ammunition.',
    items: [
      { gfi: 'MetalHelmet', qty: 1, quality: 100 },
      { gfi: 'MetalShirt', qty: 1, quality: 100 },
      { gfi: 'MetalPants', qty: 1, quality: 100 },
      { gfi: 'MetalGloves', qty: 1, quality: 100 },
      { gfi: 'MetalBoots', qty: 1, quality: 100 },
      { gfi: 'WeaponRifle', qty: 1, quality: 100 },
      { gfi: 'AdvancedRifleBullet', qty: 300 },
      { gfi: 'WeaponMachinedShotgun', qty: 1, quality: 100 },
      { gfi: 'SimpleShotgunBullet', qty: 200 },
      { gfi: 'HealSoup', qty: 30 },
    ],
  },
  {
    id: 'tek',
    name: 'Full Tek',
    icon: '💠',
    blurb: 'The whole Tek suit, a Tek rifle and element to keep it running.',
    items: [
      { gfi: 'TekHelmet', qty: 1, quality: 100 },
      { gfi: 'TekShirt', qty: 1, quality: 100 },
      { gfi: 'TekPants', qty: 1, quality: 100 },
      { gfi: 'TekGloves', qty: 1, quality: 100 },
      { gfi: 'TekBoots', qty: 1, quality: 100 },
      { gfi: 'TekRifle', qty: 1, quality: 100 },
      { gfi: 'WeaponTekSword', qty: 1, quality: 100 },
      { gfi: 'Element', qty: 300 },
    ],
  },
  {
    id: 'explorer',
    name: 'Explorer kit',
    icon: '🧭',
    blurb: 'Scuba gear, climbing pick, glow sticks and the tools for reading a map.',
    items: [
      { gfi: 'ScubaHelmet_Goggles', qty: 1, quality: 0 },
      { gfi: 'ScubaShirt_SuitWithTank', qty: 1, quality: 0 },
      { gfi: 'ScubaPants', qty: 1, quality: 0 },
      { gfi: 'ScubaBoots_Flippers', qty: 1, quality: 0 },
      { gfi: 'WeaponClimbPick', qty: 1 },
      { gfi: 'GrapplingHook', qty: 10 },
      { gfi: 'Parachute', qty: 10 },
      { gfi: 'GlowStick', qty: 20 },
      { gfi: 'WeaponSpyglass', qty: 1 },
      { gfi: 'WeaponGPS', qty: 1 },
    ],
  },
];

// ------------------------------------------------------------------ credits

/**
 * Rendered in the UI. Dododex sits first because it is the site most people
 * mean when they say "look up the dino" - and because linking out to it is the
 * point: ASMS carries ARK's identifiers, Dododex carries the knowledge built
 * on top of them.
 */
export const SPAWN_SOURCES: SpawnSource[] = [
  {
    name: 'Dododex',
    url: 'https://www.dododex.com/',
    note: 'Taming times, food counts, stats and strategy. Every creature here links straight to its Dododex page — none of their data is copied into ASMS.',
  },
  {
    name: 'ARK Official Community Wiki',
    url: 'https://ark.wiki.gg/wiki/Creature_IDs',
    note: 'Where the entity ids and blueprint paths in this list were checked against.',
  },
];

/**
 * Every gfi a kit or a creature's saddle points at must exist in ITEMS, or the
 * UI silently drops half a kit. Cheap enough to check on every boot, and it
 * turns a typo into a startup failure instead of a missing chestpiece.
 */
export function danglingSpawnRefs(): string[] {
  const known = new Set(ITEMS.map((i) => i.gfi));
  const bad: string[] = [];
  for (const kit of KITS) {
    for (const entry of kit.items) {
      if (!known.has(entry.gfi)) bad.push(`kit ${kit.id} -> ${entry.gfi}`);
    }
  }
  for (const creature of CREATURES) {
    if (creature.saddle && !known.has(creature.saddle)) bad.push(`${creature.name} saddle -> ${creature.saddle}`);
  }
  return bad;
}
