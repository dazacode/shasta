// Runs before everything else (a file, not inline: an Isolated Web App's CSP blocks inline scripts).

// An Isolated Web App enforces Trusted Types (`require-trusted-types-for 'script'`) without naming
// allowed policies, so a `default` policy may exist. Shasta, the engine and every proxied page assign
// strings to script sinks, so the default policy passes them through. On a normal page nothing
// enforces Trusted Types and this policy is never called.
try {
  if (self.trustedTypes && !self.trustedTypes.defaultPolicy) {
    self.trustedTypes.createPolicy('default', { createHTML: (s) => s, createScript: (s) => s, createScriptURL: (s) => s })
  }
} catch (e) {}

// apply the saved theme before first paint so there is no flash of the wrong palette
try {
  var s = (JSON.parse(localStorage.getItem('shasta-settings') || '{}').state || {}).settings || {};
  var dark = s.theme === 'dark' || ((!s.theme || s.theme === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
  var d = document.documentElement;
  d.classList.toggle('dark', dark);
  d.dataset.accent = s.accent || 'sky';
  d.dataset.density = s.density || 'comfortable';
} catch (e) { document.documentElement.classList.add('dark'); }

// Cloudflare Web Analytics (cookieless: page views, countries, devices, referrers, Core Web Vitals).
// Only on the hosted site it was created for; never in the installed app, localhost or self-hosted copies.
// The token is the site's TOKEN, not its tag (439559fc... is the tag: with it nothing was ever recorded).
// Never turn on the Pages project's "Web Analytics" toggle instead: it injects the beacon into index.html, whose
// bytes then miss the offline manifest's sha256 and every offline shell update fails.
try {
  if (location.hostname === 'shasta-dtg.pages.dev') {
    var b = document.createElement('script');
    b.defer = true;
    b.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    b.setAttribute('data-cf-beacon', '{"token": "3eb67e2a3f6d41318eae534a3e1e50bd", "spa": true}');
    document.head.appendChild(b);
  }
} catch (e) {}
