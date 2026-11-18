import { describe, expect, it } from 'vitest'
import { parseFriendCode, parseInvite, ScanSide, ShowSide } from '@/social/link'

describe('social QR link (HPKE, PSK mode)', () => {
  it('both sides get the same code and talk both ways', async () => {
    const show = await ShowSide.create('AbCdEfGhIjKlMnOp')
    const inv = parseInvite(new URL(show.url('https://edushasta.lol')).hash)!
    expect(inv.room).toBe('AbCdEfGhIjKlMnOp')
    const scan = await ScanSide.create(inv)
    const { channel: a, reply } = await show.accept(scan.hello)
    const b = await scan.accept(reply)
    expect(a.code).toMatch(/^\d{3}$/)
    expect(a.code).toBe(b.code)
    expect(await a.open(await b.seal({ type: 'hello', handle: 'sam' }))).toEqual({ type: 'hello', handle: 'sam' })
    expect(await b.open(await a.seal({ type: 'bundle', n: 1 }))).toEqual({ type: 'bundle', n: 1 })
    expect(await b.open(await a.seal({ type: 'bundle', n: 2 }))).toEqual({ type: 'bundle', n: 2 })
  })
  it('someone without the QR secret cannot talk to the shower', async () => {
    const show = await ShowSide.create('AbCdEfGhIjKlMnOp')
    const forged = { ...show.invite, secret: crypto.getRandomValues(new Uint8Array(32)) }
    const mitm = await ScanSide.create(forged)
    const { channel } = await show.accept(mitm.hello)
    expect(channel.code).not.toBe(mitm.code) // overwhelmingly likely; the real check is below
    await expect(channel.open(await mitm.accept({ enc: (await show.accept(mitm.hello)).reply.enc }).then((c) => c.seal('x')))).rejects.toBeTruthy()
  })
  it('rejects malformed invites and reads friend codes', () => {
    expect(parseInvite('#l=short.AAA.BBB')).toBeNull()
    expect(parseInvite('#nothing')).toBeNull()
    expect(parseFriendCode('#f=abcdefghijklmnop1234')).toBe('abcdefghijklmnop1234')
    expect(parseFriendCode('#f=<script>')).toBeNull()
  })
})
