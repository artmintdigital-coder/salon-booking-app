// Shared validation, used by BOTH the public and the admin routes.
// The frontend validates too, but the backend is the real gatekeeper:
// anything sent with curl/Postman must pass these checks as well.

const PHONE_RE = /^[0-9]{10}$/; // exactly 10 digits
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidPhone(phone) {
  return typeof phone === 'string' && PHONE_RE.test(phone.trim());
}
function isValidDate(date) {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
function isValidTime(time) {
  return typeof time === 'string' && TIME_RE.test(time);
}
function isNonEmptyString(value, maxLength = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

/** Small helper so route handlers can fail with an HTTP status. */
function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { isValidPhone, isValidDate, isValidTime, isNonEmptyString, fail };
