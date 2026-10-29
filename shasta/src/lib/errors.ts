export type ErrorKind = 'offline' | 'proxy' | 'dns' | 'refused' | 'timeout' | 'tls' | 'blocked' | 'empty' | 'unknown'

export interface ErrorInfo {
  kind: ErrorKind
  title: string
  body: string
  /** a retry has a realistic chance of working */
  retryable: boolean
}

interface Context {
  online: boolean
  /** the Wisp transport is not connected */
  proxyDown: boolean
  /** the site has no backend at all yet (a frontend-only development deployment) */
  noBackend?: boolean
}

/** Turns a raw transport/proxy message into something a person can act on. */
export function classifyError(message: string, { online, proxyDown, noBackend }: Context): ErrorInfo {
  const m = message.toLowerCase()
  if (!online) {
    return { kind: 'offline', title: "You're offline", body: 'Your device is not connected to the internet. Shasta will load pages again once you are back online.', retryable: true }
  }
  if (proxyDown && noBackend) {
    return { kind: 'proxy', title: 'Browsing is not connected yet', body: 'This development build of Shasta has no proxy server connected, so websites cannot load here yet. Everything else in Shasta works.', retryable: true }
  }
  if (proxyDown) {
    return { kind: 'proxy', title: "Can't reach the proxy", body: "Shasta couldn't contact its Wisp server, so no site can load right now. It keeps retrying in the background, or you can retry now or check the connection settings.", retryable: true }
  }
  // libcurl reports failures as "Request failed with error code N: …"
  const code = Number(/error code (\d+)/.exec(m)?.[1] ?? 0)
  if (code === 6 || /resolve|dns|enotfound|name not known|no such host|getaddrinfo/.test(m)) {
    return { kind: 'dns', title: "This site can't be found", body: "The address couldn't be resolved. Check for typos in the address, or try again in a moment.", retryable: true }
  }
  if (code === 7 || /refused|econnrefused|could not connect/.test(m)) {
    return { kind: 'refused', title: 'The site refused to connect', body: 'The server is reachable but rejected the connection. It may be down, or may be blocking proxy traffic.', retryable: true }
  }
  if (code === 28 || /timed out|timeout|too long/.test(m)) {
    return { kind: 'timeout', title: 'The site took too long to respond', body: 'The server did not answer in time. It may be busy or unreachable from the proxy.', retryable: true }
  }
  if ([35, 51, 58, 59, 60, 77, 83].includes(code) || /certificate|ssl|tls|handshake|self.signed|expired/.test(m)) {
    return { kind: 'tls', title: "A secure connection couldn't be made", body: "The proxy could not verify this site's certificate or negotiate encryption. Shasta will not bypass certificate checks.", retryable: false }
  }
  if (/private|loopback|forbidden|blocked|not allowed|denied|blacklist|disallowed/.test(m)) {
    return { kind: 'blocked', title: 'This address is blocked', body: "The proxy server doesn't allow connections to this destination (for example local or private network addresses).", retryable: false }
  }
  if (code === 52 || code === 56 || /returned nothing|empty reply|connection (was )?reset|closed/.test(m)) {
    return { kind: 'empty', title: "The site didn't respond", body: 'The connection closed without an answer. The address may not exist (check it for typos), or the site may block traffic from proxies.', retryable: true }
  }
  return { kind: 'unknown', title: "This page couldn't be loaded", body: 'Something went wrong while loading the page. Trying again often helps; some sites also cannot work through a proxy.', retryable: true }
}
