// Simple English / Hindi toggle. Elements carry data-i18n="key" (text) or
// data-i18n-ph="key" (input placeholder). Add keys here to translate more.
const I18N = {
  en: {
    bookTitle: 'Book an appointment', selectServices: 'Select services', total: 'Total',
    duration: 'Duration', min: 'min', chooseStaff: 'Choose staff', anyAvailable: 'Any available',
    selectDate: 'Select a date', availableSlots: 'Available slots', noSlots: 'Is din ke liye koi slot khali nahi hai',
    noSlotsEn: 'No slots are available for this day.',
    yourDetails: 'Your details', name: 'Name', phone: 'Phone number (10 digits)', notes: 'Notes (optional)',
    confirmBooking: 'Confirm booking', bookingConfirmed: 'Booking confirmed!',
    bookingId: 'Booking ID', cancelBooking: 'Cancel booking', reschedule: 'Reschedule',
    lookupTitle: 'Find your booking', lookupHint: 'Enter your phone number and booking ID to cancel or reschedule.',
    findBooking: 'Find booking', loading: 'Loading…', chooseServicesFirst: 'Please select at least one service first.',
    chooseDateFirst: 'Please choose a date first.', invalidPhone: 'Please enter a valid 10-digit phone number.',
    enterName: 'Please enter your name.', selectSlot: 'Please select a time slot.',
    cancelled: 'Booking cancelled.', rescheduled: 'Booking rescheduled successfully.',
  },
  hi: {
    bookTitle: 'अपॉइंटमेंट बुक करें', selectServices: 'सेवाएँ चुनें', total: 'कुल',
    duration: 'अवधि', min: 'मिनट', chooseStaff: 'स्टाफ चुनें', anyAvailable: 'कोई भी उपलब्ध',
    selectDate: 'तारीख चुनें', availableSlots: 'उपलब्ध स्लॉट', noSlots: 'Is din ke liye koi slot khali nahi hai',
    noSlotsEn: 'इस दिन के लिए कोई स्लॉट उपलब्ध नहीं है।',
    yourDetails: 'आपका विवरण', name: 'नाम', phone: 'फ़ोन नंबर (10 अंक)', notes: 'नोट्स (वैकल्पिक)',
    confirmBooking: 'बुकिंग पक्की करें', bookingConfirmed: 'बुकिंग पक्की हो गई!',
    bookingId: 'बुकिंग आईडी', cancelBooking: 'बुकिंग रद्द करें', reschedule: 'दोबारा शेड्यूल करें',
    lookupTitle: 'अपनी बुकिंग खोजें', lookupHint: 'रद्द करने या दोबारा शेड्यूल करने के लिए फ़ोन नंबर और बुकिंग आईडी डालें।',
    findBooking: 'बुकिंग खोजें', loading: 'लोड हो रहा है…', chooseServicesFirst: 'कृपया पहले कम से कम एक सेवा चुनें।',
    chooseDateFirst: 'कृपया पहले तारीख चुनें।', invalidPhone: 'कृपया सही 10 अंकों का फ़ोन नंबर डालें।',
    enterName: 'कृपया अपना नाम डालें।', selectSlot: 'कृपया एक समय स्लॉट चुनें।',
    cancelled: 'बुकिंग रद्द हो गई।', rescheduled: 'बुकिंग सफलतापूर्वक दोबारा शेड्यूल हो गई।',
  },
};

let currentLang = localStorage.getItem('salon-lang') || 'en';
function t(key) { return (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key; }
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('.lang-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.lang === currentLang));
}
function setLang(lang) { currentLang = lang; localStorage.setItem('salon-lang', lang); applyI18n(); }
