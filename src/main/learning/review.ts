import { REVIEW_INTERVALS_DAYS } from '@shared/types'

const DAY_MS = 24 * 60 * 60 * 1000

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString()
}

export function firstReviewAt(now: string): string {
  return addDays(now, REVIEW_INTERVALS_DAYS[0])
}

export function nextReviewAfter(reviewCount: number, now: string): string {
  const idx = Math.min(Math.max(reviewCount, 0), REVIEW_INTERVALS_DAYS.length - 1)
  return addDays(now, REVIEW_INTERVALS_DAYS[idx])
}
