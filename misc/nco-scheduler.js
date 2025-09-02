// CSOD-friendly build: classic script (no ESM exports)
// Requirements on host page:
//  - Define window.SUPABASE_URL and window.SUPABASE_KEY before this script
//  - Load Supabase UMD: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//  - Include the HTML markup (see src/index.html body) before this script or place this script at bottom of the page

// Minimal client wiring and form handler (classic)
const url = window.SUPABASE_URL;
const key = window.SUPABASE_KEY;
if (!url || !key) {
  console.warn("Missing SUPABASE_URL or SUPABASE_KEY. Define them before loading nco-scheduler.umd.js.");
}
const sb = window.supabase && url && key ? window.supabase.createClient(url, key) : null;
if (!sb) {
  console.warn('Supabase client not initialized. Ensure supabase-js UMD is loaded and config is set.');
}

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

const el = {
  classSelect: document.getElementById('classSelect'),
  instructorSelect: document.getElementById('instructorSelect'),
  addInstructorBtn: document.getElementById('addInstructorBtn'),
  locationSelect: document.getElementById('locationSelect'),
  addSingleBtn: document.getElementById('addSingleBtn'),
  singleDate: document.getElementById('singleDate'),
  singleStartHour: document.getElementById('singleStartHour'),
  singleStartMin: document.getElementById('singleStartMin'),
  singleEndHour: document.getElementById('singleEndHour'),
  singleEndMin: document.getElementById('singleEndMin'),
  startHour: document.getElementById('startHour'),
  startMin: document.getElementById('startMin'),
  endHour: document.getElementById('endHour'),
  endMin: document.getElementById('endMin'),
  startDate: document.getElementById('startDate'),
  endDate: document.getElementById('endDate'),
  recurrence: document.getElementById('recurrence'),
  monthlyWeek: document.getElementById('monthlyWeek'),
  monthlyWeekWrap: document.getElementById('monthlyWeekWrap'),
  form: document.getElementById('schedule-form'),
  toast: document.getElementById('toast'),
  table: document.getElementById('table'),
  // filters UI (separate area)
  filterClass: document.getElementById('filterClass'),
  filterInstructor: document.getElementById('filterInstructor'),
  filterLocation: document.getElementById('filterLocation'),
  filterFrom: document.getElementById('filterFrom'),
  filterTo: document.getElementById('filterTo'),
  clearFilters: document.getElementById('clearFilters'),
  exportCsvBtn: document.getElementById('exportCsv'),
  viewSeriesSummaries: document.getElementById('viewSeriesSummaries'),
};

function ensureHistoryElements() {
  const existing = document.getElementById('historyDrawer');
  if (existing && (!el.historyDrawer || !document.body.contains(el.historyDrawer))) {
    el.historyDrawer = existing;
    el.historyList = existing.querySelector('#historyList');
    el.historyClose = existing.querySelector('#historyClose');
    el.historyExport = existing.querySelector('#historyExport');
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
    <div class="drawer-content">
      <div class="drawer-header">
        <h3>Series History</h3>
        <button type="button" id="historyClose" aria-label="Close">×</button>
      </div>
      <div id="historyList" class="history-list"></div>
      <div class="actions">
        <button type="button" id="historyExport">Export History CSV</button>
      </div>
    </div>`;
  document.body.appendChild(wrapper);
  el.historyDrawer = wrapper;
  el.historyOverlay = overlay;
  el.historyList = wrapper.querySelector('#historyList');
  el.historyClose = wrapper.querySelector('#historyClose');
  el.historyExport = wrapper.querySelector('#historyExport');
  el.historyClose?.addEventListener('click', () => closeHistory());
  el.historyExport?.addEventListener('click', () => exportHistoryCSV());
  overlay.addEventListener('click', () => closeHistory());
}

function toast(msg, type = 'info') {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.className = `toast ${type}`;
  if (type === 'error') el.toast.style.color = 'var(--err)';
  else if (type === 'success') el.toast.style.color = 'var(--ok)';
  else el.toast.style.color = 'var(--muted)';
}

async function loadLists() {
  if (!sb) return;
  const [classes, instructors, locations] = await Promise.all([
    sb.from('classes').select('id,name').eq('status','active').order('name'),
    sb.from('instructors').select('id,name').eq('status','active').order('name'),
    sb.from('locations').select('id,name').eq('status','active').order('name'),
  ]);
  for (const { error } of [classes, instructors, locations]) { if (error) throw error; }
  lookup.classes = new Map((classes.data || []).map(r => [r.id, r.name]));
  lookup.instructors = new Map((instructors.data || []).map(r => [r.id, r.name]));
  lookup.locations = new Map((locations.data || []).map(r => [r.id, r.name]));
  populateSelect(el.classSelect, classes.data || []);
  populateSelect(el.instructorSelect, instructors.data || []);
  populateSelect(el.locationSelect, locations.data || [], true);
  populateSelectWithAll(el.filterClass, classes.data || []);
  populateSelectWithAll(el.filterInstructor, instructors.data || []);
  populateSelectWithAll(el.filterLocation, locations.data || []);
}

async function loadInstructors(selectIdToKeep = null) {
  if (!sb) return;
  const { data, error } = await sb
    .from('instructors')
    .select('id,name')
    .eq('status','active')
    .order('name');
  if (error) throw error;
  lookup.instructors = new Map((data || []).map(r => [r.id, r.name]));
  populateSelect(el.instructorSelect, data || []);
  if (selectIdToKeep && el.instructorSelect) el.instructorSelect.value = selectIdToKeep;
}

function populateSelect(select, rows) {
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
  while (d <= end) { yield new Date(d.getTime()); d.setDate(d.getDate() + 1); }
}

function isoDow(jsDate) { const d = jsDate.getDay(); return d === 0 ? 7 : d; }
function toYMD(jsDate) { const y = jsDate.getFullYear(); const m = String(jsDate.getMonth()+1).padStart(2,'0'); const d = String(jsDate.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
function parseYMDLocal(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d); }
function isOverlapError(e) { const msg = (e && (e.message || e.toString())) || ''; const code = e && e.code; return (code === '23P01' || /session_locations_no_overlap/i.test(msg) || /exclusion constraint/i.test(msg)); }
function pad2(n) { return String(n).padStart(2,'0'); }
function dowLabel(n) { return ['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][n] || String(n); }
function getTimeFromSelect(hourEl, minEl) { const h = hourEl?.value; const m = minEl?.value; if (!h || !m) return ''; return `${pad2(h)}:${pad2(m)}`; }

function populateHourSelect(sel) { if (!sel) return; sel.innerHTML = '<option value="">HH</option>'; for (let h=0; h<24; h++) { const opt = document.createElement('option'); opt.value = pad2(h); opt.textContent = pad2(h); sel.appendChild(opt);} }
function populateMinuteSelect(sel) { if (!sel) return; sel.innerHTML = '<option value="">MM</option>'; for (const m of [0,15,30,45]) { const opt = document.createElement('option'); opt.value = pad2(m); opt.textContent = pad2(m); sel.appendChild(opt);} }

function generateOccurrences(startDateStr, endDateStr, days, recurrence, monthlyWeek = 1) {
  const start = parseYMDLocal(startDateStr);
  const end = parseYMDLocal(endDateStr);
  const min2026 = parseYMDLocal('2026-01-01');
  const max2026 = parseYMDLocal('2026-12-31');
  if (start < min2026 || end > max2026) { throw new Error('Dates must be within 2026.'); }
  const stepWeeks = recurrence === 'biweekly' ? 2 : 1;
  const out = [];
  if (recurrence === 'monthly') {
    const sY = start.getFullYear(); const sM = start.getMonth();
    const eY = end.getFullYear();   const eM = end.getMonth();
    let y = sY, m = sM;
    while (y < eY || (y === eY && m <= eM)) {
      for (const dow of days) {
        const d = nthWeekdayOfMonth(y, m, dow, monthlyWeek);
        if (d && d >= start && d <= end) out.push(toYMD(d));
      }
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
  } else {
    for (const d of dateRange(start, end)) {
      const dow = isoDow(d);
      if (!days.includes(dow)) continue;
      if (stepWeeks === 2) {
        const diffDays = Math.floor((d - start) / 86400000);
        if (Math.floor(diffDays / 7) % 2 !== 0) continue;
      }
      out.push(toYMD(d));
    }
  }
  return out;
}

function nthWeekdayOfMonth(year, monthIdx0, isoWeekday, n) {
  const first = new Date(Date.UTC(year, monthIdx0, 1));
  const firstIso = first.getUTCDay() === 0 ? 7 : first.getUTCDay();
  let day = 1 + ((isoWeekday - firstIso + 7) % 7) + 7 * (n - 1);
  const d = new Date(Date.UTC(year, monthIdx0, day));
  if (d.getUTCMonth() !== monthIdx0) return null;
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function createSeries(class_id, instructor_id, start_date, end_date, recurrence, days) {
  if (!sb) throw new Error('Supabase client not ready');
  const recurrenceJson = { freq: recurrence, days };
  const { data, error } = await sb
    .from('series')
    .insert({ class_id, instructor_id, start_date, end_date, recurrence: recurrenceJson })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function insertSessionRPC(series_id, class_id, instructor_id, dateStr, startTimeStr, endTimeStr, locationIds) {
  if (!sb) throw new Error('Supabase client not ready');
  const { data, error } = await sb.rpc('insert_session_with_locations', {
    p_series_id: series_id,
    p_class_id: class_id,
    p_instructor_id: instructor_id,
    p_date: dateStr,
    p_start: startTimeStr,
    p_end: endTimeStr,
    p_location_ids: locationIds,
  });
  if (error) throw error;
  return data;
}

async function deleteSession(sessionId) {
  if (!sb) throw new Error('Supabase client not ready');
  const { error } = await sb.from('sessions').delete().eq('id', sessionId);
  if (error) throw error;
}

async function deleteSeries(seriesId) {
  if (!sb) throw new Error('Supabase client not ready');
  let resp = await sb.from('sessions').delete().eq('series_id', seriesId);
  if (resp.error) throw resp.error;
  resp = await sb.from('series').delete().eq('id', seriesId);
  if (resp.error) throw resp.error;
}

async function onAddSingle() {
  try {
    const class_id = el.classSelect?.value;
    const instructor_id = el.instructorSelect?.value;
    const dateStr = el.singleDate?.value;
    const startTimeStr = getTimeFromSelect(el.singleStartHour, el.singleStartMin);
    const endTimeStr = getTimeFromSelect(el.singleEndHour, el.singleEndMin);
    const locationIds = Array.from(el.locationSelect?.selectedOptions || []).map(o => o.value);
    if (!class_id || !instructor_id || !dateStr || !startTimeStr || !endTimeStr || !locationIds.length) { toast('Fill all fields and select locations.', 'error'); return; }
    if (parseYMDLocal(dateStr) < parseYMDLocal('2026-01-01') || parseYMDLocal(dateStr) > parseYMDLocal('2026-12-31')) { toast('Date must be within 2026.', 'error'); return; }
    if (endTimeStr <= startTimeStr) { toast('End time must be after start time.', 'error'); return; }
    const series_id = await createSeries(class_id, instructor_id, dateStr, dateStr, 'weekly', [isoDow(parseYMDLocal(dateStr))]);
    await insertSessionRPC(series_id, class_id, instructor_id, dateStr, startTimeStr, endTimeStr, locationIds);
    toast('Class added.', 'success');
    await refreshTable();
  } catch (e) {
    console.error(e);
    if (isOverlapError(e)) toast('Error: There is a session booked in one of these classrooms during this time', 'error');
    else toast(`Add failed: ${e.message}`, 'error');
  }
}

async function onAddSeries(ev) {
  ev?.preventDefault?.();
  try {
    const class_id = el.classSelect?.value;
    const instructor_id = el.instructorSelect?.value;
    const start_date = el.startDate?.value;
    const end_date = el.endDate?.value;
    const startTimeStr = getTimeFromSelect(el.startHour, el.startMin);
    const endTimeStr = getTimeFromSelect(el.endHour, el.endMin);
    const locationIds = Array.from(el.locationSelect?.selectedOptions || []).map(o => o.value);
    const recurrence = el.recurrence?.value || 'weekly';
    const monthlyWeek = parseInt(el.monthlyWeek?.value || '1', 10);
    const days = parseSelectedDays();
    if (!class_id || !instructor_id || !start_date || !end_date || !startTimeStr || !endTimeStr || !days.length || !locationIds.length) { toast('Fill all fields and select at least one day and location.', 'error'); return; }
    if (parseYMDLocal(start_date) < parseYMDLocal('2026-01-01') || parseYMDLocal(end_date) > parseYMDLocal('2026-12-31')) { toast('Dates must be within 2026.', 'error'); return; }
    if (endTimeStr <= startTimeStr) { toast('End time must be after start time.', 'error'); return; }

    const series_id = await createSeries(class_id, instructor_id, start_date, end_date, recurrence, days);
    const dates = generateOccurrences(start_date, end_date, days, recurrence, monthlyWeek);
    for (const d of dates) {
      try {
        await insertSessionRPC(series_id, class_id, instructor_id, d, startTimeStr, endTimeStr, locationIds);
      } catch (e) {
        if (isOverlapError(e)) { toast(`Overlap on ${d}. Skipping.`, 'error'); } else { throw e; }
      }
    }
    toast('Series added.', 'success');
    await refreshTable();
  } catch (e) {
    console.error(e);
    if (isOverlapError(e)) toast('Error: There is a session booked in one of these classrooms during this time', 'error');
    else toast(`Add failed: ${e.message}`, 'error');
  }
}

function initTimeSelects() { [el.startHour, el.endHour, el.singleStartHour, el.singleEndHour].forEach(populateHourSelect); [el.startMin, el.endMin, el.singleStartMin, el.singleEndMin].forEach(populateMinuteSelect); }

async function refreshTable(page = 0, pageSize = 50) {
  if (!sb || !el.table) return;
  const from = page * pageSize;
  const to = from + pageSize - 1;
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
  q = q.range(from, to);
  const { data, error } = await q;
  if (error) { console.error(error); return; }
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
  renderTable(rows);
}

function headerCell(col, label) {
  const active = state.sort.col === col;
  const arrow = active ? (state.sort.dir === 'asc' ? '▲' : '▼') : '';
  return `<th class="sortable" data-sort="${col}">${label}<span class="sort-ind">${arrow}</span></th>`;
}

function renderTable(rows) {
  if (!el.table) return;
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
        const instrOpts = Array.from(lookup.instructors, ([id,name])=>({id,name}))
          .sort((a,b)=>a.name.localeCompare(b.name))
          .map(o=>`<option value="${o.id}" ${o.id===r.instructor_id?'selected':''}>${o.name}</option>`).join('');
        const instrSel = `<select class="edit-instructor">${instrOpts}</select>`;
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
  el.table.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (state.sort.col === col) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort.col = col; state.sort.dir = 'asc'; }
      refreshTable();
    });
  });
}

async function getCurrentRows() {
  if (!sb) return [];
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
  if (error) { console.error(error); return []; }
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

async function saveEditSession(tr) {
  try {
    const sessionId = tr?.getAttribute('data-session-id');
    const date = tr?.querySelector('.edit-date')?.value;
    const sh = tr?.querySelector('.edit-start-hour')?.value;
    const sm = tr?.querySelector('.edit-start-min')?.value;
    const eh = tr?.querySelector('.edit-end-hour')?.value;
    const em = tr?.querySelector('.edit-end-min')?.value;
    const start = `${sh}:${sm}`;
    const end = `${eh}:${em}`;
    const locSel = tr?.querySelector('.edit-locations');
    const locIds = Array.from(locSel?.selectedOptions || []).map(o=>o.value);
    if (!locIds.length) { toast('Select at least one location.', 'error'); return; }
    if (!date || !sh || !sm || !eh || !em) { toast('Provide date and times.', 'error'); return; }
    if (parseYMDLocal(date) < parseYMDLocal('2026-01-01') || parseYMDLocal(date) > parseYMDLocal('2026-12-31')) { toast('Date must be within 2026.', 'error'); return; }
    if (end <= start) { toast('End time must be after start time.', 'error'); return; }
    const { data: _d, error: rpcError } = await sb.rpc('update_session_with_locations', {
      p_session_id: sessionId,
      p_date: date,
      p_start: start,
      p_end: end,
      p_location_ids: locIds,
    });
    if (rpcError) {
      if (isOverlapError(rpcError)) toast('Error: There is a session booked in one of these classrooms during this time', 'error');
      else toast(`Save failed: ${rpcError.message}`, 'error');
      return;
    }
    state.editingId = null;
    toast('Session updated.', 'success');
    await refreshTable();
  } catch (e) {
    console.error(e);
    if (isOverlapError(e)) toast('Error: There is a session booked in one of these classrooms during this time', 'error');
    else toast(`Save failed: ${e.message}`, 'error');
  }
}

async function exportCSV() {
  try {
    const batch = 1000; let offset = 0; let all = [];
    while (true) {
      let q = sb.from('v_sessions').select('*');
      if (state.filters.class_id) q = q.eq('class_id', state.filters.class_id);
      if (state.filters.instructor_id) q = q.eq('instructor_id', state.filters.instructor_id);
      if (state.filters.location_id) q = q.contains('location_ids', [state.filters.location_id]);
      if (state.filters.from) q = q.gte('date', state.filters.from);
      if (state.filters.to) q = q.lte('date', state.filters.to);
      const serverSortable = new Set(['date','start_time','end_time']);
      if (serverSortable.has(state.sort.col)) {
        q = q.order(state.sort.col, { ascending: state.sort.dir === 'asc' });
        if (state.sort.col !== 'date') q = q.order('date', { ascending: true });
      } else {
        q = q.order('date', { ascending: true }).order('start_time', { ascending: true });
      }
      q = q.range(offset, offset + batch - 1);
      const { data, error } = await q;
      if (error) throw error;
      const rows = data || [];
      all = all.concat(rows);
      if (rows.length < batch) break;
      offset += batch;
      if (offset >= 50000) break;
    }
    const serverSortable = new Set(['date','start_time','end_time']);
    if (!serverSortable.has(state.sort.col)) {
      const dir = state.sort.dir === 'asc' ? 1 : -1;
      if (state.sort.col === 'class') all.sort((a,b)=>((lookup.classes.get(a.class_id)||'').localeCompare(lookup.classes.get(b.class_id)||''))*dir);
      else if (state.sort.col === 'instructor') all.sort((a,b)=>((lookup.instructors.get(a.instructor_id)||'').localeCompare(lookup.instructors.get(b.instructor_id)||''))*dir);
    }
    const header = ['Date','Start','End','Class','Instructor','Locations'];
    const lines = [header.map(csvEscape).join(',')];
    for (const r of all) {
      const className = lookup.classes.get(r.class_id) || r.class_id;
      const instructorName = lookup.instructors.get(r.instructor_id) || r.instructor_id;
      const locNames = (r.location_ids || []).map(id => lookup.locations.get(id) || id).join('; ');
      const start = String(r.start_time).slice(0,5);
      const end = String(r.end_time).slice(0,5);
      lines.push([r.date, start, end, className, instructorName, locNames].map(csvEscape).join(','));
    }
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sessions_export.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { console.error(e); toast(`Export failed: ${e.message}`, 'error'); }
}

function csvEscape(s) { s = String(s ?? ''); if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"'; return s; }
function htmlEscape(s) { const t = document.createElement('textarea'); t.textContent = String(s ?? ''); return t.innerHTML; }

async function openHistory(seriesId) {
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
  if (el.historyDrawer) { el.historyDrawer.hidden = true; el.historyDrawer.style.display = 'none'; }
  if (el.historyOverlay) el.historyOverlay.hidden = true;
}

async function exportHistoryCSV() {
  try {
    let csv;
    const mode = el.historyDrawer?.dataset.mode || '';
    if (mode === 'series-table') {
      const rows = JSON.parse(el.historyDrawer?.dataset.tableLines || '[]');
      const header = ['Class','Instructor','Locations','Recurrence','Start Time','End Time','Start Date','End Date'];
      const lines = [header];
      for (const r of rows) lines.push([r.className,r.instructorName,r.locNames,r.recurrenceText,r.startTime,r.endTime,r.startDate,r.endDate]);
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
    a.href = url; a.download = 'history_export.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (e) { console.error(e); toast(`Export failed: ${e.message}`, 'error'); }
}

function transformHistory(seriesId, rows) {
  const out = [];
  const byKind = { sessions: [], series: [] };
  for (const r of rows) { (byKind[r.kind] || (byKind[r.kind] = [])).push(r); }
  const seriesCreate = (byKind.series || []).find(r => r.action === 'create');
  if (seriesCreate) {
    const md = seriesCreate.metadata || {};
    const days = (md.recurrence && md.recurrence.days) || [];
    const freq = (md.recurrence && md.recurrence.freq) || 'weekly';
    const dayNames = days.map(d => dowLabel(parseInt(d,10))).join(', ');
    const anySessionCreate = (byKind.sessions || []).find(r => r.action === 'create');
    const start = anySessionCreate ? String(anySessionCreate.metadata?.start_time || '').slice(0,5) : '';
    const end = anySessionCreate ? String(anySessionCreate.metadata?.end_time || '').slice(0,5) : '';
    const className = lookup.classes.get(md.class_id) || 'Class';
    const range = md.start_date && md.end_date ? `${md.start_date} to ${md.end_date}` : '';
    const freqText = freq === 'biweekly' ? 'every 2 weeks' : (freq === 'monthly' ? 'monthly' : 'weekly');
    const daysText = dayNames ? ` on ${dayNames}` : '';
    out.push({ when: seriesCreate.happened_at, summary: `${className} recurs ${freqText}${daysText} from ${range}${start && end ? ` at ${start}–${end}` : ''}`.trim() });
  }
  const changes = (byKind.sessions || []).filter(r => r.action !== 'create').sort((a,b) => new Date(a.happened_at) - new Date(b.happened_at));
  for (const r of changes) {
    if (r.action === 'delete') {
      const d = r.metadata?.date || '';
      out.push({ when: r.happened_at, summary: `${d} class deleted` });
    } else if (r.action === 'update') {
      const from = r.metadata?.from || {}; const to = r.metadata?.to || {};
      const dFrom = from.date || ''; const dTo = to.date || '';
      const tFrom = `${String(from.start_time||'').slice(0,5)}–${String(from.end_time||'').slice(0,5)}`;
      const tTo = `${String(to.start_time||'').slice(0,5)}–${String(to.end_time||'').slice(0,5)}`;
      if (dFrom && dTo && dFrom !== dTo) {
        out.push({ when: r.happened_at, summary: tFrom !== tTo ? `${dFrom} rescheduled to ${dTo} and time changed to ${tTo}` : `${dFrom} rescheduled to ${dTo}` });
      } else if (tFrom !== tTo && dFrom) {
        out.push({ when: r.happened_at, summary: `${dFrom} time changed from ${tFrom} to ${tTo}` });
      }
    }
  }
  const locLogs = (byKind.session_locations || []).sort((a,b)=> new Date(a.happened_at) - new Date(b.happened_at));
  for (const r of locLogs) {
    const d = r.metadata?.date || '';
    const locId = r.metadata?.location_id;
    const locName = lookup.locations.get(locId) || 'location';
    if (r.action === 'create') out.push({ when: r.happened_at, summary: `${d} location added: ${locName}` });
    else if (r.action === 'delete') out.push({ when: r.happened_at, summary: `${d} location removed: ${locName}` });
  }
  const seriesUpdates = (byKind.series || []).filter(r => r.action === 'update');
  for (const r of seriesUpdates) {
    const from = r.metadata?.from || {}; const to = r.metadata?.to || {};
    if (from.instructor_id && to.instructor_id && from.instructor_id !== to.instructor_id) {
      const name = lookup.instructors.get(to.instructor_id) || 'instructor';
      out.push({ when: r.happened_at, summary: `Instructor changed to ${name}` });
    }
    if (from.class_id && to.class_id && from.class_id !== to.class_id) {
      const name = lookup.classes.get(to.class_id) || 'class';
      out.push({ when: r.happened_at, summary: `Class changed to ${name}` });
    }
  }
  return out;
}

function updateMonthlyVisibility() { if (!el.monthlyWeekWrap) return; const rec = el.recurrence?.value; el.monthlyWeekWrap.style.display = rec === 'monthly' ? '' : 'none'; }

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
    state.editingId = sessionId; await refreshTable();
  } else if (action === 'cancel-edit') {
    state.editingId = null; await refreshTable();
  } else if (action === 'save-edit') {
    await saveEditSession(tr);
  } else if (action === 'history' && seriesId) {
    await openHistory(seriesId);
  }
}

(function initWhenReady() {
  const bootstrap = async () => {
    try {
      initTimeSelects();
      await loadLists();
      await refreshTable();
      el.addInstructorBtn?.addEventListener('click', addInstructorFlow);
      el.addSingleBtn?.addEventListener('click', onAddSingle);
      el.form?.addEventListener('submit', onAddSeries);
      el.table?.addEventListener('click', onTableClick);
      el.recurrence?.addEventListener('change', updateMonthlyVisibility);
      updateMonthlyVisibility();
      el.filterClass?.addEventListener('change', () => { state.filters.class_id = el.filterClass.value || ''; refreshTable(); });
      el.filterInstructor?.addEventListener('change', () => { state.filters.instructor_id = el.filterInstructor.value || ''; refreshTable(); });
      el.filterLocation?.addEventListener('change', () => { state.filters.location_id = el.filterLocation.value || ''; refreshTable(); });
      el.filterFrom?.addEventListener('change', () => { state.filters.from = el.filterFrom.value || ''; refreshTable(); });
      el.filterTo?.addEventListener('change', () => { state.filters.to = el.filterTo.value || ''; refreshTable(); });
      el.clearFilters?.addEventListener('click', () => {
        state.filters = { class_id: '', instructor_id: '', location_id: '', from: '', to: '' };
        if (el.filterClass) el.filterClass.value = '';
        if (el.filterInstructor) el.filterInstructor.value = '';
        if (el.filterLocation) el.filterLocation.value = '';
        if (el.filterFrom) el.filterFrom.value = '';
        if (el.filterTo) el.filterTo.value = '';
        refreshTable();
      });
      el.exportCsvBtn?.addEventListener('click', exportCSV);
      el.historyClose?.addEventListener('click', () => closeHistory());
      el.historyExport?.addEventListener('click', () => exportHistoryCSV());
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeHistory(); });
      el.viewSeriesSummaries?.addEventListener('click', () => openSeriesSummaries());
    } catch (e) {
      console.error(e);
      toast(`Init error: ${e.message}`, 'error');
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
  else bootstrap();
})();

// Minimal add-instructor flow used by both app builds
async function addInstructorFlow() {
  const name = prompt('Instructor name');
  if (!name) return;
  const { data, error } = await sb.from('instructors').insert({ name, status: 'active' }).select('id').single();
  if (error) { console.error(error); toast(`Failed to add instructor: ${error.message}`, 'error'); return; }
  await loadInstructors(data.id);
  toast('Instructor added.', 'success');
}

// Show a slideout table summarizing scheduled series respecting current filters
async function openSeriesSummaries() {
  try {
    ensureHistoryElements();
    if (!sb) { toast('Not connected.', 'error'); return; }

    // Fetch all sessions matching current filters (batch to be safe)
    const all = [];
    const batch = 1000; let offset = 0;
    while (true) {
      let q = sb.from('v_sessions').select('series_id,class_id,instructor_id,date,start_time,end_time,location_ids');
      if (state.filters.class_id) q = q.eq('class_id', state.filters.class_id);
      if (state.filters.instructor_id) q = q.eq('instructor_id', state.filters.instructor_id);
      if (state.filters.location_id) q = q.contains('location_ids', [state.filters.location_id]);
      if (state.filters.from) q = q.gte('date', state.filters.from);
      if (state.filters.to) q = q.lte('date', state.filters.to);
      const { data, error } = await q.order('date', { ascending: true }).range(offset, offset + batch - 1);
      if (error) throw error;
      const rows = data || [];
      all.push(...rows);
      if (rows.length < batch) break;
      offset += batch;
      if (offset >= 50000) break;
    }

    // Group by series_id
    const bySeries = new Map();
    for (const r of all) {
      if (!r.series_id) continue;
      let g = bySeries.get(r.series_id);
      if (!g) { g = []; bySeries.set(r.series_id, g); }
      g.push(r);
    }
    if (bySeries.size === 0) {
      if (el.historyList) el.historyList.innerHTML = '<div class="history-item">No scheduled series match the current filters.</div>';
      if (el.historyDrawer) {
        el.historyDrawer.dataset.mode = 'series-table';
        el.historyDrawer.dataset.tableLines = '[]';
        el.historyDrawer.hidden = false;
        el.historyDrawer.style.display = 'block';
      }
      if (el.historyOverlay) el.historyOverlay.hidden = false;
      return;
    }

    // Fetch recurrence and bounds from series table for the involved series ids
    const seriesIds = Array.from(bySeries.keys());
    const { data: seriesRows, error: seriesErr } = await sb
      .from('series')
      .select('id, class_id, instructor_id, start_date, end_date, recurrence')
      .in('id', seriesIds);
    if (seriesErr) throw seriesErr;
    const seriesMap = new Map((seriesRows || []).map(r => [r.id, r]));

    // Build summary rows
    const lines = [];
    for (const [sid, sess] of bySeries.entries()) {
      const sr = seriesMap.get(sid) || {};
      // Sort sessions by date to pick representative times/locations
      sess.sort((a,b) => String(a.date).localeCompare(String(b.date)));
      const first = sess[0];
      const className = lookup.classes.get(first?.class_id || sr.class_id) || (first?.class_id || sr.class_id || '');
      const instructorName = lookup.instructors.get(first?.instructor_id || sr.instructor_id) || (first?.instructor_id || sr.instructor_id || '');
      const locNames = (first?.location_ids || []).map(id => lookup.locations.get(id) || id).join('; ');
      const startTime = String(first?.start_time || '').slice(0,5) || '';
      const endTime = String(first?.end_time || '').slice(0,5) || '';
      const startDate = sr.start_date || (sess[0]?.date || '');
      const endDate = sr.end_date || (sess[sess.length - 1]?.date || '');
      // Recurrence text from series.recurrence JSON
      let recurrenceText = '';
      try {
        const rec = sr.recurrence || {};
        const freq = rec.freq || 'weekly';
        const days = (rec.days || []).map(d => dowLabel(parseInt(d,10))).join(', ');
        recurrenceText = (freq === 'biweekly' ? 'every 2 weeks' : (freq === 'monthly' ? 'monthly' : 'weekly')) + (days ? ` on ${days}` : '');
      } catch (_) {}
      lines.push({ seriesId: sid, className, instructorName, locNames, recurrenceText, startTime, endTime, startDate, endDate });
    }

    // Render table into drawer
    const tableHtml = [
      '<table><thead><tr>',
      '<th>Class</th><th>Instructor</th><th>Locations</th><th>Recurrence</th><th>Start Time</th><th>End Time</th><th>Start Date</th><th>End Date</th>',
      '</tr></thead><tbody>',
      ...lines.map(r => `<tr>
        <td>${htmlEscape(r.className)}</td>
        <td>${htmlEscape(r.instructorName)}</td>
        <td>${htmlEscape(r.locNames)}</td>
        <td>${htmlEscape(r.recurrenceText)}</td>
        <td>${htmlEscape(r.startTime)}</td>
        <td>${htmlEscape(r.endTime)}</td>
        <td>${htmlEscape(r.startDate)}</td>
        <td>${htmlEscape(r.endDate)}</td>
      </tr>`),
      '</tbody></table>'
    ].join('');

    if (el.historyList) el.historyList.innerHTML = tableHtml;
    if (el.historyDrawer) {
      el.historyDrawer.dataset.mode = 'series-table';
      el.historyDrawer.dataset.tableLines = JSON.stringify(lines);
      el.historyDrawer.hidden = false;
      el.historyDrawer.removeAttribute('hidden');
      el.historyDrawer.style.display = 'block';
    }
    if (el.historyOverlay) el.historyOverlay.hidden = false;
  } catch (e) {
    console.error(e);
    toast(`Failed to load series summaries: ${e.message}`, 'error');
  }
}
