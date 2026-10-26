// ---------------------------------------------------------------------------
// Time helpers. The whole app uses ONE timezone: Asia/Kolkata.
// Dates are stored as plain "YYYY-MM-DD" strings and times as "HH:MM"
// strings, i.e. Kolkata wall-clock values. That avoids timezone conversion
// bugs entirely: we never convert a booking time to UTC and back.
// ---------------------------------------------------------------------------

const TIMEZONE = 'Asia/Kolkata';

/** "HH:MM" -> minutes since midnight, e.g. "09:30" -> 570. */
function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Minutes since midnight -> "HH:MM" (wraps past midnight safely). */
function fromMinutes(total) {
  const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Weekday for a "YYYY-MM-DD" date: 0 = Sunday, ..., 6 = Saturday. */
function weekdayFromDate(dateStr) {
  // Parsing as UTC midnight keeps the weekday independent of server TZ.
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** "YYYY-MM-DD" + n days -> "YYYY-MM-DD" (UTC-date arithmetic, TZ-safe). */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Current date/time in Asia/Kolkata, e.g. { date: '2026-10-27', time: '14:05' }. */
function getKolkataNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  // Intl can return hour "24" at midnight; normalise it to "00".
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/**
 * Minutes from (dateA, timeA) to (dateB, timeB), treating both as Kolkata
 * wall-clock values. Because India has no daylight saving, comparing the
 * wall-clock values directly gives the true elapsed minutes.
 */
function minutesBetween(dateA, timeA, dateB, timeB) {
  const toEpochMin = (dateStr, timeStr) => {
    const [y, mo, d] = dateStr.split('-').map(Number);
    const [h, mi] = timeStr.split(':').map(Number);
    return Date.UTC(y, mo - 1, d, h, mi) / 60000;
  };
  return toEpochMin(dateB, timeB) - toEpochMin(dateA, timeA);
}

module.exports = { TIMEZONE, toMinutes, fromMinutes, weekdayFromDate, addDays, getKolkataNow, minutesBetween };
