// Customer booking page logic. All availability decisions are re-checked on
// the server inside a transaction — this page only shows a preview.
const slug = location.pathname.split('/book/')[1]?.split('/')[0] || '';
const $ = (id) => document.getElementById(id);
let services = [], selected = new Set(), staffId = 'any', selectedSlot = null, selectedReSlot = null, lookupBooking = null;

function showError(msg) { const el = $('error'); el.textContent = msg; el.classList.remove('hidden'); }
function showNotice(msg) { const el = $('notice'); el.textContent = msg; el.classList.remove('hidden'); }
function clearMessages() { $('error').classList.add('hidden'); $('notice').classList.add('hidden'); }
async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function setDateLimits(input) {
  const today = new Date(); const max = new Date(); max.setDate(max.getDate() + 30);
  input.min = fmtDate(today); input.max = fmtDate(max);
  if (!input.value) input.value = fmtDate(today);
}

function renderServices() {
  $('services').innerHTML = services.map((s) => `
    <div class="service-row">
      <input type="checkbox" data-id="${s.id}" ${selected.has(s.id) ? 'checked' : ''}>
      <div class="grow"><b>${s.name}</b><br><span class="muted">${s.duration_minutes} ${t('min')}</span></div>
      <b>₹${s.price}</b>
    </div>`).join('');
  $('services').querySelectorAll('input').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.id);
      if (cb.checked) selected.add(id); else selected.delete(id);
      updateTotals(); loadSlots();
    });
  });
}
function updateTotals() {
  let d = 0, p = 0;
  services.filter((s) => selected.has(s.id)).forEach((s) => { d += s.duration_minutes; p += s.price; });
  $('totalDuration').textContent = d; $('totalPrice').textContent = p;
}
function renderSlots(el, slots, onPick, current) {
  el.innerHTML = '';
  slots.forEach((slot) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'slot-btn' + (slot === current ? ' selected' : ''); b.textContent = slot;
    b.addEventListener('click', () => { onPick(slot); renderSlots(el, slots, onPick, slot); });
    el.appendChild(b);
  });
}
async function loadSlots() {
  clearMessages();
  if (selected.size === 0) { $('slots').innerHTML = ''; $('slotsEmpty').textContent = t('chooseServicesFirst'); $('slotsEmpty').classList.remove('hidden'); return; }
  const date = $('dateInput').value;
  if (!date) { $('slotsEmpty').textContent = t('chooseDateFirst'); $('slotsEmpty').classList.remove('hidden'); return; }
  $('slots').innerHTML = `<p class="muted">${t('loading')}</p>`; $('slotsEmpty').classList.add('hidden');
  try {
    const data = await api(`/api/salons/${slug}/availability?date=${date}&services=${[...selected].join(',')}&staffId=${staffId}`);
    selectedSlot = null;
    if (data.slots.length === 0) { $('slots').innerHTML = ''; $('slotsEmpty').textContent = t('noSlots'); $('slotsEmpty').classList.remove('hidden'); }
    else renderSlots($('slots'), data.slots, (s) => { selectedSlot = s; });
  } catch (e) { $('slots').innerHTML = ''; showError(e.message); }
}

async function init() {
  setDateLimits($('dateInput')); setDateLimits($('reDateInput'));
  try {
    const salon = await api(`/api/salons/${slug}`);
    $('salonName').textContent = salon.name;
    $('salonMeta').textContent = `${salon.address} · 📞 ${salon.phone}`;
    services = await api(`/api/salons/${slug}/services`);
    renderServices(); updateTotals();
    const staff = await api(`/api/salons/${slug}/staff`);
    staff.forEach((s) => {
      const opt = document.createElement('option'); opt.value = s.id; opt.textContent = s.name;
      $('staffSelect').appendChild(opt);
    });
    $('staffSelect').addEventListener('change', (e) => { staffId = e.target.value; loadSlots(); });
    $('dateInput').addEventListener('change', loadSlots);
    applyI18n(); loadSlots();
  } catch (e) { showError(e.message); }
}

$('confirmBtn').addEventListener('click', async () => {
  clearMessages();
  const name = $('custName').value.trim(), phone = $('custPhone').value.trim();
  if (selected.size === 0) return showError(t('chooseServicesFirst'));
  if (!name) return showError(t('enterName'));
  if (!/^[0-9]{10}$/.test(phone)) return showError(t('invalidPhone'));
  if (!selectedSlot) return showError(t('selectSlot'));
  $('confirmBtn').disabled = true;
  try {
    const b = await api('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: slug, customerName: name, phone, notes: $('custNotes').value.trim(),
        serviceIds: [...selected], staffId, date: $('dateInput').value, startTime: selectedSlot }) });
    $('confirmDetails').textContent = `${b.services.map((s) => s.name).join(', ')} · ${b.date} ${b.start_time}–${b.end_time} · ₹${b.total_price}${b.staff_name ? ` · ${b.staff_name}` : ''}`;
    $('confirmCode').textContent = b.booking_code;
    $('confirmation').classList.remove('hidden');
    $('confirmation').scrollIntoView();
  } catch (e) { showError(e.message); }
  $('confirmBtn').disabled = false;
});

$('lookupBtn').addEventListener('click', async () => {
  clearMessages();
  const phone = $('lookupPhone').value.trim(), code = $('lookupCode').value.trim().toUpperCase();
  if (!/^[0-9]{10}$/.test(phone)) return showError(t('invalidPhone'));
  try {
    lookupBooking = await api(`/api/bookings/lookup?phone=${phone}&code=${encodeURIComponent(code)}`);
    const b = lookupBooking;
    $('lookupResult').innerHTML = `
      <div class="card">
        <b>${b.services.map((s) => s.name).join(', ')}</b><br>
        ${b.date} ${b.start_time}–${b.end_time} · ₹${b.total_price} · ${b.staff_name || ''}<br>
        Status: <b>${b.status}</b>
        <p><button class="danger small" id="cancelBtn">${t('cancelBooking')}</button>
        <button class="secondary small" id="showReBtn">${t('reschedule')}</button></p>
      </div>`;
    $('cancelBtn').addEventListener('click', async () => {
      try { await api('/api/bookings/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) });
        showNotice(t('cancelled')); $('lookupResult').innerHTML = ''; $('rescheduleBox').classList.add('hidden'); }
      catch (e) { showError(e.message); }
    });
    $('showReBtn').addEventListener('click', () => { $('rescheduleBox').classList.remove('hidden'); loadReSlots(); });
  } catch (e) { showError(e.message); }
});

async function loadReSlots() {
  if (!lookupBooking) return;
  const date = $('reDateInput').value;
  const ids = lookupBooking.services.map((s) => s.id).join(',');
  try {
    const data = await api(`/api/salons/${slug}/availability?date=${date}&services=${ids}&staffId=any`);
    selectedReSlot = null;
    renderSlots($('reSlots'), data.slots, (s) => { selectedReSlot = s; });
  } catch (e) { showError(e.message); }
}
$('reDateInput').addEventListener('change', loadReSlots);
$('reConfirmBtn').addEventListener('click', async () => {
  clearMessages();
  if (!selectedReSlot) return showError(t('selectSlot'));
  try {
    const b = await api('/api/bookings/reschedule', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ salonSlug: slug, phone: $('lookupPhone').value.trim(), code: $('lookupCode').value.trim().toUpperCase(),
        date: $('reDateInput').value, startTime: selectedReSlot }) });
    showNotice(t('rescheduled')); lookupBooking = b; $('rescheduleBox').classList.add('hidden');
  } catch (e) { showError(e.message); }
});

init();
