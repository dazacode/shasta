// The retro emulator apps Shasta ships in its Official storefront (built by scripts/build-emulators.ts into apps/emu-*).
// Each app is one family of systems run by one engine: EmulatorJS (libretro cores) for consoles and home computers,
// Ruffle for Flash, v86 for x86 PCs, Boxedwine for Windows programs, container2wasm for a Linux terminal. An EmulatorJS system names its system id, the cores shipped for it (the first is
// the default; EmulatorJS lets people switch in its settings), the file types it opens and the BIOS it needs.
// Shasta ships no commercial games and no BIOS: people load their own files; `free` lists the few freely licensed
// things an app includes. Licences are each project's own; the non-commercial ones are marked so the owner can see
// them at a glance.

export type Licence = 'GPL-2.0' | 'GPL-3.0' | 'LGPL-2.1' | 'LGPL-3.0' | 'MPL-2.0' | 'MIT' | 'Apache-2.0' | 'Zlib' | 'BSD-2-Clause' | 'BSD-3-Clause' | 'MIT OR Apache-2.0' | 'non-commercial'

export type Engine = 'emulatorjs' | 'ruffle' | 'v86' | 'boxedwine' | 'c2w'

export interface Core {
	id: string
	name: string
	licence: Licence
	url: string
	/** not an @emulatorjs npm core: built from another project's release (see build-emulators.ts) */
	custom?: boolean
}

export interface Bios {
	/** required: nothing runs without it; optional: most games run, some need it; cd: only disc games need it */
	need: 'required' | 'optional' | 'cd'
	/** what the file is called, shown to the person; several files go in one .zip */
	files: string
}

export interface System {
	/** EmulatorJS system id (EJS_core); for the other engines just a name */
	id: string
	label: string
	/** EmulatorJS cores, the default first */
	cores?: string[]
	ext: string[]
	bios?: Bios
	/** the core only runs with threads (SharedArrayBuffer) */
	threads?: boolean
	/** the system plays from discs: games in several files (.cue + .bin) go in one .zip */
	disc?: boolean
}

export interface EmulatorApp {
	id: string
	name: string
	/** icon text and colours (original artwork: a label on a gradient, no console logos) */
	badge: string
	colors: [string, string]
	summary: string
	about: string
	tags: string[]
	systems: System[]
	/** default emulatorjs */
	engine?: Engine
	/** the software behind a non-EmulatorJS app (EmulatorJS apps list their cores) */
	credits?: Core[]
	free?: Free[]
	/** shown as a warning in the app and its Store description: this one needs a fast computer */
	demanding?: string
}

/** Something freely licensed the app includes, so it does something before the person adds a file. */
export interface Free {
	name: string
	note: string
	system: string
	/** the file inside the app, and where the build downloads it (pinned by hash in lock.json) */
	file: string
	source: string
	/** v86: which drive the image goes in */
	drive?: 'fda' | 'cdrom' | 'hda'
}

const repo = (core: string) => `https://github.com/EmulatorJS/libretro-${core}`

export const CORES: Record<string, Core> = Object.fromEntries(
	(
		[
			['fceumm', 'FCEUmm', 'GPL-2.0'],
			['nestopia', 'Nestopia UE', 'GPL-2.0'],
			['snes9x', 'Snes9x', 'non-commercial'],
			['gambatte', 'Gambatte', 'GPL-2.0'],
			['mgba', 'mGBA', 'MPL-2.0'],
			['mupen64plus_next', 'Mupen64Plus-Next', 'GPL-2.0'],
			['parallel_n64', 'ParaLLEl N64', 'GPL-2.0'],
			['melonds', 'melonDS', 'GPL-3.0'],
			['desmume', 'DeSmuME', 'GPL-2.0'],
			['desmume2015', 'DeSmuME 2015', 'GPL-2.0'],
			['beetle_vb', 'Beetle VB', 'GPL-2.0'],
			['pcsx_rearmed', 'PCSX ReARMed', 'GPL-2.0'],
			['mednafen_psx_hw', 'Beetle PSX HW', 'GPL-2.0'],
			['ppsspp', 'PPSSPP', 'GPL-2.0'],
			['genesis_plus_gx', 'Genesis Plus GX', 'non-commercial'],
			['picodrive', 'PicoDrive', 'non-commercial'],
			['smsplus', 'SMS Plus GX', 'GPL-2.0'],
			['yabause', 'Yabause', 'GPL-2.0'],
			['stella2014', 'Stella 2014', 'GPL-2.0'],
			['a5200', 'a5200', 'GPL-2.0'],
			['prosystem', 'ProSystem', 'GPL-2.0'],
			['handy', 'Handy', 'Zlib'],
			['virtualjaguar', 'Virtual Jaguar', 'GPL-3.0'],
			['mednafen_pce', 'Beetle PCE', 'GPL-2.0'],
			['mednafen_pcfx', 'Beetle PC-FX', 'GPL-2.0'],
			['mednafen_ngp', 'Beetle NeoPop', 'GPL-2.0'],
			['mednafen_wswan', 'Beetle WonderSwan', 'GPL-2.0'],
			['gearcoleco', 'Gearcoleco', 'GPL-3.0'],
			['opera', 'Opera', 'non-commercial'],
			['fbneo', 'FinalBurn Neo', 'non-commercial'],
			['fbalpha2012_cps1', 'FB Alpha 2012 CPS-1', 'non-commercial'],
			['fbalpha2012_cps2', 'FB Alpha 2012 CPS-2', 'non-commercial'],
			['mame2003_plus', 'MAME 2003-Plus', 'non-commercial'],
			['mame2003', 'MAME 2003', 'non-commercial'],
			['vice_x64sc', 'VICE x64sc', 'GPL-2.0'],
			['vice_x128', 'VICE x128', 'GPL-2.0'],
			['vice_xvic', 'VICE xvic', 'GPL-2.0'],
			['vice_xpet', 'VICE xpet', 'GPL-2.0'],
			['vice_xplus4', 'VICE xplus4', 'GPL-2.0'],
			['puae', 'PUAE', 'GPL-2.0'],
			['dosbox_pure', 'DOSBox Pure', 'GPL-2.0'],
			['fuse', 'Fuse', 'GPL-3.0'],
			['81', 'EightyOne', 'GPL-3.0'],
			['cap32', 'Caprice32', 'GPL-2.0'],
			['prboom', 'PrBoom', 'GPL-2.0'],
			['same_cdi', 'SAME CDi', 'BSD-3-Clause'],
		] as const
	).map(([id, name, licence]) => [id, { id, name, licence, url: repo(id) } as Core]),
)
CORES.flycast = { id: 'flycast', name: 'Flycast WASM', licence: 'GPL-2.0', url: 'https://github.com/nasomers/flycast-wasm', custom: true }

const POWERFUL = 'Needs a powerful computer: a recent laptop or desktop. On most Chromebooks and older computers it will run very slowly or not start.'

const DISC = ['cue', 'chd', 'iso', 'pbp', 'ccd', 'img', 'm3u']

export const APPS: EmulatorApp[] = [
	{
		id: 'nes',
		name: 'NES Emulator',
		badge: 'NES',
		colors: ['#d62d20', '#7a1010'],
		summary: 'Play your own NES and Famicom games, with saves that stay on this device.',
		about: 'Plays Nintendo Entertainment System and Famicom games, including Famicom Disk System files.',
		tags: ['nes', 'famicom', 'nintendo'],
		systems: [{ id: 'nes', label: 'NES / Famicom', cores: ['fceumm', 'nestopia'], ext: ['nes', 'fds', 'unf', 'unif'], bios: { need: 'optional', files: 'disksys.rom (Famicom Disk System games only)' } }],
	},
	{
		id: 'snes',
		name: 'SNES Emulator',
		badge: 'SNES',
		colors: ['#6b5bd2', '#2c2470'],
		summary: 'Play your own Super Nintendo and Super Famicom games.',
		about: 'Plays Super Nintendo and Super Famicom games.',
		tags: ['snes', 'super nintendo', 'super famicom', 'nintendo'],
		systems: [{ id: 'snes', label: 'SNES / Super Famicom', cores: ['snes9x'], ext: ['smc', 'sfc', 'swc', 'fig', 'bs', 'st'] }],
	},
	{
		id: 'gameboy',
		name: 'Game Boy Emulator',
		badge: 'GB',
		colors: ['#8bac0f', '#306230'],
		summary: 'Play your own Game Boy and Game Boy Color games.',
		about: 'Plays original Game Boy and Game Boy Color games.',
		tags: ['game boy', 'game boy color', 'gbc', 'handheld', 'nintendo'],
		systems: [{ id: 'gb', label: 'Game Boy / Color', cores: ['gambatte'], ext: ['gb', 'gbc', 'dmg'] }],
	},
	{
		id: 'gba',
		name: 'Game Boy Advance Emulator',
		badge: 'GBA',
		colors: ['#5a3fd1', '#241470'],
		summary: 'Play your own Game Boy Advance games.',
		about: 'Plays Game Boy Advance games. Runs without a BIOS file thanks to mGBA\'s built-in replacement; a few games behave better with the real one.',
		tags: ['gba', 'game boy advance', 'handheld', 'nintendo'],
		systems: [{ id: 'gba', label: 'Game Boy Advance', cores: ['mgba'], ext: ['gba', 'agb'], bios: { need: 'optional', files: 'gba_bios.bin' } }],
	},
	{
		id: 'n64',
		name: 'Nintendo 64 Emulator',
		badge: 'N64',
		colors: ['#1f9e4a', '#0b4d6e'],
		summary: 'Play your own Nintendo 64 games.',
		about: 'Plays Nintendo 64 games. Demanding: older or low-power devices may run some games slowly.',
		tags: ['n64', 'nintendo 64', 'nintendo'],
		systems: [{ id: 'n64', label: 'Nintendo 64', cores: ['mupen64plus_next', 'parallel_n64'], ext: ['n64', 'v64', 'z64'] }],
	},
	{
		id: 'nds',
		name: 'Nintendo DS Emulator',
		badge: 'DS',
		colors: ['#9aa0a6', '#3c4043'],
		summary: 'Play your own Nintendo DS games, with the touch screen under your mouse.',
		about: 'Plays Nintendo DS games; click or tap the lower screen to touch it. Runs without BIOS files using melonDS\'s free replacement.',
		tags: ['nds', 'nintendo ds', 'handheld', 'nintendo'],
		systems: [{ id: 'nds', label: 'Nintendo DS', cores: ['melonds', 'desmume', 'desmume2015'], ext: ['nds'], bios: { need: 'optional', files: 'bios7.bin, bios9.bin, firmware.bin (in one .zip)' } }],
	},
	{
		id: 'virtualboy',
		name: 'Virtual Boy Emulator',
		badge: 'VB',
		colors: ['#e01b1b', '#2a0000'],
		summary: 'Play your own Virtual Boy games in red and black.',
		about: 'Plays Virtual Boy games.',
		tags: ['virtual boy', 'nintendo'],
		systems: [{ id: 'vb', label: 'Virtual Boy', cores: ['beetle_vb'], ext: ['vb', 'vboy'] }],
	},
	{
		id: 'playstation',
		name: 'PlayStation Emulator',
		badge: 'PS1',
		colors: ['#3a5bd9', '#101c4d'],
		summary: 'Play your own original PlayStation games from disc images.',
		about: 'Plays original PlayStation (PS1) games from disc images (.chd, .pbp, or .cue + .bin in a .zip). Runs without a BIOS file for most games; some need the real one.',
		tags: ['playstation', 'ps1', 'psx', 'sony'],
		systems: [{ id: 'psx', label: 'PlayStation', cores: ['pcsx_rearmed', 'mednafen_psx_hw'], ext: [...DISC, 'bin', 'exe'], disc: true, bios: { need: 'optional', files: 'scph5501.bin (or another PlayStation BIOS)' } }],
	},
	{
		id: 'psp',
		name: 'PSP Emulator',
		badge: 'PSP',
		colors: ['#2b2b2b', '#000000'],
		summary: 'Play your own PlayStation Portable games.',
		about: 'Plays PlayStation Portable games from .iso or .cso files. The most demanding system here: it needs WebGL 2 and a fast device, and many games run slowly on Chromebooks.',
		tags: ['psp', 'playstation portable', 'handheld', 'sony'],
		systems: [{ id: 'psp', label: 'PlayStation Portable', cores: ['ppsspp'], ext: ['iso', 'cso', 'pbp', 'elf', 'prx'], threads: true }],
	},
	{
		id: 'sega',
		name: 'Sega Genesis Emulator',
		badge: 'MD',
		colors: ['#1565c0', '#0a1f44'],
		summary: 'Play your own Genesis, Mega Drive, Master System, Game Gear, Sega CD and 32X games.',
		about: 'Plays Sega Genesis / Mega Drive, Master System, Game Gear, SG-1000, Sega CD / Mega-CD and 32X games. Sega CD games need the Sega CD BIOS.',
		tags: ['sega', 'genesis', 'mega drive', 'master system', 'game gear', 'sega cd', '32x'],
		systems: [
			{ id: 'segaMD', label: 'Genesis / Mega Drive', cores: ['genesis_plus_gx', 'picodrive'], ext: ['md', 'gen', 'smd', 'bin', '68k', 'sgd'] },
			{ id: 'segaMS', label: 'Master System', cores: ['smsplus', 'genesis_plus_gx', 'picodrive'], ext: ['sms', 'sg'] },
			{ id: 'segaGG', label: 'Game Gear', cores: ['genesis_plus_gx'], ext: ['gg'] },
			{ id: 'segaCD', label: 'Sega CD / Mega-CD', cores: ['genesis_plus_gx', 'picodrive'], ext: DISC, disc: true, bios: { need: 'required', files: 'bios_CD_U.bin, bios_CD_E.bin or bios_CD_J.bin' } },
			{ id: 'sega32x', label: '32X', cores: ['picodrive'], ext: ['32x'] },
		],
	},
	{
		id: 'saturn',
		name: 'Sega Saturn Emulator',
		badge: 'SAT',
		colors: ['#37474f', '#0d1418'],
		summary: 'Play your own Sega Saturn games from disc images.',
		about: 'Plays Sega Saturn games from disc images. Demanding: expect slowdowns on low-power devices. A Saturn BIOS improves compatibility.',
		tags: ['sega', 'saturn'],
		systems: [{ id: 'segaSaturn', label: 'Sega Saturn', cores: ['yabause'], ext: DISC, disc: true, bios: { need: 'optional', files: 'saturn_bios.bin' } }],
	},
	{
		id: 'atari',
		name: 'Atari Emulator',
		badge: '2600',
		colors: ['#e65100', '#4a1500'],
		summary: 'Play your own Atari 2600, 5200, 7800, Lynx and Jaguar games.',
		about: 'Plays Atari 2600, 5200, 7800, Lynx and Jaguar games. The 5200 and Lynx need their BIOS files.',
		tags: ['atari', '2600', '7800', 'lynx', 'jaguar'],
		systems: [
			{ id: 'atari2600', label: 'Atari 2600', cores: ['stella2014'], ext: ['a26', 'bin'] },
			{ id: 'atari5200', label: 'Atari 5200', cores: ['a5200'], ext: ['a52', 'bin', 'car'], bios: { need: 'required', files: '5200.rom' } },
			{ id: 'atari7800', label: 'Atari 7800', cores: ['prosystem'], ext: ['a78', 'bin'] },
			{ id: 'lynx', label: 'Atari Lynx', cores: ['handy'], ext: ['lnx', 'o'], bios: { need: 'required', files: 'lynxboot.img' } },
			{ id: 'jaguar', label: 'Atari Jaguar', cores: ['virtualjaguar'], ext: ['j64', 'jag', 'abs', 'cof', 'rom'] },
		],
	},
	{
		id: 'turbografx',
		name: 'TurboGrafx-16 Emulator',
		badge: 'PCE',
		colors: ['#ff8f00', '#5d2c00'],
		summary: 'Play your own TurboGrafx-16, PC Engine and PC-FX games.',
		about: 'Plays TurboGrafx-16 / PC Engine and SuperGrafx cartridges, CD games (with the System Card BIOS), and PC-FX games (with the PC-FX BIOS).',
		tags: ['turbografx', 'pc engine', 'pc-fx', 'nec'],
		systems: [
			{ id: 'pce', label: 'TurboGrafx-16 / PC Engine', cores: ['mednafen_pce'], ext: ['pce', 'sgx', ...DISC], disc: true, bios: { need: 'cd', files: 'syscard3.pce' } },
			{ id: 'pcfx', label: 'PC-FX', cores: ['mednafen_pcfx'], ext: ['cue', 'ccd', 'toc', 'chd'], disc: true, bios: { need: 'required', files: 'pcfx.rom' } },
		],
	},
	{
		id: 'neogeopocket',
		name: 'Neo Geo Pocket Emulator',
		badge: 'NGP',
		colors: ['#00897b', '#00332d'],
		summary: 'Play your own Neo Geo Pocket and Pocket Color games.',
		about: 'Plays Neo Geo Pocket and Neo Geo Pocket Color games.',
		tags: ['neo geo pocket', 'snk', 'handheld'],
		systems: [{ id: 'ngp', label: 'Neo Geo Pocket / Color', cores: ['mednafen_ngp'], ext: ['ngp', 'ngc'] }],
	},
	{
		id: 'wonderswan',
		name: 'WonderSwan Emulator',
		badge: 'WS',
		colors: ['#5e35b1', '#1f0f45'],
		summary: 'Play your own WonderSwan and WonderSwan Color games.',
		about: 'Plays WonderSwan and WonderSwan Color games.',
		tags: ['wonderswan', 'bandai', 'handheld'],
		systems: [{ id: 'ws', label: 'WonderSwan / Color', cores: ['mednafen_wswan'], ext: ['ws', 'wsc', 'pc2'] }],
	},
	{
		id: 'colecovision',
		name: 'ColecoVision Emulator',
		badge: 'CV',
		colors: ['#424242', '#111111'],
		summary: 'Play your own ColecoVision games.',
		about: 'Plays ColecoVision games. Needs the ColecoVision BIOS file.',
		tags: ['colecovision', 'coleco'],
		systems: [{ id: 'coleco', label: 'ColecoVision', cores: ['gearcoleco'], ext: ['col', 'cv'], bios: { need: 'required', files: 'colecovision.rom' } }],
	},
	{
		id: '3do',
		name: '3DO Emulator',
		badge: '3DO',
		colors: ['#c62828', '#3e0a0a'],
		summary: 'Play your own 3DO games from disc images.',
		about: 'Plays 3DO Interactive Multiplayer games from disc images. Needs a 3DO BIOS file.',
		tags: ['3do'],
		systems: [{ id: '3do', label: '3DO', cores: ['opera'], ext: ['iso', 'bin', 'chd', 'cue'], disc: true, bios: { need: 'required', files: 'panafz10.bin (or another 3DO BIOS)' } }],
	},
	{
		id: 'arcade',
		name: 'Arcade Emulator',
		badge: 'ARC',
		colors: ['#d81b60', '#3d0820'],
		summary: 'Play arcade games from your own ROM sets with FinalBurn Neo or MAME 2003-Plus.',
		about: 'Plays arcade games from ROM set .zip files. Keep the ROM set\'s original file name: arcade emulators find games by it. FinalBurn Neo and MAME 2003-Plus expect different ROM set versions; pick the one your set was made for. Neo Geo games also need neogeo.zip as the BIOS.',
		tags: ['arcade', 'mame', 'fbneo', 'neo geo', 'cps'],
		systems: [
			{ id: 'arcade', label: 'FinalBurn Neo', cores: ['fbneo', 'fbalpha2012_cps1', 'fbalpha2012_cps2'], ext: ['zip', '7z'], bios: { need: 'optional', files: 'neogeo.zip (Neo Geo games only)' } },
			{ id: 'mame', label: 'MAME 2003-Plus', cores: ['mame2003_plus', 'mame2003'], ext: ['zip'] },
		],
	},
	{
		id: 'commodore',
		name: 'Commodore Emulator',
		badge: 'C64',
		colors: ['#5c6bc0', '#1a1f4d'],
		summary: 'Use your own Commodore 64, 128, VIC-20, PET and Plus/4 disks, tapes and cartridges.',
		about: 'Emulates the Commodore 64, 128, VIC-20, PET and Plus/4 with VICE. Opens disk (.d64), tape (.t64, .tap), program (.prg) and cartridge (.crt) files. The system ROMs are built in.',
		tags: ['commodore', 'c64', 'vic-20', 'computer'],
		systems: [
			{ id: 'c64', label: 'Commodore 64', cores: ['vice_x64sc'], ext: ['d64', 'd71', 'd81', 'g64', 't64', 'tap', 'prg', 'p00', 'crt', 'x64'] },
			{ id: 'c128', label: 'Commodore 128', cores: ['vice_x128'], ext: ['d64', 'd71', 'd81', 'prg', 'crt'] },
			{ id: 'vic20', label: 'VIC-20', cores: ['vice_xvic'], ext: ['20', '40', '60', 'a0', 'b0', 'prg', 'd64', 'tap', 'crt'] },
			{ id: 'pet', label: 'PET', cores: ['vice_xpet'], ext: ['prg', 'd64', 'tap'] },
			{ id: 'plus4', label: 'Plus/4', cores: ['vice_xplus4'], ext: ['prg', 'd64', 'tap', 'crt'] },
		],
	},
	{
		id: 'amiga',
		name: 'Amiga Emulator',
		badge: 'AMIGA',
		colors: ['#e53935', '#1e3a8a'],
		summary: 'Use your own Amiga disk images and hard drive files.',
		about: 'Emulates the Commodore Amiga with PUAE. Opens .adf, .dms, .ipf, .hdf and .lha files. Starts with AROS, a free Kickstart replacement; many games need a real Kickstart ROM.',
		tags: ['amiga', 'commodore', 'computer'],
		systems: [{ id: 'amiga', label: 'Amiga', cores: ['puae'], ext: ['adf', 'adz', 'dms', 'fdi', 'ipf', 'hdf', 'hdz', 'lha', 'm3u'], bios: { need: 'optional', files: 'kick34005.A500 or kick40068.A1200 (Kickstart ROM)' } }],
	},
	{
		id: 'dos',
		name: 'DOS Emulator',
		badge: 'DOS',
		colors: ['#1e88e5', '#0d2a52'],
		summary: 'Run your own DOS games and programs from a .zip.',
		about: 'Runs MS-DOS games and programs with DOSBox Pure. Put the game\'s folder in a .zip and open it; DOSBox Pure finds the program to start and keeps your saves.',
		tags: ['dos', 'pc', 'dosbox', 'computer'],
		systems: [{ id: 'dos', label: 'DOS', cores: ['dosbox_pure'], ext: ['zip', 'dosz', 'exe', 'com', 'bat', 'iso', 'cue', 'img', 'ima', 'vhd', 'm3u'], threads: true }],
	},
	{
		id: 'zxspectrum',
		name: 'ZX Spectrum Emulator',
		badge: 'ZX',
		colors: ['#212121', '#d50000'],
		summary: 'Use your own ZX Spectrum and ZX81 tapes, snapshots and disks.',
		about: 'Emulates the Sinclair ZX Spectrum (with Fuse) and the ZX81 (with EightyOne). The system ROMs are built in.',
		tags: ['zx spectrum', 'sinclair', 'zx81', 'computer'],
		systems: [
			{ id: 'fuse', label: 'ZX Spectrum', cores: ['fuse'], ext: ['tzx', 'tap', 'z80', 'sna', 'szx', 'rzx', 'scl', 'trd', 'dsk'] },
			{ id: '81', label: 'ZX81', cores: ['81'], ext: ['p', 't81', 'tzx'] },
		],
	},
	{
		id: 'amstradcpc',
		name: 'Amstrad CPC Emulator',
		badge: 'CPC',
		colors: ['#00897b', '#0d2b26'],
		summary: 'Use your own Amstrad CPC disks, tapes and snapshots.',
		about: 'Emulates the Amstrad CPC 464, 664 and 6128 with Caprice32. The system ROMs are built in.',
		tags: ['amstrad', 'cpc', 'computer'],
		systems: [{ id: 'cap32', label: 'Amstrad CPC', cores: ['cap32'], ext: ['dsk', 'sna', 'cdt', 'voc', 'kcr', 'm3u'] }],
	},
	{
		id: 'doom',
		name: 'Doom Engine',
		badge: 'WAD',
		colors: ['#b71c1c', '#1b0000'],
		summary: 'Play Doom-engine games from your own WAD files.',
		about: 'Runs games made for the Doom engine with PrBoom: open a .wad file (for example Freedoom, the free Doom-compatible game, or the Doom shareware episode).',
		tags: ['doom', 'fps', 'wad'],
		systems: [{ id: 'prboom', label: 'Doom engine', cores: ['prboom'], ext: ['wad', 'iwad', 'pwad', 'lmp'] }],
	},
	{
		id: 'cdi',
		name: 'CD-i Emulator',
		badge: 'CD-i',
		colors: ['#546e7a', '#162026'],
		summary: 'Play your own Philips CD-i discs.',
		about: 'Emulates the Philips CD-i. Needs the CD-i BIOS (cdimono1.zip).',
		tags: ['cd-i', 'philips'],
		systems: [{ id: 'same_cdi', label: 'Philips CD-i', cores: ['same_cdi'], ext: ['chd', 'iso', 'cue'], disc: true, bios: { need: 'required', files: 'cdimono1.zip' } }],
	},	{
		id: 'dreamcast',
		name: 'Dreamcast Emulator',
		badge: 'DC',
		colors: ['#ef6c00', '#3a1a00'],
		summary: 'Play your own Sega Dreamcast games from disc images. Needs a powerful computer.',
		about: 'Plays Sega Dreamcast games from .cdi, .gdi, .chd or .cue disc images with Flycast WASM, the first Dreamcast emulator that runs in a browser. It uses Flycast\'s built-in BIOS replacement, so no BIOS file is needed, though some games may not start without the real one. Windows CE games are not supported yet.',
		tags: ['dreamcast', 'sega'],
		systems: [{ id: 'flycast', label: 'Dreamcast', cores: ['flycast'], ext: ['cdi', 'gdi', 'chd', 'cue', 'elf'], disc: true }],
		demanding: POWERFUL,
	},
	{
		id: 'flash',
		name: 'Flash Emulator',
		engine: 'ruffle',
		badge: 'SWF',
		colors: ['#e53935', '#5c0b0b'],
		summary: 'Play Flash games and animations (.swf) from your device with Ruffle.',
		about: 'Plays Flash games and animations saved as .swf files with Ruffle, a Flash Player emulator. Most older Flash content (ActionScript 1 and 2) works; support for newer ActionScript 3 games is still growing, so some of them may not run.',
		tags: ['flash', 'swf', 'ruffle'],
		systems: [{ id: 'swf', label: 'Flash', ext: ['swf', 'spl'] }],
		credits: [{ id: 'ruffle', name: 'Ruffle', licence: 'MIT OR Apache-2.0', url: 'https://github.com/ruffle-rs/ruffle' }],
	},
	{
		id: 'pc',
		name: 'PC Emulator',
		engine: 'v86',
		badge: 'x86',
		colors: ['#607d8b', '#172126'],
		summary: 'Boot FreeDOS or your own PC floppy, CD and hard disk images.',
		about: 'Emulates an x86 PC with v86. Start FreeDOS, the free DOS-compatible system included with the app, or boot a floppy (.img), CD (.iso) or hard disk image from your device. Changes made to a disk last until you leave; download what you want to keep from inside the system first.',
		tags: ['pc', 'x86', 'freedos', 'dos', 'computer'],
		systems: [{ id: 'pc', label: 'PC', ext: ['img', 'ima', 'iso', 'vhd', 'bin'] }],
		credits: [
			{ id: 'v86', name: 'v86', licence: 'BSD-2-Clause', url: 'https://github.com/copy/v86' },
			{ id: 'seabios', name: 'SeaBIOS', licence: 'LGPL-3.0', url: 'https://www.seabios.org' },
			{ id: 'freedos', name: 'FreeDOS', licence: 'GPL-2.0', url: 'https://www.freedos.org' },
		],
		free: [{ name: 'FreeDOS', note: 'A free, open-source DOS. Type HELP to see its commands.', system: 'pc', file: 'free/freedos722.bin', source: 'https://i.copy.sh/freedos722.img', drive: 'fda' }],
	},	{
		id: 'windows',
		name: 'Windows Apps Emulator',
		engine: 'boxedwine',
		badge: 'WIN',
		colors: ['#0288d1', '#012a44'],
		summary: 'Run old Windows programs and games (.exe) with Wine. Needs a powerful computer.',
		about: 'Runs old 16-bit and 32-bit Windows programs and games with Boxedwine, which runs Wine (the Windows compatibility layer) on an emulated Linux. Open a program\'s .exe, or a .zip of its folder. DirectDraw games work; 3D games (Direct3D or OpenGL) do not. What a program saves is kept in this browser for next time.',
		tags: ['windows', 'wine', 'exe', 'pc'],
		systems: [{ id: 'win', label: 'Windows program', ext: ['exe', 'zip'] }],
		credits: [
			{ id: 'boxedwine', name: 'Boxedwine', licence: 'GPL-2.0', url: 'https://github.com/danoon2/Boxedwine' },
			{ id: 'wine', name: 'Wine', licence: 'LGPL-2.1', url: 'https://gitlab.winehq.org/wine/wine' },
		],
		demanding: POWERFUL,
	},
	{
		id: 'linux',
		name: 'Linux Terminal',
		engine: 'c2w',
		badge: 'LNX',
		colors: ['#37474f', '#0b0f11'],
		summary: 'A real Debian Linux command line, running entirely in your browser. Needs a powerful computer.',
		about: 'Starts Debian Linux in an emulated RISC-V computer with container2wasm and gives you its terminal: try ls, cat, grep, shell scripts and the rest of a Linux command line. It has no internet connection, and what you change is gone when you leave.',
		tags: ['linux', 'debian', 'terminal', 'command line', 'learn'],
		systems: [{ id: 'linux', label: 'Debian Linux', ext: [] }],
		credits: [
			{ id: 'container2wasm', name: 'container2wasm', licence: 'Apache-2.0', url: 'https://github.com/container2wasm/container2wasm' },
			{ id: 'debian', name: 'Debian', licence: 'GPL-2.0', url: 'https://www.debian.org' },
			{ id: 'xterm', name: 'xterm.js and xterm-pty', licence: 'MIT', url: 'https://github.com/xtermjs/xterm.js' },
		],
		free: [{ name: 'Debian Linux', note: 'A command line with the usual Linux tools. Type ls to start.', system: 'linux', file: 'free/debian', source: 'https://raw.githubusercontent.com/ktock/demo-images/9ff24d9e8e1fa9873ce31176706bf431d48770ac/riscv64-debian-wasi-container' }],
		demanding: POWERFUL,
	},
]
