// A small state machine: every move goes through ONE transition table, and a move the table doesn't allow throws
// (docs/notes/state-machines.md). Used by the linking flows (linkFlow.ts); the tables are pinned by tests.

export class IllegalMove extends Error {
  constructor(from: string, to: string) {
    super(`illegal move: ${from} -> ${to}`)
    this.name = 'IllegalMove'
  }
}

export type Table<K extends string> = Record<K, readonly K[]>

export interface Machine<S extends { s: string }> {
  readonly state: S
  /** moves to `next`, or throws IllegalMove */
  go(next: S): void
  /** may the machine move to this state from where it is? */
  can(to: S['s']): boolean
  /** no move leaves the current state */
  readonly final: boolean
}

export function machine<S extends { s: string }>(table: Table<S['s']>, initial: S, onState: (s: S) => void): Machine<S> {
  let cur = initial
  return {
    get state() {
      return cur
    },
    can: (to) => table[cur.s as S['s']].includes(to),
    go(next) {
      if (!table[cur.s as S['s']].includes(next.s as S['s'])) throw new IllegalMove(cur.s, next.s)
      cur = next
      onState(next)
    },
    get final() {
      return table[cur.s as S['s']].length === 0
    },
  }
}
