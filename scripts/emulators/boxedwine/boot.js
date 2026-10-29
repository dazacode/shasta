// Starts Boxedwine (boxedwine-shell.js + boxedwine.js, unchanged from its web release) for the program the library page
// chose. The library page stores the program as a zip in IndexedDB (shasta-retro, store "launch") and opens
// play.html?app=<zip name>&p=<program>; this file answers Boxedwine's request for that zip, and for its Wine file
// system (boxedwine.zip, shipped as boxedwine-root.data because Store packages cannot contain .zip files).
(async () => {
  const launch = await new Promise((ok) => {
    const r = indexedDB.open('shasta-retro')
    r.onsuccess = () => {
      try {
        const g = r.result.transaction('launch').objectStore('launch').get('current')
        g.onsuccess = () => ok(g.result)
        g.onerror = () => ok(null)
      } catch {
        ok(null)
      }
    }
    r.onerror = () => ok(null)
  })
  if (!launch) {
    location.replace('../index.html')
    return
  }
  document.getElementById('now').textContent = launch.title
  document.title = `${launch.title} · Windows Apps Emulator`

  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const name = url.split('/').pop().split('?')[0]
    if (name === 'boxedwine.zip') return realFetch('boxedwine-root.data', init)
    if (name === launch.zipName) return Promise.resolve(new Response(launch.zip, { status: 200 }))
    return realFetch(input, init)
  }

  // hide the loading overlay once Wine is up and drawing
  const status = document.getElementById('status')
  new MutationObserver(() => {
    if (!status.textContent.trim()) document.getElementById('loading').classList.add('hidden')
  }).observe(status, { childList: true, characterData: true, subtree: true })
  document.getElementById('canvas').addEventListener('click', (e) => e.currentTarget.focus())

  for (const src of ['boxedwine-shell.js', 'boxedwine.js']) {
    await new Promise((ok, fail) => {
      const s = document.createElement('script')
      s.src = src
      s.onload = ok
      s.onerror = fail
      document.body.append(s)
    })
  }
})()
