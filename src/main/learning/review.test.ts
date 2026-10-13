import { describe, it, expect } from 'vitest'
import { addDays, firstReviewAt, nextReviewAfter } from './review'

const NOW = '2026-10-13T08:00:00.000Z'

describe('review schedule', () => {
  it('adds whole days in UTC', () => {
    expect(addDays(NOW, 1)).toBe('2026-10-14T08:00:00.000Z')
    expect(addDays(NOW, 14)).toBe('2026-10-27T08:00:00.000Z')
  })
  it('first review is one day later', () => {
    expect(firstReviewAt(NOW)).toBe('2026-10-14T08:00:00.000Z')
  })
  it('after the n-th review uses 3 / 7 / 14 / 14 days', () => {
    expect(nextReviewAfter(1, NOW)).toBe(addDays(NOW, 3))
    expect(nextReviewAfter(2, NOW)).toBe(addDays(NOW, 7))
    expect(nextReviewAfter(3, NOW)).toBe(addDays(NOW, 14))
    expect(nextReviewAfter(9, NOW)).toBe(addDays(NOW, 14))
  })
})
