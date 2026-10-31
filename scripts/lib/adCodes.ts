// Adsterra codes per host. Adsterra registers every domain as its own site with its own keys, so one host's codes
// must never ship on another (lib/ads.ts reads these as build variables). Not secrets: they are in every page's source.
// `bun run build` (scripts/run.ts) bakes in `pages` (shasta-dtg.pages.dev, also edushasta.lol); the Lite deploy scripts
// pass their own. A host missing here builds with no adverts at all.

type Codes = {
	/** Popunder (page-level tag) */
	popunder: string;
	/** Social Bar (page-level tag) */
	socialBar: string;
	/** Native banner key (bellnewyork.org/21/<key>, container-<key>) */
	native: string;
	/** Smartlink: a plain link, not a script. Not placed anywhere yet. */
	smartlink: string;
	/** iframe banners, `WxH` -> key */
	banners: Record<string, string>;
};

const HOST = "https://bellnewyork.org";

export const AD_CODES = {
	pages: {
		popunder: "https://accountut.com/1/757238daeb5bbd291274eaff6fcede48",
		socialBar: `${HOST}/14/01316eeb30031f7a1ce45d581a50417a`,
		native: "177cc919c01df73aed1a279f37dfc558",
		smartlink: "https://ardance.org/4/0d113b2acfbc052d4b3bf2020734d19c",
		banners: {
			"468x60": "36069e84b5ded8ca351dde690606d479",
			"300x250": "d484efea3992dc4b3d60494be320b64c",
			"160x300": "95d054f4e6f6d1313ce3fa264c5f5384",
			"160x600": "235a8a233a6b170aaabcb6a2a25263a0",
			"320x50": "e463f99c92aa15fca1e3a28dfb4ed4f5",
			"728x90": "335d39a82530eb4a11b6990e76988764",
		},
	},
	vercel: {
		popunder: "https://accountut.com/1/13c037a706b864f17281543e825c527b",
		socialBar: `${HOST}/14/483f04d17367af211c3f5f36e992ccd6`,
		native: "39b10957acf2b7e38f500406e2a35982",
		smartlink: "https://ardance.org/4/09e2abe7e432526f3c74cb6107d42cef",
		banners: {
			"468x60": "73b496244ae88b0f04e1032f97255b1c",
			"300x250": "6c565ba905082c2d557f78d483597fe0",
			"160x300": "7d9fc1c4f16d61dabe37f8e42dbb8686",
			"160x600": "41cd058cb3417803c4099904d10c4f28",
			"320x50": "e86a3fcba7b86bd964859c67f98c9aee",
			"728x90": "49bdceba5f4f3d108c2db91b06c09472",
		},
	},
	base44: {
		popunder: "https://accountut.com/1/0e52c4112dffe6ad2cfb6cec58eb4c14",
		socialBar: `${HOST}/14/dff28c000aab907e8a47e79dc60485ff`,
		native: "da3d3f625e06484f4ba0805ce60ae256",
		smartlink: "https://ardance.org/4/f90a57e94f969fe80b14290c0396608e",
		banners: {
			"468x60": "9ae90e9b15fd2970ca2b21c2965d6e60",
			"300x250": "36ea95f7c1cba2b4fc3653bdd6b37a86",
			"160x300": "0480ad4724411ee0747cdbb381806ba1",
			"160x600": "6d361cb731a29f8f7acc0092646fd62d",
			"320x50": "5ebc8b250677df12b188a5376ce2bf53",
			"728x90": "9caf512de4398894a7b01dc9a09d0eee",
		},
	},
} satisfies Record<string, Codes>;

export type AdHost = keyof typeof AD_CODES;

/** The build variables lib/ads.ts reads, for one host; no host = every ad variable empty (no adverts). Always sets
 *  all of them, so nothing from the root .env (another host's codes) leaks through. */
export function adEnv(host?: AdHost): Record<string, string> {
	const c: Codes | undefined = host ? AD_CODES[host] : undefined;
	return {
		VITE_ADSTERRA_HOST: c ? HOST : "",
		VITE_ADSTERRA_BANNERS: c ? Object.entries(c.banners).map(([size, key]) => `${size}:${key}`).join(",") : "",
		VITE_ADSTERRA_NATIVE: c?.native ?? "",
		VITE_AD_SCRIPTS: c ? [c.popunder, c.socialBar].join(",") : "",
	};
}
