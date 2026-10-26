// ---------------------------------------------------------------------------
// Slot availability logic — pure functions, no database access, so they are
// easy to unit-test (see tests/slots.test.js) and easy to move to another
// database later: the API layer just feeds rows into these functions.
// ---------------------------------------------------------------------------
const { toMinutes, fromMinutes } = require('./utils/time');

/** True when [startA, endA) overlaps [startB, endB). Touching is NOT overlap. */
function overlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/**
 * Is one candidate slot free?
 *   startTime       "HH:MM" candidate start
 *   durationMinutes total duration of the selected services
 *   bufferMinutes   gap that must be kept after every appointment (default 0)
 *   busy            [{ start: "HH:MM", end: "HH:MM" }] — existing bookings,
 *                   blocked ranges and the lunch break, all as wall-clock times
 * Both the candidate and each busy interval are extended by the buffer, so
 * a new booking must sit at least `bufferMinutes` away from its neighbours.
 */
function isSlotFree({ startTime, durationMinutes, bufferMinutes = 0, busy = [] }) {
  const start = toMinutes(startTime);
  const end = start + durationMinutes;
  return !busy.some((b) =>
    overlaps(start, end + bufferMinutes, toMinutes(b.start), toMinutes(b.end) + bufferMinutes)
  );
}

/**
 * All free start times for one day.
 *   openTime, closeTime  salon working hours for that weekday
 *   durationMinutes      total duration of the selected services
 *   bufferMinutes        gap between appointments
 *   busy                 existing bookings + blocked ranges + lunch break
 *   stepMinutes          grid step (15 = slots at :00, :15, :30, :45)
 * Returns ["09:00", "09:15", ...]. Returns [] when the day is closed
 * (callers pass openTime/closeTime as null) or nothing fits.
 */
function computeAvailableSlots({
  openTime,
  closeTime,
  durationMinutes,
  bufferMinutes = 0,
  busy = [],
  stepMinutes = 15,
}) {
  if (!openTime || !closeTime || durationMinutes <= 0) return [];
  const open = toMinutes(openTime);
  const close = toMinutes(closeTime);
  const slots = [];
  for (let start = open; start + durationMinutes <= close; start += stepMinutes) {
    if (isSlotFree({ startTime: fromMinutes(start), durationMinutes, bufferMinutes, busy })) {
      slots.push(fromMinutes(start));
    }
  }
  return slots;
}

module.exports = { overlaps, isSlotFree, computeAvailableSlots };
