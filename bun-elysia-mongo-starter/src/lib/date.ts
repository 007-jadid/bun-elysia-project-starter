/**
 * Get current UTC date/time as a Date object.
 */
export const getUtcDateTime = (): Date => {
  return new Date()
}

/**
 * Get the start of day (00:00:00.000 UTC) for a given date string.
 * Returns a JS Date representing that moment in UTC.
 *
 * Note: day boundaries are computed in UTC. If your product needs day
 * boundaries in a specific client timezone, format the calendar date in that
 * timezone (via Intl.DateTimeFormat with `timeZone: CLIENT_TIMEZONE`) before
 * building the boundary string, and append the timezone's UTC offset instead
 * of `Z`.
 */
export const startDayOf = (dateStr: string): Date => {
  const d = new Date(dateStr)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
}

/**
 * Get the end of day (23:59:59.999 UTC) for a given date string.
 * Returns a JS Date representing that moment in UTC.
 */
export const endDayOf = (dateStr: string): Date => {
  const d = new Date(dateStr)
  const year = d.getUTCFullYear()
  const month = d.getUTCMonth()
  const day = d.getUTCDate()
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
}
