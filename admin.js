// Owner dashboard logic. Token is kept in localStorage and sent as a
// Bearer header; the server re-checks it (and the salon scope) on every call.
const $ = (id) => document.getElementById(id);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const STATUSES = ['Confirmed', 'Completed', 'Cancelled', 'No-show'];
let token = localStorage.getItem('salon-token') || '';
let salonSlug = '';
let hoursData = [], wServices = new Set(), wSlot = null;

function showError(m) { const el = $('error'); el.textContent = m; el.classList.remove('hidden'); }
function showNotice(m) { const el = $('notice'); el.textContent = m; el.classList.remove('hidden'); }
function clearMsg() { $('error').classList.add('hidden'); $('notice').classList.add('hidden'); }
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function waLink(b) {
  const msg = `Hi ${b.customer_name}, this is a reminder from ${$('salonTitle').textContent}. Your appointment for ${b.services.map((s) => s.name).join(', ')} is on ${b.date} at ${b.start_time}. Total: ₹${b.total_price}. Booking ID: ${b.booking_code}.`;
  return `https://wa.me/91${b.customer_phone}?text=${encodeURIComponent(msg)}`;
}
function appointmentCard(b) {
  return `<div class="card">
    <b>${esc(b.start_time)}–${esc(b.end_time)}</b> · ${esc(b.customer_name)} (${esc(b.customer_phone)})<br>
    ${esc(b.services.map((s) => s.name).join(', '))} · ₹${b.total_price} · ${esc(b.staff_name || 'Any')}<br>
    Status: <b>${b.status}</b>
    <p><select data-id="${b.id}" class="status-select">
      ${STATUSES.map((s) => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <a class="btn secondary small" target="_blank" rel="noopener" href="${waLink(b)}">Send on WhatsApp</a></p>
  </div>`;
}
function bindStatusSelects(container, reload) {
  container.querySelectorAll('.status-select').forEach((sel) => {
    sel.addEventListener('change', async () => {
      try { await api(`/api/admin/appointments/${sel.dataset.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: sel.value }) }); showNotice('Status updated.'); reload(); }
      catch (e) { showError(e.message); }
    });
  });
}

// ---- Tabs -----------------------------------------------------------------
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.add('hidden'));
    $(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    loadTab(btn.dataset.tab);
  });
});
function loadTab(tab) {
  clearMsg();
  ({ today: loadToday, calendar: loadCalendar, services: loadServices, staff: loadStaff,
     hours: loadHours, customers: loadCustomers, stats: loadStats, walkin: loadWalkin })[tab]?.();
}

// ---- Today / calendar ------------------------------------------------------
async function loadToday() {
  const date = $('todayDate').value || todayStr();
  $('todayDate').value = date;
  const list = await api(`/api/admin/appointments?date=${date}`);
  $('todayList').innerHTML = list.length ? list.map(appointmentCard).join('') : '<p class="empty">No appointments for this day.</p>';
  bindStatusSelects($('todayList'), loadToday);
}
$('todayDate').addEventListener('change', loadToday);
function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`); const wd = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (wd === 0 ? 6 : wd - 1));
  return d.toISOString().slice(0, 10);
}
function addDaysStr(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
async function loadCalendar() {
  const monday = mondayOf($('weekStart').value || todayStr());
  $('weekStart').value = monday;
  const sunday = addDaysStr(monday, 6);
  const list = await api(`/api/admin/appointments?from=${monday}&to=${sunday}`);
  const byDay = {};
  list.forEach((b) => (byDay[b.date] = byDay[b.date] || []).push(b));
  let html = '';
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(monday, i);
    const day = byDay[date] || [];
    html += `<h3>${DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()]} · ${date}</h3>`;
    html += day.length ? day.map(appointmentCard).join('') : '<p class="empty">No appointments.</p>';
  }
  $('weekList').innerHTML = html;
  bindStatusSelects($('weekList'), loadCalendar);
}
$('weekStart').addEventListener('change', loadCalendar);

// ---- Services --------------------------------------------------------------
async function loadServices() {
  const list = await api('/api/admin/services');
  $('servicesList').innerHTML = list.map((s) => `
    <div class="card"><b>${esc(s.name)}</b> · ${s.duration_minutes} min · ₹${s.price} · ${s.is_active ? 'Active' : 'Disabled'}
    <p>
      <button class="secondary small" onclick="toggleService(${s.id}, ${s.is_active ? 0 : 1})">${s.is_active ? 'Disable' : 'Enable'}</button>
      <button class="danger small" onclick="deleteService(${s.id})">Delete</button>
    </p></div>`).join('') || '<p class="empty">No services yet.</p>';
}
async function toggleService(id, isActive) { await api(`/api/admin/services/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }); loadServices(); }
async function deleteService(id) { if (confirm('Delete this service?')) { const r = await api(`/api/admin/services/${id}`, { method: 'DELETE' }); if (r.message) showNotice(r.message); loadServices(); } }
$('serviceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/admin/services', { method: 'POST', body: JSON.stringify({ name: f.get('name'), duration_minutes: Number(f.get('duration_minutes')), price: Number(f.get('price')) }) });
    e.target.reset(); showNotice('Service added.'); loadServices();
  } catch (err) { showError(err.message); }
});

// ---- Staff -----------------------------------------------------------------
async function loadStaff() {
  $('staffDays').innerHTML = DAY_NAMES.map((n, i) => `<label style="display:inline-block;margin-right:10px"><input type="checkbox" name="days" value="${i}"> ${n}</label>`).join('');
  const list = await api('/api/admin/staff');
  $('staffList').innerHTML = list.map((s) => `
    <div class="card"><b>${esc(s.name)}</b> ${esc(s.phone)} · ${s.is_active ? 'Active' : 'Inactive'}<br>
    <span class="muted">Works: ${s.working_days.map((d) => DAY_NAMES[d]).join(', ') || '—'}</span>
    <p><button class="danger small" onclick="deleteStaff(${s.id})">Remove</button></p></div>`).join('') || '<p class="empty">No staff yet.</p>';
}
async function deleteStaff(id) { if (confirm('Remove this staff member?')) { const r = await api(`/api/admin/staff/${id}`, { method: 'DELETE' }); if (r.message) showNotice(r.message); loadStaff(); } }
$('staffForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const days = [...e.target.querySelectorAll('input[name="days"]:checked')].map((c) => Number(c.value));
  try {
    await api('/api/admin/staff', { method: 'POST', body: JSON.stringify({ name: f.get('name'), phone: f.get('phone'), working_days: days }) });
    e.target.reset(); showNotice('Staff member added.'); loadStaff();
  } catch (err) { showError(err.message); }
});

// ---- Hours, blocks, buffer ---------------------------------------------------
async function loadHours() {
  hoursData = await api('/api/admin/working-hours');
  const me = await api('/api/admin/me');
  $('bufferInput').value = me.salon.buffer_minutes;
  $('hoursForm').innerHTML = hoursData.map((h, i) => `
    <div class="day-row"><b>${DAY_NAMES[h.weekday]}</b><div>
      <label style="display:inline-block"><input type="checkbox" data-i="closed" ${h.is_closed ? 'checked' : ''}> Closed</label>
      <input type="time" data-i="open" value="${h.open_time || '10:00'}">
      <input type="time" data-i="close" value="${h.close_time || '20:00'}">
      <span class="muted">Lunch:</span>
      <input type="time" data-i="lunchStart" value="${h.lunch_start || ''}">
      <input type="time" data-i="lunchEnd" value="${h.lunch_end || ''}">
    </div></div>`).join('');
  const blocks = await api('/api/admin/blocked-slots');
  $('blocksList').innerHTML = blocks.map((b) => `
    <div class="card">${b.date} ${b.start_time ? `${b.start_time}–${b.end_time}` : 'Full day'} · ${esc(b.reason)}
    <p><button class="danger small" onclick="deleteBlock(${b.id})">Remove block</button></p></div>`).join('') || '<p class="empty">No blocks set.</p>';
}
async function deleteBlock(id) { await api(`/api/admin/blocked-slots/${id}`, { method: 'DELETE' }); loadHours(); }
$('saveHoursBtn').addEventListener('click', async () => {
  const rows = [...$('hoursForm').querySelectorAll('.day-row')];
  const hours = rows.map((row, i) => {
    const get = (k) => row.querySelector(`[data-i="${k}"]`);
    const closed = get('closed').checked;
    return { weekday: hoursData[i].weekday, is_closed: closed, open_time: get('open').value, close_time: get('close').value,
      lunch_start: get('lunchStart').value || null, lunch_end: get('lunchEnd').value || null };
  });
  try { await api('/api/admin/working-hours', { method: 'PUT', body: JSON.stringify({ hours }) }); showNotice('Working hours saved.'); }
  catch (e) { showError(e.message); }
});
$('saveBufferBtn').addEventListener('click', async () => {
  try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ buffer_minutes: Number($('bufferInput').value) }) }); showNotice('Buffer saved.'); }
  catch (e) { showError(e.message); }
});
$('blockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  try {
    await api('/api/admin/blocked-slots', { method: 'POST', body: JSON.stringify({ date: f.get('date'), start_time: f.get('start_time') || null, end_time: f.get('end_time') || null, reason: f.get('reason') }) });
    e.target.reset(); showNotice('Block added.'); loadHours();
  } catch (err) { showError(err.message); }
});

// ---- Customers / stats -------------------------------------------------------
async function loadCustomers() {
  const list = await api('/api/admin/customers');
  $('customersList').innerHTML = `<table><tr><th>Name</th><th>Phone</th><th>Visits</th><th>Last visit</th><th>No-shows</th></tr>` +
    list.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${c.total_visits}</td><td>${c.last_visit || '—'}</td><td>${c.no_show_count}</td></tr>`).join('') + '</table>';
}
async function loadStats() {
  const s = await api('/api/admin/stats');
  $('statsBox').innerHTML = `
    <div class="stat"><b>${s.week.appointments}</b>Appointments this week<br><span class="muted">${s.week.from} → ${s.week.to}</span></div>
    <div class="stat"><b>${s.month.appointments}</b>Appointments this month</div>
    <div class="stat"><b>₹${s.month.estimated_revenue}</b>Estimated revenue (this month)</div>
    <div class="stat"><b>${esc(s.most_booked_service?.name || '—')}</b>Most booked service</div>
    <div class="stat"><b>${s.no_show_rate}%</b>No-show rate (${s.no_show_count} of ${s.total_bookings})</div>`;
}

// ---- Walk-in -----------------------------------------------------------------
async function loadWalkin() {
  const services = await api('/api/admin/services');
  $('wServices').innerHTML = services.filter((s) => s.is_active).map((s) => `
    <label style="display:block"><input type="checkbox" data-id="${s.id}"> ${esc(s.name)} · ${s.duration_minutes} min · ₹${s.price}</label>`).join('');
  $('wServices').querySelectorAll('input').forEach((cb) => cb.addEventListener('change', () => {
    const id = Number(cb.dataset.id);
    if (cb.checked) wServices.add(id); else wServices.delete(id);
    loadWSlots();
  }));
  const staff = await api('/api/admin/staff');
  $('wStaff').innerHTML = '<option value="any">Any available</option>' + staff.filter((s) => s.is_active).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('wDate').min = todayStr();
  const max = new Date(); max.setDate(max.getDate() + 30); $('wDate').max = max.toISOString().slice(0, 10);
  if (!$('wDate').value) $('wDate').value = todayStr();
  loadWSlots();
}
async function loadWSlots() {
  if (wServices.size === 0) { $('wSlots').innerHTML = '<p class="muted">Select services first.</p>'; return; }
  try {
    const data = await api(`/api/salons/${salonSlug}/availability?date=${$('wDate').value}&services=${[...wServices].join(',')}&staffId=${$('wStaff').value}`);
    wSlot = null;
    $('wSlots').innerHTML = '';
    data.slots.forEach((slot) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'slot-btn'; b.textContent = slot;
      b.addEventListener('click', () => { wSlot = slot; [...$('wSlots').children].forEach((c) => c.classList.remove('selected')); b.classList.add('selected'); });
      $('wSlots').appendChild(b);
    });
    if (data.slots.length === 0) $('wSlots').innerHTML = '<p class="empty">Is din ke liye koi slot khali nahi hai</p>';
  } catch (e) { showError(e.message); }
}
$('wDate').addEventListener('change', loadWSlots);
$('wStaff').addEventListener('change', loadWSlots);
$('wConfirmBtn').addEventListener('click', async () => {
  clearMsg();
  const name = $('wName').value.trim(), phone = $('wPhone').value.trim();
  if (!name) return showError('Enter the customer name.');
  if (!/^[0-9]{10}$/.test(phone)) return showError('Enter a valid 10-digit phone number.');
  if (!wSlot) return showError('Select a time slot.');
  try {
    const b = await api('/api/admin/bookings', { method: 'POST', body: JSON.stringify({ salonSlug, customerName: name, phone, notes: $('wNotes').value.trim(), serviceIds: [...wServices], staffId: $('wStaff').value, date: $('wDate').value, startTime: wSlot }) });
    showNotice(`Walk-in booking created: ${b.booking_code} on ${b.date} at ${b.start_time}.`);
  } catch (e) { showError(e.message); }
});

// ---- Login / logout ------------------------------------------------------------
$('loginBtn').addEventListener('click', async () => {
  clearMsg();
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('loginEmail').value.trim(), password: $('loginPassword').value }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    token = data.token; salonSlug = data.salon.slug;
    localStorage.setItem('salon-token', token);
    showDashboard(data.salon.name);
  } catch (e) { showError(e.message); }
});
$('logoutBtn').addEventListener('click', () => {
  token = ''; localStorage.removeItem('salon-token');
  $('dash').classList.add('hidden'); $('loginBox').classList.remove('hidden');
});
function showDashboard(salonName) {
  $('loginBox').classList.add('hidden'); $('dash').classList.remove('hidden');
  $('salonTitle').textContent = salonName || 'Salon';
  $('todayDate').value = todayStr();
  loadToday();
}
if (token) {
  // Validate the saved token by fetching the profile; fall back to login.
  api('/api/admin/me').then((me) => { salonSlug = me.salon.slug; showDashboard(me.salon.name); })
    .catch(() => { token = ''; localStorage.removeItem('salon-token'); });
}
