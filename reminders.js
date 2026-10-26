// ---------------------------------------------------------------------------
// Reminder module — intentionally small and swappable.
// TODAY: sendReminder() only logs to the console (the spec's placeholder).
// LATER: replace the body of sendReminder() with a real SMS/WhatsApp API
// call (Twilio, WATI, Meta WhatsApp Cloud API, ...). Nothing else changes:
// every booking flow already calls sendReminder(), and the owner dashboard
// already offers a "Send on WhatsApp" button built from buildWhatsAppLink().
// ---------------------------------------------------------------------------

/** Friendly reminder text for one booking. Used by both console + WhatsApp. */
function buildReminderMessage(booking, salon) {
  const services = (booking.services || []).map((s) => s.name).join(', ') || 'your appointment';
  return (
    `Hi ${booking.customer_name}, this is a reminder from ${salon.name}. ` +
    `Your appointment for ${services} is on ${booking.date} at ${booking.start_time}. ` +
    `Total: ₹${booking.total_price}. Booking ID: ${booking.booking_code}. ` +
    `To cancel or reschedule, please call ${salon.phone}.`
  );
}

/** wa.me link the owner can tap to open WhatsApp with the text prefilled. */
function buildWhatsAppLink(phone, message) {
  // wa.me expects the number in international format without "+" or spaces.
  const digits = String(phone).replace(/\D/g, '');
  const intl = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
}

/** Placeholder sender: logs for now, real API call plugs in here later. */
function sendReminder(booking, salon) {
  const message = buildReminderMessage(booking, salon);
  // TODO: plug in SMS/WhatsApp API here, e.g.:
  // await smsClient.send({ to: booking.customer_phone, body: message });
  console.log(`[reminder] To ${booking.customer_phone}: ${message}`);
  return message;
}

module.exports = { buildReminderMessage, buildWhatsAppLink, sendReminder };
