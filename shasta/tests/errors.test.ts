import { describe, expect, it } from 'vitest'
import { classifyError } from '@/lib/errors'

const up = { online: true, proxyDown: false }

describe('classifyError', () => {
  it.each([
    ['Could not resolve host: nope.invalid', 'dns'],
    ['connect ECONNREFUSED 127.0.0.1:1', 'refused'],
    ['Operation timed out after 30000 ms', 'timeout'],
    ['The site took too long to respond.', 'timeout'],
    ['SSL certificate problem: self signed certificate', 'tls'],
    ['Destination is a private IP address', 'blocked'],
    ['Request failed with error code 7: Could not connect to server', 'refused'],
    ['Request failed with error code 6: Could not resolve host', 'dns'],
    ['Request failed with error code 28: Timeout was reached', 'timeout'],
    ['Request failed with error code 60: SSL peer certificate or SSH remote key was not OK', 'tls'],
    ['Request failed with error code 52: Server returned nothing (no headers, no data)', 'empty'],
    ['something odd', 'unknown'],
  ])('%s -> %s', (message, kind) => {
    expect(classifyError(message, up).kind).toBe(kind)
  })

  it('reports being offline before anything else', () => {
    expect(classifyError('Could not resolve host', { online: false, proxyDown: true }).kind).toBe('offline')
  })

  it('blames the proxy when the transport is down', () => {
    expect(classifyError('whatever', { online: true, proxyDown: true }).kind).toBe('proxy')
  })

  it('does not offer retry for certificate failures', () => {
    expect(classifyError('certificate expired', up).retryable).toBe(false)
  })
})
