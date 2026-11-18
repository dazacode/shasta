// The FreeDNS mirrors of the full site (scripts/mirrors/worker.js, docs/notes/deploy.md "FreeDNS mirrors").
// Each is a CNAME to mirrors.edushasta.lol in the owner's FreeDNS account (free plan: 5 shared-domain hostnames)
// plus a custom hostname and a Workers route on the edushasta.lol zone. Spread over different shared domains, so a
// filter that blocks one domain only takes out the mirrors on it. The Lite builds use the first few as cross-domain
// fallbacks for Wisp, the Store API and now.gg (scripts/lib/liteBuild.ts).
export const MIRRORS = [
	"learnmathwit.chickenkiller.com",
	"kidsmathfun.crabdance.com",
	"mathforbeg.mooo.com",
	"findedu.twilightparadox.com",
	"shastastud.chickenkiller.com",
];
