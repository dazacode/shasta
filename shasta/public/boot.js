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
try {
  if (location.hostname === 'shasta-dtg.pages.dev') {
    var b = document.createElement('script');
    b.defer = true;
    b.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    b.setAttribute('data-cf-beacon', '{"token": "439559fc3cce4251bdfb0e2f366e7af0", "spa": true}');
    document.head.appendChild(b);
  }
} catch (e) {}
