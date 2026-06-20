/**
 * SLA timing helpers.
 *
 * computeDueAt(from, minutes, policy) returns the timestamp by which an SLA
 * target is due. For 24/7 policies that's simply from + minutes. For
 * business-hours policies it adds *working* minutes, skipping nights,
 * weekends, and any day not in work_days, evaluated in the policy timezone.
 */

export interface SlaPolicy {
  first_response_mins: number
  resolution_mins: number
  business_hours_only: boolean
  timezone: string
  work_start: string   // "HH:MM"
  work_end: string     // "HH:MM"
  work_days: number[]  // 0=Sun..6=Sat
  enabled: boolean
}

/** Minute-of-day (policy tz) + weekday for a given instant. */
function localParts(at: Date, timezone: string): { weekday: number; minutes: number } {
  // Intl gives us the wall-clock in the target tz without pulling a tz lib.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(at)
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  // 24:00 edge — Intl can emit "24" for midnight in some runtimes
  const hour = hh === 24 ? 0 : hh
  return { weekday: map[wd] ?? 0, minutes: hour * 60 + mm }
}

function hhmmToMin(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Add `targetMinutes` of working time to `from`, respecting the policy's
 * work days + window. Steps minute-budget forward, jumping over closed
 * periods. Capped iteration so a misconfigured policy can't loop forever.
 */
function addWorkingMinutes(from: Date, targetMinutes: number, policy: SlaPolicy): Date {
  const openMin = hhmmToMin(policy.work_start)
  const closeMin = hhmmToMin(policy.work_end)
  const windowLen = Math.max(1, closeMin - openMin)
  let cursor = new Date(from.getTime())
  let remaining = targetMinutes
  let guard = 0

  while (remaining > 0 && guard < 100000) {
    guard++
    const { weekday, minutes } = localParts(cursor, policy.timezone)
    const isWorkDay = policy.work_days.includes(weekday)

    if (!isWorkDay || minutes >= closeMin) {
      // jump to next day's open
      cursor = new Date(cursor.getTime() + (24 * 60 - minutes + openMin) * 60_000)
      continue
    }
    if (minutes < openMin) {
      // before open today — jump to open
      cursor = new Date(cursor.getTime() + (openMin - minutes) * 60_000)
      continue
    }
    // inside the window
    const availableToday = closeMin - minutes
    const consume = Math.min(remaining, availableToday)
    cursor = new Date(cursor.getTime() + consume * 60_000)
    remaining -= consume
    if (remaining > 0) {
      // hit close — bounce to next day open (handled next loop via minutes>=close)
      void windowLen
    }
  }
  return cursor
}

export function computeDueAt(from: Date, minutes: number, policy: SlaPolicy | null): Date {
  if (!policy || !policy.enabled || !policy.business_hours_only) {
    return new Date(from.getTime() + minutes * 60_000)
  }
  return addWorkingMinutes(from, minutes, policy)
}
