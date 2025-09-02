// External module for nco-scheduler logic.
// This file mirrors src/app.js so it can be hosted separately (e.g., GitHub Pages).
// It expects window.SUPABASE_URL and window.SUPABASE_KEY to be defined by the host page.

// Minimal client wiring and form handler
const url = window.SUPABASE_URL;
const key = window.SUPABASE_KEY;
if (!url || !key) {
  console.warn("Missing SUPABASE_URL or SUPABASE_KEY. Define them before loading nco-scheduler.js.");
}
let sb; // created in init once Supabase SDK is confirmed loaded
const loadedData = { classes: [], instructors: [], locations: [] };
let observerStarted = false;
const listenerFlags = {
  addInstructor: false,
  addSingle: false,
  form: false,
  table: false,
  recurrence: false,
  filterClass: false,
  filterInstructor: false,
  filterLocation: false,
  filterFrom: false,
  filterTo: false,
  clearFilters: false,
  exportCsv: false,
  historyClose: false,
  historyExport: false,
  viewSeries: false,
  keydown: false,
};

// In-memory lookup maps for rendering names
const lookup = {
  classes: new Map(),
  instructors: new Map(),
  locations: new Map(),
};

// Simple state for sorting and filters
const state = {
  sort: { col: 'date', dir: 'asc' },
  filters: { class_id: '', instructor_id: '', from: '', to: '' },
  editingId: null,
};

const el = {};
function wireDom() {
  el.classSelect = document.getElementById('classSelect');
  el.instructorSelect = document.getElementById('instructorSelect');
  el.addInstructorBtn = document.getElementById('addInstructorBtn');
  el.locationSelect = document.getElementById('locationSelect');
  el.addSingleBtn = document.getElementById('addSingleBtn');
  el.singleDate = document.getElementById('singleDate');
  el.singleStartHour = document.getElementById('singleStartHour');
  el.singleStartMin = document.getElementById('singleStartMin');
  el.singleEndHour = document.getElementById('singleEndHour');
  el.singleEndMin = document.getElementById('singleEndMin');
  el.startHour = document.getElementById('startHour');
  el.startMin = document.getElementById('startMin');
  el.endHour = document.getElementById('endHour');
  el.endMin = document.getElementById('endMin');
  el.startDate = document.getElementById('startDate');
  el.endDate = document.getElementById('endDate');
  el.recurrence = document.getElementById('recurrence');
  el.monthlyWeek = document.getElementById('monthlyWeek');
  el.monthlyWeekWrap = document.getElementById('monthlyWeekWrap');
  el.form = document.getElementById('schedule-form');
  el.toast = document.getElementById('toast');
  el.table = document.getElementById('table');
  // filters UI (separate area)
  el.filterClass = document.getElementById('filterClass');
  el.filterInstructor = document.getElementById('filterInstructor');
  el.filterLocation = document.getElementById('filterLocation');
  el.filterFrom = document.getElementById('filterFrom');
  el.filterTo = document.getElementById('filterTo');
  el.clearFilters = document.getElementById('clearFilters');
  el.exportCsvBtn = document.getElementById('exportCsv');
  el.viewSeriesSummaries = document.getElementById('viewSeriesSummaries');
}

function ensureHistoryElements() {
  // If an existing drawer is in the DOM, wire it up and return
  const existing = document.getElementById('historyDrawer');
  if (existing && (!el.historyDrawer || !document.body.contains(el.historyDrawer))) {
    el.historyDrawer = existing;
    el.historyList = existing.querySelector('#historyList');
    el.historyClose = existing.querySelector('#historyClose');
    el.historyExport = existing.querySelector('#historyExport');
    // Ensure overlay exists
    let overlay = document.getElementById('historyOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'historyOverlay';
      overlay.className = 'drawer-overlay';
      overlay.hidden = true;
      document.body.appendChild(overlay);
    }
    el.historyOverlay = overlay;
    el.historyClose?.addEventListener('click', () => closeHistory());
    el.historyExport?.addEventListener('click', () => exportHistoryCSV());
    overlay.addEventListener('click', () => closeHistory());
    return;
  }

  if (el.historyDrawer && document.body.contains(el.historyDrawer)) return;
  // Create a transparent overlay behind the drawer to catch outside clicks
  let overlay = document.getElementById('historyOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'historyOverlay';
    overlay.className = 'drawer-overlay';
    overlay.hidden = true;
    document.body.appendChild(overlay);
  }
  const wrapper = document.createElement('aside');
  wrapper.id = 'historyDrawer';
  wrapper.className = 'drawer';
  wrapper.innerHTML = `
    <div class=\"drawer-content\">\n      <div class=\"drawer-header\">\n        <h3>Series History</h3>\n        <button type=\"button\" id=\"historyClose\" aria-label=\"Close\">×</button>\n      </div>\n      <div id=\"historyList\" class=\"history-list\"></div>\n      <div class=\"actions\">\n        <button type=\"button\" id=\"historyExport\">Export History CSV</button>\n      </div>\n    </div>`;
  document.body.appendChild(wrapper);
  el.historyDrawer = wrapper;
  el.historyOverlay = overlay;
  el.historyList = wrapper.querySelector('#historyList');
  el.historyClose = wrapper.querySelector('#historyClose');
  el.historyExport = wrapper.querySelector('#historyExport');
  el.historyClose?.addEventListener('click', () => closeHistory());
  el.historyExport?.addEventListener('click', () => exportHistoryCSV());
  // clicking overlay closes
  overlay.addEventListener('click', () => closeHistory());
}

function toast(msg, type = 'info') {
  if (!el.toast) { console[type === 'error' ? 'error' : 'log'](msg); return; }
  el.toast.textContent = msg;
  el.toast.className = `toast ${type}`;
  // Force color to ensure it overrides base #toast rule in all browsers
  if (type === 'error') {
    el.toast.style.color = 'var(--err)';
  } else if (type === 'success') {
    el.toast.style.color = 'var(--ok)';
  } else {
    el.toast.style.color = 'var(--muted)';
  }
}

async function loadLists() {
  const [classes, instructors, locations] = await Promise.all([
    sb.from('classes').select('id,name').eq('status','active').order('name'),
    sb.from('instructors').select('id,name').eq('status','active').order('name'),
    sb.from('locations').select('id,name').eq('status','active').order('name'),
  ]);

  for (const { data, error } of [classes, instructors, locations]) {
    if (error) throw error;
  }
  // refresh lookup maps
  lookup.classes = new Map((classes.data || []).map(r => [r.id, r.name]));
  lookup.instructors = new Map((instructors.data || []).map(r => [r.id, r.name]));
  lookup.locations = new Map((locations.data || []).map(r => [r.id, r.name]));
  loadedData.classes = classes.data || [];
  loadedData.instructors = instructors.data || [];
  loadedData.locations = locations.data || [];
  maybePopulateUI();
}

async function loadInstructors(selectIdToKeep = null) {
  const { data, error } = await sb
    .from('instructors')
    .select('id,name')
    .eq('status','active')
    .order('name');
  if (error) throw error;
  lookup.instructors = new Map((data || []).map(r => [r.id, r.name]));
  populateSelect(el.instructorSelect, data);
  if (selectIdToKeep) {
    el.instructorSelect.value = selectIdToKeep;
  }
}

function populateSelect(select, rows, multiple = false) {
  if (!select) return;
  select.innerHTML = '';
  for (const r of rows) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  }
}

function populateSelectWithAll(select, rows) {
  if (!select) return;
  select.innerHTML = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All';
  select.appendChild(all);
  for (const r of rows || []) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    select.appendChild(opt);
  }
}

function parseSelectedDays() {
  return Array.from(document.querySelectorAll('input[name="dow"]:checked')).map(i => parseInt(i.value, 10));
}

function* dateRange(start, end) {
  const d = new Date(start.getTime());
  while (d <= end) {
    yield new Date(d.getTime());
    d.setDate(d.getDate() + 1);
  }
}

function isoDow(jsDate) {
  const d = jsDate.getDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}

function toYMD(jsDate) {
  const y = jsDate.getFullYear();
  const m = String(jsDate.getMonth()+1).padStart(2,'0');
  const d = String(jsDate.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function parseYMDLocal(ymd) {
  // Parse "YYYY-MM-DD" into a local Date (midnight local time), avoiding UTC shifts
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isOverlapError(e) {
  const msg = (e && (e.message || e.toString())) || '';
  const code = e && e.code;
  return (
    code === '23P01' ||
    /session_locations_no_overlap/i.test(msg) ||
    /exclusion constraint/i.test(msg)
  );
}

function pad2(n) { return String(n).padStart(2,'0'); }

function dowLabel(n) {
  // 1=Mon..7=Sun
  return ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][n] || String(n);
}

function getTimeFromSelect(hourEl, minEl) {
  const h = hourEl?.value;
  const m = minEl?.value;
  if (!h || !m) return '';
  return `${pad2(h)}:${pad2(m)}`;
}

function populateHourSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">HH</option>';
  for (let h=0; h<24; h++) {
    const opt = document.createElement('option');
    opt.value = pad2(h);
    opt.textContent = pad2(h);
    sel.appendChild(opt);
  }
}

function populateMinSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">MM</option>';
  for (const m of [0, 15, 30, 45]) {
    const opt = document.createElement('option');
    opt.value = pad2(m);
    opt.textContent = pad2(m);
    sel.appendChild(opt);
  }
}

function initTimeSelects() {
  [el.startHour, el.singleStartHour, el.singleEndHour, el.endHour].forEach(populateHourSelect);
  [el.startMin, el.singleStartMin, el.singleEndMin, el.endMin].forEach(populateMinSelect);
}

function maybePopulateUI() {
  // Populate selects if their DOM nodes exist
  if (el.classSelect && loadedData.classes.length) populateSelect(el.classSelect, loadedData.classes);
  if (el.instructorSelect && loadedData.instructors.length) populateSelect(el.instructorSelect, loadedData.instructors);
  if (el.locationSelect && loadedData.locations.length) populateSelect(el.locationSelect, loadedData.locations, true);
  if (el.filterClass && loadedData.classes.length) populateSelectWithAll(el.filterClass, loadedData.classes);
  if (el.filterInstructor && loadedData.instructors.length) populateSelectWithAll(el.filterInstructor, loadedData.instructors);
  if (el.filterLocation && loadedData.locations.length) populateSelectWithAll(el.filterLocation, loadedData.locations);
}

function attachListenersIfPresent() {
  if (el.addInstructorBtn && !listenerFlags.addInstructor) { el.addInstructorBtn.addEventListener('click', addInstructorFlow); listenerFlags.addInstructor = true; }
  if (el.addSingleBtn && !listenerFlags.addSingle) { el.addSingleBtn.addEventListener('click', onAddSingle); listenerFlags.addSingle = true; }
  if (el.form && !listenerFlags.form) { el.form.addEventListener('submit', onAddSeries); listenerFlags.form = true; }
  if (el.table && !listenerFlags.table) { el.table.addEventListener('click', onTableClick); listenerFlags.table = true; }
  if (el.recurrence && !listenerFlags.recurrence) { el.recurrence.addEventListener('change', updateMonthlyVisibility); listenerFlags.recurrence = true; }
  if (el.filterClass && !listenerFlags.filterClass) { el.filterClass.addEventListener('change', () => { state.filters.class_id = el.filterClass.value || ''; refreshTable(); }); listenerFlags.filterClass = true; }
  if (el.filterInstructor && !listenerFlags.filterInstructor) { el.filterInstructor.addEventListener('change', () => { state.filters.instructor_id = el.filterInstructor.value || ''; refreshTable(); }); listenerFlags.filterInstructor = true; }
  if (el.filterLocation && !listenerFlags.filterLocation) { el.filterLocation.addEventListener('change', () => { state.filters.location_id = el.filterLocation.value || ''; refreshTable(); }); listenerFlags.filterLocation = true; }
  if (el.filterFrom && !listenerFlags.filterFrom) { el.filterFrom.addEventListener('change', () => { state.filters.from = el.filterFrom.value || ''; refreshTable(); }); listenerFlags.filterFrom = true; }
  if (el.filterTo && !listenerFlags.filterTo) { el.filterTo.addEventListener('change', () => { state.filters.to = el.filterTo.value || ''; refreshTable(); }); listenerFlags.filterTo = true; }
  if (el.clearFilters && !listenerFlags.clearFilters) { el.clearFilters.addEventListener('click', () => {
    state.filters = { class_id: '', instructor_id: '', location_id: '', from: '', to: '' };
    if (el.filterClass) el.filterClass.value = '';
    if (el.filterInstructor) el.filterInstructor.value = '';
    if (el.filterLocation) el.filterLocation.value = '';
    if (el.filterFrom) el.filterFrom.value = '';
    if (el.filterTo) el.filterTo.value = '';
    refreshTable();
  }); listenerFlags.clearFilters = true; }
  if (el.exportCsvBtn && !listenerFlags.exportCsv) { el.exportCsvBtn.addEventListener('click', exportCSV); listenerFlags.exportCsv = true; }
  if (el.historyClose && !listenerFlags.historyClose) { el.historyClose.addEventListener('click', () => closeHistory()); listenerFlags.historyClose = true; }
  if (el.historyExport && !listenerFlags.historyExport) { el.historyExport.addEventListener('click', () => exportHistoryCSV()); listenerFlags.historyExport = true; }
  if (!listenerFlags.keydown) { document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeHistory(); }); listenerFlags.keydown = true; }
  if (el.viewSeriesSummaries && !listenerFlags.viewSeries) { el.viewSeriesSummaries.addEventListener('click', () => openSeriesSummaries()); listenerFlags.viewSeries = true; }
}

function startDomObserver() {
  if (observerStarted) return;
  observerStarted = true;
  const obs = new MutationObserver(() => {
    wireDom();
    initTimeSelects();
    maybePopulateUI();
    attachListenersIfPresent();
    // If table exists and we have a client, render
    if (el.table && sb) refreshTable();
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

async function addInstructorFlow() {
  const name = prompt('New instructor name');
  if (!name) return;
  const { data, error } = await sb.from('instructors').insert({ name, status: 'active' }).select('id').single();
  if (error) { toast(`Failed to add instructor: ${error.message}`, 'error'); return; }
  await loadInstructors(data.id);
}

function generateOccurrences(startDate, endDate, days, recurrence, monthlyWeek) {
  const s = parseYMDLocal(startDate), e = parseYMDLocal(endDate);
  const out = [];
  if (recurrence === 'monthly') {
    // For monthly recurrence, use specified week-of-month for each selected day.
    // monthlyWeek: '1'..'4' indicates nth week of the month.
    const nth = parseInt(monthlyWeek, 10) || 1;
    const months = new Set();
    for (const d of dateRange(s, e)) {
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (months.has(key)) continue;
      months.add(key);
      for (const day of days) {
        const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        // Find first occurrence of desired day in the month
        let firstDow = isoDow(firstOfMonth);
        let diff = day - firstDow;
        if (diff < 0) diff += 7;
        const target = new Date(firstOfMonth);
        target.setDate(1 + diff + (nth - 1) * 7);
        if (target >= s && target <= e && isoDow(target) === day && target.getMonth() === d.getMonth()) {
          out.push(toYMD(target));
        }
      }
    }
    return Array.from(new Set(out)).sort();
  }

  let step = 1;
  if (recurrence === 'biweekly') step = 2;
  for (const d of dateRange(s, e)) {
    if (days.includes(isoDow(d))) {
      out.push(toYMD(d));
    }
  }
  if (step === 2) {
    // Filter to every other week based on ISO week number parity
    return out.filter((ymd, idx) => {
      const dt = parseYMDLocal(ymd);
      const onejan = new Date(dt.getFullYear(), 0, 1);
      const week = Math.ceil((((dt - onejan) / 86400000) + onejan.getDay() + 1) / 7);
      return week % 2 === 0; // keep even weeks
    });
  }
  return out;
}

async function createSeries(class_id, instructor_id, start_date, end_date, recurrence, days) {
  const { data, error } = await sb.from('class_series').insert({
    class_id, instructor_id, start_date, end_date, recurrence, days
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function insertSessionRPC(series_id, class_id, instructor_id, date, start_time, end_time, location_ids) {
  // RPC encapsulates location overlap logic in the DB
  const { error } = await sb.rpc('insert_session_with_locations', {
    p_series_id: series_id,
    p_class_id: class_id,
    p_instructor_id: instructor_id,
    p_date: date,
    p_start_time: start_time,
    p_end_time: end_time,
    p_location_ids: location_ids,
  });
  if (error) throw error;
}

async function deleteSession(id) {
  const { error } = await sb.from('sessions').delete().eq('id', id);
  if (error) throw error;
}

async function deleteSeries(series_id) {
  const { error } = await sb.from('class_series').delete().eq('id', series_id);
  if (error) throw error;
}

function parseLocationMulti(selectEl) {
  return Array.from(selectEl.selectedOptions).map(opt => opt.value);
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

function csvEscape(s) {
  const str = String(s ?? '');
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

async function onAddSingle() {
  try {
    const class_id = el.classSelect.value;
    const instructor_id = el.instructorSelect.value;
    const location_ids = parseLocationMulti(el.locationSelect);
    const date = el.singleDate.value;
    const start_time = getTimeFromSelect(el.singleStartHour, el.singleStartMin);
    const end_time = getTimeFromSelect(el.singleEndHour, el.singleEndMin);
    if (!class_id || !instructor_id || !location_ids.length || !date || !start_time || !end_time) {
      toast('Provide class, instructor, date, time, and locations.', 'error');
      return;
    }
    if (end_time <= start_time) { toast('End time must be after start time.', 'error'); return; }
    const series_id = await createSeries(class_id, instructor_id, date, date, 'once', []);
    await insertSessionRPC(series_id, class_id, instructor_id, date, start_time, end_time, location_ids);
    toast('Added session.', 'success');
    await refreshTable();
  } catch (e) {
    console.error(e);
    if (isOverlapError(e)) {
      toast('Error: There is a session booked in one of these classrooms during this time', 'error');
    } else {
      toast(`Error: ${e.message}`, 'error');
    }
  }
}

async function onAddSeries(ev) {
  ev?.preventDefault?.();
  try {
    const class_id = el.classSelect.value;
    const instructor_id = el.instructorSelect.value;
    const location_ids = parseLocationMulti(el.locationSelect);
    const start_date = el.startDate.value;
    const end_date = el.endDate.value;
    const start_time = getTimeFromSelect(el.startHour, el.startMin);
    const end_time = getTimeFromSelect(el.endHour, el.endMin);
    const recurrence = el.recurrence.value;
    const days = parseSelectedDays();
    const monthlyWeek = el.monthlyWeek.value;
    if (!class_id || !instructor_id || !location_ids.length || !start_date || !end_date) { toast('Provide all fields.', 'error'); return; }
    if (end_date < start_date) { toast('End date must be on/after start date.', 'error'); return; }
    if (!start_time || !end_time || end_time <= start_time) { toast('End time must be after start time.', 'error'); return; }
    if ((recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly') && days.length === 0) { toast('Select at least one day for recurring schedules.', 'error'); return; }

    const series_id = await createSeries(class_id, instructor_id, start_date, end_date, recurrence, days);
    const dates = generateOccurrences(start_date, end_date, days, recurrence, monthlyWeek);
    let created = 0, blocked = 0;
    let overlapNotified = false;
    for (const dateStr of dates) {
      try {
        await insertSessionRPC(series_id, class_id, instructor_id, dateStr, start_time, end_time, location_ids);
        created++;
      } catch (e) {
        blocked++;
        if (!overlapNotified && isOverlapError(e)) {
          toast('Error: There is a session booked in one of these classrooms during this time', 'error');
          overlapNotified = true;
        }
      }
    }
    if (!overlapNotified) toast(`Added ${created} session(s). Blocked ${blocked}.`, 'success');
    await refreshTable();
  } catch (e) {
    console.error(e);
    if (isOverlapError(e)) toast('Error: There is a session booked in one of these classrooms during this time', 'error');
    else toast(`Error: ${e.message}`, 'error');
  }
}

async function refreshTable(page = 0, pageSize = 50) {
  const from = page * pageSize;
  const to = from + pageSize - 1;
  let q = sb.from('v_sessions').select('*', { count: 'exact' });
  // apply filters
  if (state.filters.class_id) q = q.eq('class_id', state.filters.class_id);
  if (state.filters.instructor_id) q = q.eq('instructor_id', state.filters.instructor_id);
  if (state.filters.location_id) q = q.contains('location_ids', [state.filters.location_id]);
  if (state.filters.from) q = q.gte('date', state.filters.from);
  if (state.filters.to) q = q.lte('date', state.filters.to);

  // sorting
  const serverSortable = new Set(['date','start_time','end_time','week_number','day_of_week']);
  if (serverSortable.has(state.sort.col)) {
    q = q.order(state.sort.col, { ascending: state.sort.dir === 'asc' });
    if (state.sort.col !== 'date') {
      q = q.order('date', { ascending: true });
    }
  } else {
    // default order for stable client-side sorting
    q = q.order('date', { ascending: true }).order('start_time', { ascending: true });
  }

  q = q.range(from, to);
  const { data, error } = await q;
  if (error) { console.error(error); return; }

  let rows = data || [];
  if (!serverSortable.has(state.sort.col)) {
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    if (state.sort.col === 'class') {
      rows = rows.sort((a,b) => ((lookup.classes.get(a.class_id)||'').localeCompare(lookup.classes.get(b.class_id)||'')) * dir);
    } else if (state.sort.col === 'instructor') {
      rows = rows.sort((a,b) => ((lookup.instructors.get(a.instructor_id)||'').localeCompare(lookup.instructors.get(b.instructor_id)||'')) * dir);
    } else if (state.sort.col === 'locations') {
      rows = rows.sort((a,b) => {
        const an = (a.location_ids||[]).map(id => lookup.locations.get(id)||'').join(', ');
        const bn = (b.location_ids||[]).map(id => lookup.locations.get(id)||'').join(', ');
        return an.localeCompare(bn) * dir;
      });
    }
  }

  renderTable(rows);
}

function renderTable(rows) {
  const html = [
    '<table><thead><tr>',
    headerCell('date','Date'),
    headerCell('start_time','Start'),
    headerCell('end_time','End'),
    headerCell('week_number','Week #'),
    headerCell('day_of_week','Day'),
    headerCell('class','Class'),
    headerCell('instructor','Instructor'),
    headerCell('locations','Locations'),
    '<th>Actions</th>',
    '</tr></thead><tbody>',
    ...rows.map(r => {
      const className = lookup.classes.get(r.class_id) || r.class_id;
      const instructorName = lookup.instructors.get(r.instructor_id) || r.instructor_id;
      const locNames = (r.location_ids || []).map(id => lookup.locations.get(id) || id).join(', ');
      const isEditing = state.editingId === r.id;
      if (!isEditing) {
        return `<tr data-session-id="${r.id}" data-series-id="${r.series_id}" data-class-id="${r.class_id}" data-instructor-id="${r.instructor_id}">
          <td>${r.date}</td>
          <td>${r.start_time}</td>
          <td>${r.end_time}</td>
          <td>${r.week_number}</td>
          <td>${dowLabel(r.day_of_week)}</td>
          <td>${className}</td>
          <td>${instructorName}</td>
          <td>${locNames}</td>
          <td>
            <button type="button" data-action="edit" data-session-id="${r.id}">Edit</button>
            <button type="button" data-action="delete" data-session-id="${r.id}">Delete</button>
            <button type="button" data-action="history" data-series-id="${r.series_id}">History</button>
            <button type="button" data-action="delete-series" data-series-id="${r.series_id}">Delete Series</button>
          </td>
        </tr>`;
      } else {
        // Build inline editors
        const startHH = String(r.start_time).slice(0,2);
        const startMM = String(r.start_time).slice(3,5);
        const endHH = String(r.end_time).slice(0,2);
        const endMM = String(r.end_time).slice(3,5);
        const hourOpts = Array.from({length:24}, (_,h)=>`<option value="${pad2(h)}" ${pad2(h)===startHH? 'data-start-selected':''} ${pad2(h)===endHH? 'data-end-selected':''}>${pad2(h)}</option>`).join('');
        const minOpts = [0,15,30,45].map(m=>`<option value="${pad2(m)}">${pad2(m)}</option>`).join('');
        const startHourSel = `<select class="edit-start-hour">${hourOpts.replace('data-start-selected','selected')}</select>`;
        const endHourSel = `<select class="edit-end-hour">${hourOpts.replace('data-end-selected','selected')}</select>`;
        const startMinSel = `<select class="edit-start-min">${minOpts.replace(`value="${startMM}"`,`value="${startMM}" selected`)}</select>`;
        const endMinSel = `<select class="edit-end-min">${minOpts.replace(`value="${endMM}"`,`value="${endMM}" selected`)}</select>`;
        // Instructor select
        const instrOpts = Array.from(lookup.instructors, ([id,name])=>({id,name}))
          .sort((a,b)=>a.name.localeCompare(b.name))
          .map(o=>`<option value="${o.id}" ${o.id===r.instructor_id?'selected':''}>${o.name}</option>`).join('');
        const instrSel = `<select class="edit-instructor">${instrOpts}</select>`;
        // Locations multi-select
        const locOpts = Array.from(lookup.locations, ([id,name])=>({id,name}))
          .sort((a,b)=>a.name.localeCompare(b.name))
          .map(o=>`<option value="${o.id}" ${ (r.location_ids||[]).includes(o.id)?'selected':''}>${o.name}</option>`).join('');
        const locSel = `<select class="edit-locations" multiple>${locOpts}</select>`;
        return `<tr data-session-id="${r.id}" data-series-id="${r.series_id}" data-class-id="${r.class_id}" data-instructor-id="${r.instructor_id}">
          <td><input type="date" class="edit-date" value="${r.date}"></td>
          <td><span class="inline-input">${startHourSel}:${startMinSel}</span></td>
          <td><span class="inline-input">${endHourSel}:${endMinSel}</span></td>
          <td>${r.week_number}</td>
          <td>${dowLabel(r.day_of_week)}</td>
          <td>${className}</td>
          <td>${instrSel}</td>
          <td>${locSel}</td>
          <td>
            <button type="button" data-action="save-edit" data-session-id="${r.id}">Save</button>
            <button type="button" data-action="cancel-edit" data-session-id="${r.id}">Cancel</button>
          </td>
        </tr>`;
      }
    }),
    '</tbody></table>'
  ].join('');
  el.table.innerHTML = html;
  // attach sort listeners
  el.table.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (state.sort.col === col) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort.col = col; state.sort.dir = 'asc';
      }
      refreshTable();
    });
  });
}

async function getCurrentRows() {
  // Re-run the current query without changing pagination
  let q = sb.from('v_sessions').select('*');
  if (state.filters.class_id) q = q.eq('class_id', state.filters.class_id);
  if (state.filters.instructor_id) q = q.eq('instructor_id', state.filters.instructor_id);
  if (state.filters.location_id) q = q.contains('location_ids', [state.filters.location_id]);
  if (state.filters.from) q = q.gte('date', state.filters.from);
  if (state.filters.to) q = q.lte('date', state.filters.to);
  const serverSortable = new Set(['date','start_time','end_time','week_number','day_of_week']);
  if (serverSortable.has(state.sort.col)) {
    q = q.order(state.sort.col, { ascending: state.sort.dir === 'asc' });
    if (state.sort.col !== 'date') q = q.order('date', { ascending: true });
  } else {
    q = q.order('date', { ascending: true }).order('start_time', { ascending: true });
  }
  const { data, error } = await q.range(0, 49);
  if (error) { console.error(error); return [];
  }
  let rows = data || [];
  if (!serverSortable.has(state.sort.col)) {
    const dir = state.sort.dir === 'asc' ? 1 : -1;
    if (state.sort.col === 'class') rows.sort((a,b)=>((lookup.classes.get(a.class_id)||'').localeCompare(lookup.classes.get(b.class_id)||''))*dir);
    else if (state.sort.col === 'instructor') rows.sort((a,b)=>((lookup.instructors.get(a.instructor_id)||'').localeCompare(lookup.instructors.get(b.instructor_id)||''))*dir);
    else if (state.sort.col === 'locations') rows.sort((a,b)=>{
      const an=(a.location_ids||[]).map(id=>lookup.locations.get(id)||'').join(', ');
      const bn=(b.location_ids||[]).map(id=>lookup.locations.get(id)||'').join(', ');
      return an.localeCompare(bn)*dir;
    });
  }
  return rows;
}

function headerCell(col, label) {
  const active = state.sort.col === col;
  const arrow = active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '';
  return `<th class="sortable" data-sort="${col}">${label}<span class="sort-ind">${arrow}</span></th>`;
}

async function exportCSV() {
  try {
    // Fetch in batches to avoid Postgres row limits for huge exports
    let page = 0, pageSize = 1000;
    let all = [];
    while (true) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      let q = sb.from('v_sessions').select('*');
      if (state.filters.class_id) q = q.eq('class_id', state.filters.class_id);
      if (state.filters.instructor_id) q = q.eq('instructor_id', state.filters.instructor_id);
      if (state.filters.location_id) q = q.contains('location_ids', [state.filters.location_id]);
      if (state.filters.from) q = q.gte('date', state.filters.from);
      if (state.filters.to) q = q.lte('date', state.filters.to);
      q = q.order('date', { ascending: true }).order('start_time', { ascending: true }).range(from, to);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      all = all.concat(rows);
      if (rows.length < pageSize) break;
      page++;
    }
    const header = ['Date','Start','End','Week #','Day','Class','Instructor','Locations'];
    const lines = [header];
    for (const r of all) {
      const className = lookup.classes.get(r.class_id) || r.class_id;
      const instructorName = lookup.instructors.get(r.instructor_id) || r.instructor_id;
      const locNames = (r.location_ids || []).map(id => lookup.locations.get(id) || id).join(', ');
      lines.push([r.date, r.start_time, r.end_time, r.week_number, dowLabel(r.day_of_week), className, instructorName, locNames]);
    }
    const csv = lines.map(r => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sessions_export.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, 'error');
  }
}

function collectEditedRow(tr) {
  const id = tr.getAttribute('data-session-id');
  const date = tr.querySelector('.edit-date')?.value;
  const sh = tr.querySelector('.edit-start-hour')?.value;
  const sm = tr.querySelector('.edit-start-min')?.value;
  const eh = tr.querySelector('.edit-end-hour')?.value;
  const em = tr.querySelector('.edit-end-min')?.value;
  const instructor_id = tr.querySelector('.edit-instructor')?.value;
  const location_ids = Array.from(tr.querySelector('.edit-locations')?.selectedOptions || []).map(o=>o.value);
  const start_time = (sh && sm) ? `${sh}:${sm}` : '';
  const end_time = (eh && em) ? `${eh}:${em}` : '';
  return { id, date, start_time, end_time, instructor_id, location_ids };
}

async function saveEditSession(tr) {
  const row = collectEditedRow(tr);
  if (!row.date || !row.start_time || !row.end_time || !row.instructor_id) {
    toast('Fill all fields.', 'error');
    return;
  }
  if (row.end_time <= row.start_time) { toast('End time must be after start time.', 'error'); return; }
  try {
    const { error } = await sb.rpc('update_session_with_locations', {
      p_session_id: row.id,
      p_date: row.date,
      p_start_time: row.start_time,
      p_end_time: row.end_time,
      p_instructor_id: row.instructor_id,
      p_location_ids: row.location_ids,
    });
    if (error) throw error;
    state.editingId = null;
    toast('Updated.', 'success');
    await refreshTable();
  } catch (e) {
    console.error(e);
    if (isOverlapError(e)) toast('Error: There is a session booked in one of these classrooms during this time', 'error');
    else toast(`Update failed: ${e.message}`, 'error');
  }
}

async function onTableClick(ev) {
  const btn = ev.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const tr = btn.closest('tr');
  const sessionId = btn.getAttribute('data-session-id');
  const seriesId = btn.getAttribute('data-series-id');
  if (action === 'delete' && sessionId) {
    if (!confirm('Delete this session?')) return;
    try { await deleteSession(sessionId); toast('Deleted.', 'success'); await refreshTable(); } catch (e) { console.error(e); toast(`Delete failed: ${e.message}`, 'error'); }
  } else if (action === 'delete-series' && seriesId) {
    if (!confirm('Delete the entire series?')) return;
    try { await deleteSeries(seriesId); toast('Series deleted.', 'success'); await refreshTable(); } catch (e) { console.error(e); toast(`Delete failed: ${e.message}`, 'error'); }
  } else if (action === 'edit') {
    state.editingId = sessionId;
    await refreshTable();
  } else if (action === 'cancel-edit') {
    state.editingId = null;
    await refreshTable();
  } else if (action === 'save-edit') {
    await saveEditSession(tr);
  } else if (action === 'history' && seriesId) {
    await openHistory(seriesId);
  }
}

function updateMonthlyVisibility() {
  if (!el.monthlyWeekWrap) return;
  const rec = el.recurrence?.value;
  el.monthlyWeekWrap.style.display = rec === 'monthly' ? '' : 'none';
}

async function init() {
  try {
    if (!window.supabase) {
      toast('Supabase SDK not loaded. Check CSP or CDN.', 'error');
      console.error('Supabase SDK not available on window.');
      return;
    }
    sb = window.supabase.createClient(url, key);
    wireDom();
    initTimeSelects();
    startDomObserver();
    await loadLists(); // populates once data returns; observer will handle late DOM
    // If DOM already present, attempt initial render
    maybePopulateUI();
    attachListenersIfPresent();
    updateMonthlyVisibility();
    if (el.table) await refreshTable();
  } catch (e) {
    console.error(e);
    toast(`Init error: ${e.message}`, 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

async function openHistory(seriesId) {
  // Open immediately with a loading placeholder
  ensureHistoryElements();
  if (el.historyDrawer) {
    el.historyList.innerHTML = '<div class="history-item">Loading…</div>';
    el.historyDrawer.hidden = false;
    el.historyDrawer.removeAttribute('hidden');
    el.historyDrawer.style.display = 'block';
    el.historyDrawer.dataset.seriesId = seriesId;
    if (el.historyOverlay) el.historyOverlay.hidden = false;
  }
  try {
    const { data, error } = await sb
      .from('v_series_activity')
      .select('*')
      .eq('series_id', seriesId)
      .order('happened_at', { ascending: false });
    if (error) throw error;
    const rows = data || [];
    renderHistory(seriesId, rows);
  } catch (e) {
    console.error(e);
    renderHistory(seriesId, []);
    toast(`Failed to load history: ${e.message}`, 'error');
  }
}

function renderHistory(seriesId, rows) {
  if (!el.historyDrawer) return;
  const transformed = transformHistory(seriesId, rows);
  const items = transformed.map(r => `
    <div class="history-item">
      <div>${htmlEscape(r.summary)}</div>
      <time>${r.when || ''}</time>
    </div>
  `).join('');
  el.historyList.innerHTML = items || '<div class="history-item">No history.</div>';
  el.historyDrawer.hidden = false;
  el.historyDrawer.dataset.seriesId = seriesId;
  el.historyDrawer.dataset.lines = JSON.stringify(transformed);
}

function closeHistory() {
  if (el.historyDrawer) {
    el.historyDrawer.hidden = true;
    el.historyDrawer.style.display = 'none';
  }
  if (el.historyOverlay) el.historyOverlay.hidden = true;
}

async function exportHistoryCSV() {
  try {
    let csv = '';
    const mode = el.historyDrawer?.dataset.mode || 'series-history';
    if (mode === 'series-table') {
      const rows = JSON.parse(el.historyDrawer?.dataset.tableLines || '[]');
      const header = ['Class','Instructor','Locations','Recurrence','Start Time','End Time','Start Date','End Date'];
      const lines = [header];
      for (const r of rows) lines.push([r.className, r.instructorName, r.locNames, r.recurrenceText, r.startTime, r.endTime, r.startDate, r.endDate]);
      csv = lines.map(r => r.map(csvEscape).join(',')).join('\n');
    } else {
      const transformed = JSON.parse(el.historyDrawer?.dataset.lines || '[]');
      const lines = [['When','Summary']];
      for (const r of transformed) lines.push([r.when || '', r.summary]);
      csv = lines.map(r => r.map(csvEscape).join(',')).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `history_export.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    toast(`Export failed: ${e.message}`, 'error');
  }
}

function transformHistory(seriesId, rows) {
  const out = [];
  const byKind = { sessions: [], series: [] };
  for (const r of rows) {
    (byKind[r.kind] || (byKind[r.kind] = [])).push(r);
  }
  // First line: series creation with parameters
  const seriesCreate = (byKind.series || []).find(r => r.action === 'create');
  if (seriesCreate) {
    const md = seriesCreate.metadata || {};
    const days = (md.recurrence && md.recurrence.days) || [];
    const freq = (md.recurrence && md.recurrence.freq) || 'weekly';
    const dayNames = days.map(d => dowLabel(parseInt(d,10))).join(', ');
    // attempt to infer time range from any session create
    const anySessionCreate = (byKind.sessions || []).find(r => r.action === 'create');
    const start = anySessionCreate ? String(anySessionCreate.metadata?.start_time || '').slice(0,5) : '';
    const end = anySessionCreate ? String(anySessionCreate.metadata?.end_time || '').slice(0,5) : '';
    const className = lookup.classes.get(md.class_id) || 'Class';
    const range = md.start_date && md.end_date ? `${md.start_date} to ${md.end_date}` : '';
    const recurrenceText = freq === 'monthly' ? `Monthly (${md?.recurrence?.nth || '1st'} week on ${dayNames})` : `${freq === 'biweekly' ? 'Every 2 weeks' : 'Weekly'} on ${dayNames}`;
    out.push({ when: seriesCreate.happened_at, summary: `${className} ${range} — ${recurrenceText}` });
  }
  // List creates and deletes
  for (const r of (byKind.sessions || [])) {
    if (r.action === 'create') {
      const md = r.metadata || {};
      const start = String(md.start_time || '').slice(0,5);
      const end = String(md.end_time || '').slice(0,5);
      out.push({ when: r.happened_at, summary: `Session created for ${r.date} ${start}-${end}` });
    } else if (r.action === 'delete') {
      out.push({ when: r.happened_at, summary: `Session deleted for ${r.date}` });
    } else if (r.action === 'update') {
      out.push({ when: r.happened_at, summary: `Session updated for ${r.date}` });
    }
  }
  return out.sort((a,b) => String(b.when||'').localeCompare(String(a.when||'')));
}

async function openSeriesSummaries() {
  try {
    // Pull distinct series with basic metadata
    const { data, error } = await sb
      .from('class_series')
      .select('id,class_id,instructor_id,start_date,end_date,recurrence,days')
      .order('start_date', { ascending: true })
      .limit(5000);
    if (error) throw error;
    const rows = data || [];
    ensureHistoryElements();
    if (!el.historyDrawer) return;
    el.historyDrawer.hidden = false;
    el.historyDrawer.dataset.mode = 'series-table';
    const out = [];
    const header = ['Class','Instructor','Locations','Recurrence','Start Time','End Time','Start Date','End Date'];
    // We do not actually have per-series fixed times or locations here; leave blank unless inferred elsewhere.
    for (const r of rows) {
      const className = lookup.classes.get(r.class_id) || r.class_id;
      const instructorName = lookup.instructors.get(r.instructor_id) || r.instructor_id;
      const dayNames = (r.days||[]).map(d => dowLabel(parseInt(d,10))).join(', ');
      const recurrenceText = r.recurrence === 'monthly' ? `Monthly on ${dayNames}` : (r.recurrence === 'biweekly' ? `Every 2 weeks on ${dayNames}` : `Weekly on ${dayNames}`);
      out.push({
        className,
        instructorName,
        locNames: '',
        recurrenceText,
        startTime: '',
        endTime: '',
        startDate: r.start_date,
        endDate: r.end_date,
      });
    }
    el.historyDrawer.dataset.tableLines = JSON.stringify(out);
    const tableHtml = [
      '<table><thead><tr>',
      '<th>Class</th>','<th>Instructor</th>','<th>Locations</th>','<th>Recurrence</th>','<th>Start Time</th>','<th>End Time</th>','<th>Start Date</th>','<th>End Date</th>',
      '</tr></thead><tbody>',
      ...out.map(r => `<tr><td>${htmlEscape(r.className)}</td><td>${htmlEscape(r.instructorName)}</td><td>${htmlEscape(r.locNames)}</td><td>${htmlEscape(r.recurrenceText)}</td><td>${htmlEscape(r.startTime)}</td><td>${htmlEscape(r.endTime)}</td><td>${htmlEscape(r.startDate)}</td><td>${htmlEscape(r.endDate)}</td></tr>`),
      '</tbody></table>'
    ].join('');
    el.historyList.innerHTML = tableHtml;
    if (el.historyOverlay) el.historyOverlay.hidden = false;
  } catch (e) {
    console.error(e);
    toast(`Failed to load series summaries: ${e.message}`, 'error');
  }
}
