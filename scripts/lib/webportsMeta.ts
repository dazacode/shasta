// What the Ultimate Catalog of Web Game Ports listings should say, shared by scripts/import-webports.ts (so a re-run
// keeps it) and scripts/clean-webports.ts (which applies it to the live Store).
//
// The first import credited each port's HOST as the game's developer ("Rgc", "Wasm", "Shasta") and used whatever blurb
// the play page had, and the catalogue lists one game several times (one row per port). Here every game gets:
//   - one listing: the other ports of the same game are folded into it (`merge`) and named in its description;
//   - its real name and the original makers + publisher, read from the game's Wikipedia article (`wiki`, an exact
//     article title checked by hand; search was tried and matched "Doom (franchise)", the FNAF film and the Twilight
//     Princess manga) and that article's Wikidata entry (P178 developer, P123 publisher, P136 genre);
//   - `wiki: null` where no article is about this game (fan games, mods, expansions): no maker is invented then.
// Keys are the catalogue row names, which are the app names the import created.

export interface PortMeta {
	/** the name to show, when it differs from the catalogue row */
	name?: string;
	/** exact English Wikipedia article about this game; null = there is none, never guess one */
	wiki?: string | null;
	/** other catalogue rows that are ports of the same game: unlisted, named in this listing's description */
	merge?: string[];
	/** the listing text was written by hand in import-webports.ts OVERRIDES: keep its summary/description/credits */
	keepText?: boolean;
}

// Names: where another import already lists the same game under its plain name (gn-math, Obsidian, the Archive; often
// another build or an emulated console version), this listing keeps a short note of which port it is, so the Store
// never shows two identical tiles. scripts/clean-webports.ts reports any new clash.

/** Catalogue rows that are not a game: directories and portals of other ports. Unlisted. */
export const DROP: readonly string[] = ["wasm.rip", "Dos.Zone", "WASM Arcade", "WadCMD", "koi/_flixel"];

/** Catalogue rows another import already lists as the same build (row -> that listing). Unlisted here. */
export const ELSEWHERE: Readonly<Record<string, string>> = {
	// the catalogue calls it "Deltarune", but the genizy dir is the fan game DELTATRAVELER, which gn-math lists already
	Deltarune: "deltatraveler",
};

export const PORTS: Record<string, PortMeta> = {
	"The Simpsons: Hit & Run (with mod support)": { name: "The Simpsons: Hit & Run", wiki: "The Simpsons: Hit & Run", merge: ["The Simpsons: Hit & Run (Web Port)", "The Simpsons: Hit & Run (rgc.zone)", "The Simpsons: Hit & Run (shar-wasm)", "The Simpsons: Hit & Run"] },
	"Halo: Combat Evolved": { wiki: "Halo: Combat Evolved", merge: ["Halo: Combat Evolved (OpenCE)", "Halo: Combat Evolved (Combat Lab)", "Halo: Combat Evolved Mobile"] },
	"Super Mario 64 (rgc.zone)": { name: "Super Mario 64 (PC port)", wiki: "Super Mario 64", merge: ["Super Mario 64 (multiplayer, olivers.tools)", "Super Mario 64 Multiplayer", "Super Mario 64 (sm3das)"] },
	"Doom (joeheyming, classic and mods)": { name: "Doom (classic and mods)", wiki: "Doom (1993 video game)", merge: ["Doom (WebDOOM)", "Doom Multiplayer", "DOOM I & II"] },
	"Doom 3 (D3Wasm)": { name: "Doom 3 (D3Wasm)", wiki: "Doom 3", merge: ["Doom 3 Demo"] },
	"Quake II": { wiki: "Quake II", merge: ["Quake II (q2.pieter.com)", "Quake II (Quake WASM2)"] },
	"Quake III Arena (q3js)": { name: "Quake III Arena (q3js)", wiki: "Quake III Arena", merge: ["Quake III Arena (q3.pieter.com)"] },
	"Need for Speed: Most Wanted (2005) (dezm0n web port)": { name: "Need for Speed: Most Wanted (2005)", wiki: "Need for Speed: Most Wanted (2005 video game)", merge: ["Need for Speed: Most Wanted (2005) (NFSMW Online)", "Need for Speed: Most Wanted (2005) (NFSMW Online web)"] },
	"Duke Nukem 3D": { wiki: "Duke Nukem 3D", merge: ["Duke Nukem 3D (eduke32-wasm)", "Duke Nukem 3D TG"] },
	"Arx Fatalis (rgc.zone)": { name: "Arx Fatalis", wiki: "Arx Fatalis", merge: ["Arx Fatalis (Arxwasm Demo)"] },
	"Descent (DXX-Rebirth)": { name: "Descent", wiki: "Descent (video game)", merge: ["Descent"] },
	Diablo: { wiki: "Diablo (video game)", merge: ["Diablo (diablo_web)"] },
	"Heroes of Might and Magic II (fheroes2, rgc.zone)": { name: "Heroes of Might and Magic II", wiki: "Heroes of Might and Magic II", merge: ["Heroes of Might and Magic II"] },
	"Hexen II (Hexenwail)": { name: "Hexen II", wiki: "Hexen II", merge: ["Hexen II"] },
	"Return to Castle Wolfenstein": { wiki: "Return to Castle Wolfenstein", merge: ["Return to Castle Wolfenstein (rtcw.pieter.com)"] },
	"Star Wars Jedi Knight: Jedi Academy": { wiki: "Star Wars Jedi Knight: Jedi Academy", merge: ["Star Wars Jedi Knight: Jedi Academy (OpenJK, rgc.zone)"] },
	"Grand Theft Auto: Vice City (revc.wasm.ltd)": { name: "Grand Theft Auto: Vice City (reVC)", wiki: "Grand Theft Auto: Vice City", merge: ["Grand Theft Auto: Vice City (quenq)", "GTA Vice City"] },
	"Claude of Duty: Vibe Slops II": { wiki: null, merge: ["Claude of Duty: Vibe Slops II (GoofyAhhBro69420 mirror)"] },
	"Cut the Rope DX": { wiki: "Cut the Rope", merge: ["Cut the Rope (H5DX)"] },
	"Deltarune Chapters 1-4": { name: "Deltarune", wiki: "Deltarune" },
	"Phantasy Star Online Episode I & II (PSO Reborn)": { name: "Phantasy Star Online Episode I & II", wiki: "Phantasy Star Online", merge: ["Phantasy Star Online (PSO Reborn)"] },
	"Minecraft 1.8.8 (EaglercraftX)": { name: "Minecraft (Eaglercraft)", wiki: "Minecraft", merge: ["Minecraft 0.6.1", "Eaglercraft"] },
	"Wolfenstein 3D (HTML5, lazarv)": { name: "Wolfenstein 3D (HTML5)", wiki: "Wolfenstein 3D", merge: ["Wolfenstein 3D TG"] },
	"Counter Strike & Half Life": { name: "Half-Life and Counter-Strike", wiki: "Half-Life (video game)", merge: ["Half-Life and Counter-Strike 1.6 (WebXash)"] },
	"Call of Duty: Black Ops Zombies": { wiki: "Call of Duty: Black Ops", keepText: true, merge: ["Kino der Toten", "Kino der Toten (GoofyAhhBro69420 mirror)", "Kino der Toten (theeagler1234 mirror)", "Moon (Zombies)", "Moon (Black Ops Zombies, vel.gg)", "Nacht der Untoten"] },
	Quake: { wiki: "Quake (video game)", merge: ["NetQuake.io", "QuakeWorld", "Quake TG"] },
	"WWE SmackDown vs. Raw 2011": { wiki: "WWE SmackDown vs. Raw 2011" },
	"WWE SmackDown vs. Raw 2010": { wiki: "WWE SmackDown vs. Raw 2010" },
	"WWE SmackDown! Here Comes the Pain": { wiki: "WWE SmackDown! Here Comes the Pain" },
	"WWE SmackDown! vs. RAW": { name: "WWE SmackDown! vs. Raw", wiki: "WWE SmackDown! vs. Raw" },
	"The Warriors": { wiki: "The Warriors (video game)" },
	xrick: { name: "Rick Dangerous (xrick)", wiki: "Rick Dangerous" },
	"WWII GI": { name: "World War II GI", wiki: "World War II GI" },
	"Zelda II: The Adventure of Link (z2rs)": { name: "Zelda II: The Adventure of Link", wiki: "Zelda II: The Adventure of Link" },
	"WW2 GI: Platoon Leader": { wiki: null },
	"Virtua Tennis 2": { wiki: "Virtua Tennis 2" },
	"Witchaven II": { name: "Witchaven II: Blood Vengeance", wiki: "Witchaven II: Blood Vengeance" },
	"UFC 2009 Undisputed / Throwdown": { wiki: "UFC 2009 Undisputed" },
	Witchaven: { wiki: "Witchaven" },
	"Urban Terror": { wiki: "Urban Terror" },
	"Warzone 2100 (Web Edition)": { wiki: "Warzone 2100" },
	"William Shatner's TekWar": { wiki: "William Shatner's TekWar" },
	WipEout: { wiki: "Wipeout (video game)" },
	"Warcraft II (Wargus)": { name: "Warcraft II: Tides of Darkness", wiki: "Warcraft II: Tides of Darkness" },
	"Virtual On: Cyber Troopers": { wiki: "Virtual On: Cyber Troopers" },
	"Tony Hawk's Pro Skater 3": { wiki: "Tony Hawk's Pro Skater 3" },
	"Tekken 5": { wiki: "Tekken 5" },
	Tremulous: { wiki: "Tremulous" },
	"Tekken 4": { wiki: "Tekken 4" },
	"Virtua Fighter": { wiki: "Virtua Fighter (video game)" },
	"Unreal Tournament (SurrealEngine Web)": { name: "Unreal Tournament", wiki: "Unreal Tournament" },
	"Ultrakill Prelude": { wiki: "Ultrakill" },
	"Tsukihime (TsukiWeb)": { name: "Tsukihime", wiki: "Tsukihime" },
	"Tyrian (OpenTyrian)": { name: "Tyrian", wiki: "Tyrian (video game)" },
	"Tekken: Dark Resurrection": { name: "Tekken 5: Dark Resurrection", wiki: "Tekken 5: Dark Resurrection", merge: ["Tekken 5: Dark Resurrection (Recomp)"] },
	Toonstruck: { wiki: "Toonstruck" },
	// OpenLara: the 1996 game
	"Tomb Raider": { wiki: "Tomb Raider (1996 video game)" },
	"Street Fighter III: 3rd Strike": { wiki: "Street Fighter III: 3rd Strike" },
	// a fan simulator (Taiko Web) of the series
	"Taiko no Tatsujin": { name: "Taiko no Tatsujin (Taiko Web)", wiki: "Taiko no Tatsujin" },
	"Super Smash Bros. (smash.fun)": { name: "Super Smash Bros.", wiki: "Super Smash Bros. (video game)" },
	"Super Mario Zombies": { wiki: null },
	"Street Fighter Anniversary Collection": { wiki: "Street Fighter Anniversary Collection" },
	"Super Monkey Ball": { wiki: "Super Monkey Ball (video game)" },
	"Spider-Man 2": { wiki: "Spider-Man 2 (2004 video game)" },
	"SSX 3": { wiki: "SSX 3" },
	"Super Mario Sunshine": { wiki: "Super Mario Sunshine" },
	"Super Mario Kart (SM-Kart-ZX Web Port)": { name: "Super Mario Kart", wiki: "Super Mario Kart" },
	"Sonic the Hedgehog 4: Episode I": { wiki: "Sonic the Hedgehog 4: Episode I" },
	"Stunts (PlayStunts)": { name: "Stunts", wiki: "Stunts (video game)" },
	"Star Fox Adventures": { wiki: "Star Fox Adventures" },
	"Star Wars Jedi Knight Dark Forces 2": { name: "Star Wars Jedi Knight: Dark Forces II", wiki: "Star Wars Jedi Knight: Dark Forces II" },
	"Space Rangers: Quests": { wiki: null },
	"Sonic Worlds Next": { wiki: null },
	// Sonic-1-WASM: the 1991 game
	"Sonic the Hedgehog": { wiki: "Sonic the Hedgehog (1991 video game)" },
	"Sonic the Fighters": { wiki: "Sonic the Fighters" },
	"Sonic Robo Blast 2 Kart": { wiki: null },
	"Sonic CD (Sonic-CD-WASM)": { name: "Sonic CD (WASM)", wiki: "Sonic CD" },
	"Slender: The Eight Pages": { wiki: "Slender: The Eight Pages" },
	"Slay the Spire": { wiki: "Slay the Spire" },
	"Skate 3": { wiki: "Skate 3" },
	"Skate × Rust (Global Terror)": { wiki: null, keepText: true },
	"Silkroad Online (OpenSRO)": { name: "Silkroad Online", wiki: "Silkroad Online" },
	// richardatct/simgolf-web: "Sid Meier's SimGolf (2002)"
	SimGolf: { name: "Sid Meier's SimGolf", wiki: "Sid Meier's SimGolf" },
	"SimCity (micropolisJS)": { name: "SimCity (Micropolis)", wiki: "SimCity (1989 video game)" },
	"RuneScape Classic": { wiki: "RuneScape Classic" },
	"Resident Evil 4": { wiki: "Resident Evil 4" },
	"The Seven Games of the Soul": { wiki: null },
	"Silent Hill: Origins": { wiki: "Silent Hill: Origins" },
	"Shadow Warrior": { wiki: "Shadow Warrior (1997 video game)" },
	"Shadow Warrior: Wanton Destruction": { wiki: null },
	"Shadow Warrior: Twin Dragon": { wiki: null },
	"Ratchet & Clank: Size Matters": { wiki: "Ratchet & Clank: Size Matters" },
	"S.T.A.L.K.E.R.: Call of Pripyat (ZoneVM)": { name: "S.T.A.L.K.E.R.: Call of Pripyat", wiki: "S.T.A.L.K.E.R.: Call of Pripyat" },
	"RollerCoaster Tycoon 2 (OpenRCT2)": { name: "RollerCoaster Tycoon 2", wiki: "RollerCoaster Tycoon 2" },
	"Road Rash (Three.js)": { name: "Road Rash (3D remake)", wiki: "Road Rash (1991 video game)" },
	"Rocks'n'Diamonds": { wiki: "Rocks'n'Diamonds" },
	"Resident Evil Outbreak File #1 & #2 (Outbreak Web)": { name: "Resident Evil Outbreak File #1 & #2", wiki: "Resident Evil Outbreak" },
	"Redneck Rampage: Route 66": { wiki: null },
	"Reset Generation": { wiki: "Reset Generation" },
	"Redneck Rampage: Rides Again": { name: "Redneck Rampage Rides Again", wiki: "Redneck Rampage Rides Again" },
	"Redneck Rampage": { wiki: "Redneck Rampage" },
	"Ratchet & Clank": { wiki: "Ratchet & Clank (2002 video game)" },
	"Pro Evolution Soccer 2012": { wiki: "Pro Evolution Soccer 2012" },
	"Quest for Hussein": { wiki: null },
	"Quest for Al-Qa'eda": { wiki: null },
	"Pro Evolution Soccer 2014 (PSP)": { name: "Pro Evolution Soccer 2014", wiki: "Pro Evolution Soccer 2014" },
	"Pro Evolution Soccer 6": { wiki: "Pro Evolution Soccer 6" },
	"Promises to Keep": { wiki: null },
	"Pro Evolution Soccer 2011": { wiki: "Pro Evolution Soccer 2011" },
	"Prince of Persia": { wiki: "Prince of Persia (1989 video game)" },
	Powerslave: { name: "PowerSlave", wiki: "PowerSlave" },
	// a fan game in the style of the series
	"Pokémon Mystery Dungeon (Web Mystery Dungeon)": { wiki: null },
	"NFL Street": { wiki: "NFL Street" },
	"Plunder & Pillage": { wiki: null },
	Pikmin: { wiki: "Pikmin (video game)" },
	"Perfect Dark": { wiki: "Perfect Dark" },
	OpenTTD: { wiki: "OpenTTD" },
	"Penthouse Paradise": { wiki: null },
	Pepsiman: { wiki: "Pepsiman (video game)" },
	"Need for Speed: Underground 2 (nfsunderground2.site)": { name: "Need for Speed: Underground 2 (browser port)", wiki: "Need for Speed: Underground 2" },
	"NBA Street V3": { wiki: "NBA Street V3" },
	"Pekka Kana 2": { wiki: "Pekka Kana 2" },
	"Naruto Shippuden: Ultimate Ninja 5": { wiki: null },
	"Open Sonic": { wiki: null },
	"No One Lives Forever": { name: "The Operative: No One Lives Forever", wiki: "The Operative: No One Lives Forever" },
	"Naruto Shippuden: Ultimate Ninja Impact": { wiki: "Naruto Shippuden: Ultimate Ninja Impact" },
	"NHL '94": { wiki: "NHL '94" },
	"Monster Hunter Freedom Unite": { wiki: "Monster Hunter Freedom Unite" },
	"Mortal Kombat: Shaolin Monks": { wiki: "Mortal Kombat: Shaolin Monks" },
	"NCAA Football 10 (PSP Recomp)": { name: "NCAA Football 10", wiki: "NCAA Football 10" },
	// NBlood: a source port of Blood
	NBlood: { name: "Blood (NBlood)", wiki: "Blood (video game)" },
	"Midnight Club 3: DUB Edition": { wiki: "Midnight Club 3: Dub Edition" },
	"NBA 2K12": { wiki: "NBA 2K12" },
	"Madden NFL 08": { wiki: "Madden NFL 08" },
	"Marvel vs. Capcom 2": { name: "Marvel vs. Capcom 2: New Age of Heroes", wiki: "Marvel vs. Capcom 2: New Age of Heroes" },
	"NAM / Napalm": { wiki: "NAM (video game)" },
	"Mini DayZ": { wiki: null },
	"Minecraft Story Mode": { name: "Minecraft: Story Mode", wiki: "Minecraft: Story Mode" },
	"Milkman Karlson": { wiki: null },
	"Medabots AX": { wiki: "Medabots AX: Metabee and Rokusho" },
	"Master of Defence": { wiki: null },
	"Jak and Daxter: The Lost Frontier": { wiki: "Jak and Daxter: The Lost Frontier" },
	"Luigi's Picture Poker": { wiki: null },
	"The Man From the Window": { wiki: null },
	"Luanti (Minetest)": { name: "Luanti", wiki: "Luanti" },
	Lugaru: { wiki: "Lugaru" },
	"Liquidator 3D": { wiki: null },
	"LEGO Island": { name: "Lego Island", wiki: "Lego Island" },
	"Legend of Legaia": { wiki: "Legend of Legaia" },
	"LEGO Racers": { name: "Lego Racers", wiki: "Lego Racers" },
	Limbo: { wiki: "Limbo (video game)" },
	"Lenin: First Blood": { wiki: null },
	"The Legend of Zelda: Twilight Princess (Dusklight)": { name: "The Legend of Zelda: Twilight Princess", wiki: "The Legend of Zelda: Twilight Princess" },
	"Kirby & The Amazing Mirror (katam-port)": { name: "Kirby & the Amazing Mirror", wiki: "Kirby & the Amazing Mirror" },
	"Karlson 2D": { wiki: null },
	"Kingdom Hearts: Chain of Memories (RepliCoM)": { name: "Kingdom Hearts: Chain of Memories", wiki: "Kingdom Hearts: Chain of Memories" },
	"Hot Shots Tennis (OpenTennis)": { name: "Hot Shots Tennis", wiki: "Hot Shots Tennis" },
	"Kindergarten 1 & 2": { wiki: null },
	"I Can't Believe It's Not Sonic 1": { wiki: null },
	Homeworld: { wiki: "Homeworld" },
	"Gran Turismo 4": { wiki: "Gran Turismo 4" },
	"HERETIC / HEXEN": { name: "Heretic and Hexen", wiki: "Heretic (video game)" },
	"Harry Potter and the Chamber of Secrets": { wiki: "Harry Potter and the Chamber of Secrets (video game)" },
	"Hard Truck / Hard Truck 2 (Дальнобойщики 1 и 2)": { name: "Hard Truck and Hard Truck 2", wiki: "Hard Truck" },
	"God of War: Ghost of Sparta": { wiki: "God of War: Ghost of Sparta" },
	"God of War: Chains of Olympus": { wiki: "God of War: Chains of Olympus" },
	// an archived copy of playgta5.com; no source, no maker
	"GTA V": { wiki: null },
	"Grand Theft Auto III Online (quenq)": { name: "Grand Theft Auto III (browser port)", wiki: "Grand Theft Auto III" },
	"Grand Theft Auto: Chinatown Wars (PPSSPP Web)": { name: "Grand Theft Auto: Chinatown Wars", wiki: "Grand Theft Auto: Chinatown Wars" },
	"Grand Theft Auto 2": { wiki: "Grand Theft Auto 2" },
	"Formula One 06": { wiki: "Formula One 06" },
	"Gran Turismo 2": { wiki: "Gran Turismo 2" },
	"FIFA Street": { wiki: "FIFA Street (2005 video game)" },
	"Golden Sun": { wiki: "Golden Sun (video game)" },
	"FIFA 10 (PSP)": { wiki: "FIFA 10" },
	"FIFA 12": { wiki: "FIFA 12" },
	"FIFA 13": { wiki: "FIFA 13" },
	"GoldenEye 007 (GoldenWeb64)": { name: "GoldenEye 007", wiki: "GoldenEye 007 (1997 video game)" },
	"Getting Over It": { name: "Getting Over It (browser port)", wiki: "Getting Over It with Bennett Foddy" },
	"FIFA 14 (PSP)": { name: "FIFA 14", wiki: "FIFA 14" },
	"Flight of the Amazon Queen (ScummWeb)": { name: "Flight of the Amazon Queen", wiki: "Flight of the Amazon Queen" },
	"Geometry Dash (Web Dashers)": { wiki: "Geometry Dash" },
	"Freeciv (Freeciv-web)": { name: "Freeciv", wiki: "Freeciv" },
	"FIFA Street 2": { wiki: "FIFA Street 2" },
	FNAF: { name: "Five Nights at Freddy's (browser port)", wiki: "Five Nights at Freddy's (video game)" },
	"Feed & Grow Fish": { wiki: null },
	"Fears To Fathom": { name: "Fears to Fathom", wiki: "Fears to Fathom" },
	"Fallout: Nevada / Sonora": { wiki: null },
	"Fatal Racing": { wiki: "Fatal Racing" },
	// exlmoto's port of the MediaTek phone game, not Nintendo's 1984 F1 Race
	"F1 Race (MTK)": { wiki: null },
	"Faster Than Light: Demo": { name: "FTL: Faster Than Light (demo)", wiki: "FTL: Faster Than Light" },
	// the series article covers the sequels (same makers)
	"Dragon Ball Z: Budokai Tenkaichi 2": { wiki: "Dragon Ball Z: Budokai Tenkaichi" },
	"Dragon Ball Z: Budokai 3": { wiki: "Dragon Ball Z: Budokai 3" },
	"The Elder Scrolls III: Morrowind (OpenMW)": { name: "The Elder Scrolls III: Morrowind", wiki: "The Elder Scrolls III: Morrowind" },
	"Downhill Domination": { wiki: "Downhill Domination" },
	"Dungeon Keeper": { wiki: "Dungeon Keeper" },
	"EA Sports Cricket 07": { name: "Cricket 07", wiki: "Cricket 07" },
	"Dune II": { wiki: "Dune II", merge: ["DUNE II TG"] },
	"Drascula: The Vampire Strikes Back (ScummWeb)": { name: "Drascula: The Vampire Strikes Back", wiki: "Dráscula: The Vampire Strikes Back" },
	// add-ons by other studios, covered only inside the Duke Nukem 3D article
	"Duke: Nuclear Winter": { wiki: null },
	"Duke It Out in D.C.": { wiki: null },
	"Dude Simulator 2": { wiki: null },
	"Duke Caribbean: Life's a Beach": { wiki: null },
	"Dragon Ball Z: Budokai Tenkaichi 3": { wiki: "Dragon Ball Z: Budokai Tenkaichi" },
	"Diddy Kong Racing (Golden Balloon)": { name: "Diddy Kong Racing", wiki: "Diddy Kong Racing" },
	"Def Jam: Fight for NY": { wiki: "Def Jam: Fight for NY" },
	"Doki Doki Literature Club Plus!": { wiki: "Doki Doki Literature Club!" },
	"Crisis Core: Final Fantasy VII": { wiki: "Crisis Core: Final Fantasy VII" },
	"Crash Nitro Kart": { wiki: "Crash Nitro Kart" },
	"Daggerfall (DaggerfallJS)": { name: "The Elder Scrolls II: Daggerfall", wiki: "The Elder Scrolls II: Daggerfall" },
	Deadseat: { wiki: null },
	"Daytona USA": { wiki: "Daytona USA (video game)" },
	"Counter Strike 1.6": { name: "Counter-Strike 1.6", wiki: "Counter-Strike (video game)" },
	"Counter-Strike: Source Bunnyhop": { wiki: null },
	"Crash Bash Online": { name: "Crash Bash", wiki: "Crash Bash" },
	"Cro-Mag Rally": { wiki: "Cro-Mag Rally" },
	Createrria: { wiki: null },
	"Crash Team Racing (High Octane)": { name: "Crash Team Racing", wiki: "Crash Team Racing", merge: ["Crash Team Racing Turbocharged"] },
	"Counter-Strike: Source Surf": { wiki: null },
	"Counter Strike 2019": { wiki: null },
	"Command & Conquer: Generals Zero Hour": { name: "Command & Conquer: Generals – Zero Hour", wiki: "Command & Conquer: Generals – Zero Hour" },
	"Command & Conquer: Renegade (Open Commando)": { name: "Command & Conquer: Renegade", wiki: "Command & Conquer: Renegade" },
	"Beneath a Steel Sky (ScummWeb)": { name: "Beneath a Steel Sky", wiki: "Beneath a Steel Sky" },
	// Chocolate Keen: episodes 1-3
	"Commander Keen": { name: "Commander Keen in Invasion of the Vorticons", wiki: "Commander Keen in Invasion of the Vorticons" },
	"Burnout 3: Takedown": { wiki: "Burnout 3: Takedown" },
	"Command & Conquer: Generals (wasm.com.br)": { name: "Command & Conquer: Generals", wiki: "Command & Conquer: Generals" },
	"Command & Conquer: Red Alert 2": { wiki: "Command & Conquer: Red Alert 2" },
	"Chasm: The Rift": { wiki: "Chasm: The Rift" },
	"Cheese Cube": { wiki: null },
	"Castle Crashers": { wiki: "Castle Crashers" },
	"Call of Mini: Dino Hunter (Revival)": { wiki: null },
	"Battle Stadium D.O.N": { wiki: "Battle Stadium D.O.N" },
	"Bumpy's Arcade Fantasy": { wiki: "Bumpy's Arcade Fantasy" },
	"Call of Duty: Modern Warfare 2": { wiki: "Call of Duty: Modern Warfare 2" },
	"Call of Duty Web Collection": { wiki: null },
	"Caesar II": { wiki: "Caesar II" },
	"Brutal Doom": { wiki: "Brutal Doom" },
	Brawlhalla: { wiki: "Brawlhalla" },
	// Repentance is Rebirth's last expansion (same makers); it has no article of its own
	"The Binding of Isaac: Repentance": { wiki: "The Binding of Isaac: Rebirth" },
	"Battle City": { wiki: "Battle City (video game)" },
	"Ballerburg SDL": { name: "Ballerburg", wiki: "Ballerburg" },
	"Alley Cat": { wiki: "Alley Cat (video game)" },
	"American McGee’s Alice": { name: "American McGee's Alice", wiki: "American McGee's Alice" },
	"3D Pinball for Windows - Space Cadet": { name: "3D Pinball for Windows – Space Cadet", wiki: "Full Tilt! Pinball" },
	"Atlantis: The Lost Tales": { wiki: "Atlantis: The Lost Tales" },
	"Amazing Alex": { wiki: "Amazing Alex" },
};

/** row name -> the listing it was folded into */
export const MERGED: ReadonlyMap<string, string> = new Map(Object.entries(PORTS).flatMap(([primary, m]) => (m.merge ?? []).map((alt) => [alt, primary] as const)));

/** Wikidata genre label (lower case, substring) -> Store tags that feed services/genres.ts */
const GENRE_TAGS: [RegExp, string[]][] = [
	[/first-person shooter/, ["fps", "shooter"]],
	[/third-person shooter|tactical shooter|shooter game|run and gun/, ["shooter"]],
	[/shoot 'em up|shoot-'em-up|scrolling shooter/, ["shoot-em-up"]],
	[/platform/, ["platformer"]],
	[/action-adventure/, ["action-adventure"]],
	[/hack and slash/, ["hack-and-slash"]],
	[/beat 'em up/, ["beat-em-up"]],
	[/fighting|wrestling|boxing|mixed martial arts/, ["fighting"]],
	[/action role-playing/, ["action-rpg"]],
	[/japanese role-playing/, ["jrpg"]],
	[/massively multiplayer/, ["mmo"]],
	[/role-playing/, ["rpg"]],
	[/survival horror/, ["survival-horror"]],
	[/psychological horror/, ["psychological-horror"]],
	[/horror/, ["horror"]],
	[/graphic adventure|point-and-click/, ["point-and-click"]],
	[/adventure/, ["adventure"]],
	[/kart/, ["kart", "racing"]],
	[/racing|driving|vehicular/, ["racing"]],
	[/association football|soccer/, ["soccer", "sports"]],
	[/basketball/, ["basketball", "sports"]],
	[/american football/, ["football", "sports"]],
	[/golf/, ["golf", "sports"]],
	[/skateboard|snowboard|extreme sports/, ["skateboarding", "sports"]],
	[/sports|tennis|cricket|hockey|wrestling/, ["sports"]],
	[/real-time strategy/, ["rts", "strategy"]],
	[/turn-based strategy|4x/, ["turn-based-strategy", "strategy"]],
	[/tower defense/, ["tower-defense"]],
	[/strategy|tactics|wargame/, ["strategy"]],
	[/city-building|construction and management/, ["building", "simulation"]],
	[/business simulation|tycoon/, ["tycoon", "simulation"]],
	[/simulation|simulator/, ["simulation"]],
	[/sandbox/, ["sandbox"]],
	[/survival/, ["survival"]],
	[/open world/, ["open-world"]],
	[/roguelite/, ["roguelite"]],
	[/roguelike/, ["roguelike"]],
	[/dungeon crawl/, ["dungeon-crawler"]],
	[/metroidvania/, ["metroidvania"]],
	[/puzzle/, ["puzzle"]],
	[/rhythm|music video game/, ["rhythm"]],
	[/visual novel/, ["visual-novel"]],
	[/deck-building|digital collectible card|card game/, ["card-game"]],
	[/pinball|arcade/, ["arcade"]],
	[/party/, ["party"]],
	[/stealth|action game/, ["action"]],
];

export function genreTags(labels: string[]): string[] {
	const out: string[] = [];
	for (const raw of labels) {
		const l = raw.toLowerCase();
		for (const [re, tags] of GENRE_TAGS) if (re.test(l)) for (const t of tags) if (!out.includes(t)) out.push(t);
	}
	return out;
}

// ---- text from a Wikipedia lead ------------------------------------------------------------------------------
// lead sections carry pronunciations and native-script names in brackets; a Store description does not need them
export function tidyExtract(s: string): string {
	return s
		.replace(/\s*\((?:[^()]*\([^()]*\))*[^()]*(?:Japanese|Hepburn|Russian|lit\.|pronounced|stylized|stylised|also known|abbreviated|known in Japan)[^()]*(?:\([^()]*\)[^()]*)*\)/gi, "")
		// native-script names: "Tekken 5 (鉄拳5)", "(Korean: 실크로드 온라인)"
		.replace(/\s*\([^()]*[\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF][^()]*\)/g, "")
		.replace(/\s*\(\s*[;,]?\s*\)/g, "")
		.replace(/[ \t]+([,.;:])/g, "$1")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
}
// at most ~900 characters, cut at a sentence end
export function lead(s: string): string {
	const paras = tidyExtract(s).split(/\n+/).map((p) => p.trim()).filter(Boolean);
	let out = "";
	for (const p of paras) {
		if (!out) out = p;
		else if (out.length + p.length + 2 <= 900) out += `\n\n${p}`;
		else break;
	}
	if (out.length <= 900) return out;
	const cut = out.slice(0, 900);
	const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
	return end > 200 ? cut.slice(0, end + 1) : `${cut.slice(0, 897).trimEnd()}...`;
}

/** "developed by X and Y and published by Z" in the first three sentences of the article */
export function makersFromLead(extract: string): { developers: string[]; publishers: string[] } {
	// sentences end at a period after a word, not after an initial ("Mark J. Hadley")
	const text = tidyExtract(extract).split(/(?<=[a-z0-9)"'\]]{2}\.)\s+/).slice(0, 3).join(" ");
	// where a name ends: "for the SNES", "based on", "who ...", a comma before "published", a bracket
	const END = String.raw`(?=\s+(?:for|in|on|as|under|with|based|who|which|that|using|alongside|while|after|before|led|through|between|and\s+released|and\s+distributed|worldwide|internationally)\b|,?\s+(?:and\s+)?published\b|,\s+(?:a|an|the|its|which|who)\b|(?<!\b[A-Z])\.|[;()]|$)`;
	// an initial's period belongs to the name
	const NAME = String.raw`((?:[^.;()]|(?<=\b[A-Z])\.)+?)`;
	const list = (s: string | undefined) =>
		(s ?? "")
			// "the indie studio Mega Crit", "Swedish game developer Robert Topala", "Ukrainian studio Action Forms"
			.replace(/^(?:the\s+)?(?:[A-Z][a-z]+(?:an|ish|ese|ch|i)\s+)?(?:indie\s+|independent\s+|solo\s+)?(?:(?:video\s+)?game\s+)?(?:studio|developer|company|programmer|designer)\s+/, "")
			.replace(/^(?:titular|then-unknown|independent|indie)\s+/, "")
			.split(/,\s*(?:and\s+)?|\s+and\s+/)
			.map((x) => x.replace(/^the\s+/, "").trim())
			// a name: capitalised, or lower-case only as a brand followed by a capitalised word ("id Software"), never
			// a phrase ("later Bandai Namco", "several former members")
			.filter((x) => (/^[A-Z0-9]/.test(x) || (/^[a-z][\w-]*\s+[A-Z]/.test(x) && !/^(later|now|formerly|then|also|its|their|his|her|several|former|members|various)\b/.test(x))) && x.length <= 40 && x.split(" ").length <= 5);
	const both = new RegExp(String.raw`developed and published by ${NAME}${END}`).exec(text);
	if (both) {
		const names = list(both[1]);
		return { developers: names, publishers: names };
	}
	const dev = new RegExp(String.raw`developed by ${NAME}${END}`).exec(text);
	const pub = new RegExp(String.raw`published by ${NAME}${END}`).exec(text);
	return { developers: list(dev?.[1]).slice(0, 3), publishers: list(pub?.[1]).slice(0, 2) };
}

// ---- which catalogue row a listing is --------------------------------------------------------------------------
// A listing's name changes when it is cleaned up (and may then equal a folded row's name: "Descent"), its slug never
// does: the Store derived it from the row name when the import created it (server/src/services/apps.ts slugify).
const slugify = (name: string) =>
	name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "app";
const BY_SLUG = new Map([...Object.keys(PORTS), ...MERGED.keys(), ...DROP, ...Object.keys(ELSEWHERE)].map((row) => [slugify(row), row]));
/** the catalogue row a listing came from, by its slug ("…-2" when another app had taken the slug first) */
export function rowOfSlug(slug: string): string | undefined {
	return BY_SLUG.get(slug) ?? BY_SLUG.get(slug.replace(/-\d+$/, ""));
}
