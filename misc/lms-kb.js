/*
  LMS Knowledge Base – Prototype JS
  - Loads articles from CSV (sample-kb.csv or user import)
  - Provides search, filter, sort, detail view
  - Allows create/edit/delete in memory and CSV export
  CSV field conventions:
    - Multi-value fields use pipe '|' separator (reserved; not used now)
    - Lists (RelatedArticles, Attachments) use comma-separated values
    - Dates use ISO (YYYY-MM-DD or ISO timestamp)
*/
(function () {
  // Config: Flow endpoints can be provided via HTML meta tags or globals
  function readConfig(name, fallback) {
    const m = document.querySelector(`meta[name="${name}"]`);
    if (m && m.content) return m.content;
    if (window.KB_CONFIG && window.KB_CONFIG[name]) return window.KB_CONFIG[name];
    return fallback;
  }
  const FLOW_GET_URL = readConfig('KB_FLOW_GET_URL', '/api/flow');
  const FLOW_SAVE_URL = readConfig('KB_FLOW_SAVE_URL', '/api/save');
  const SHARE_BASE_URL = readConfig('KB_SHARE_BASE_URL', location.origin + location.pathname + location.search);
  const DEBUG_FLOW = true;
  const FIELDS = [
    'ArticleID','Title','Summary','Description','Type','Tags','RelatedArticles','Attachments','AttachmentLinks','Author','LastEditor','CreatedDate','UpdatedDate','ResolvedDate','Workaround','Status','Visibility','VersionNumber','ReviewDate','Audience'
  ];
  const TYPES = ['Bug','Limitation','Advisory','Guide'];

  // Internal users allowlist (First Last). Parsed to normalized keys.
  const INTERNAL_USER_LIST = [
    'Alex Richardson',
    'Michelle Doherty',
    'Jacob Bezug',
    'Jayda Hallman',
    'Victoria Hinman',
    'John Nelson',
    'Robert Hoogwerf'
  ];
  function normalizePart(s) { return String(s||'').trim().toLowerCase(); }
  function nameKey(first, last) { return normalizePart(first) + ':' + normalizePart(last); }
  function parseFullName(full) {
    const t = String(full||'').trim().replace(/\s+/g, ' ');
    if (!t) return { first: '', last: '' };
    const parts = t.split(' ');
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts[parts.length - 1] };
  }
  const INTERNAL_USERS = new Set(INTERNAL_USER_LIST.map(full => {
    const { first, last } = parseFullName(full);
    return nameKey(first, last);
  }));
  function isInternalUser(first, last) { return INTERNAL_USERS.has(nameKey(first, last)); }

  // State
  const state = {
    articles: [],
    filtered: [],
    selectedId: null,
    // categories removed
    types: new Set(),
    authors: new Set(),
    sortBy: 'UpdatedDate',
    sortDir: 'desc',
    pendingUrlId: null,
    mode: 'list', // 'list' | 'single'
    publicMode: false,
    submitHandler: null,
  };

  // DOM
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const el = {
    error: $('#error'),
    rows: $('#rows'),
    count: $('#count'),
    search: $('#search'),
    // categoryFilter removed
    statusFilter: $('#statusFilter'),
    typeFilter: $('#typeFilter'),
    visibilityFilter: $('#visibilityFilter'),
    authorFilter: $('#authorFilter'),
    // sort controls now handled via header clicks
    importBtn: $('#importBtn'),
    csvFile: $('#csvFile'),
    exportBtn: $('#exportBtn'),
    newBtn: $('#newBtn'),
    editBtn: $('#editBtn'),
    copyBtn: $('#copyBtn'),
    details: $('#details'),
    detailsTitle: document.querySelector('#detailsTitle'),
    modal: $('#modal'),
    formTitle: $('#formTitle'),
    formMeta: document.querySelector('#formMeta'),
    closeModal: $('#closeModal'),
    form: $('#articleForm'),
    existingAtt: $('#ExistingAttachments'),
    newAtt: $('#NewAttachments'),
    attachPicker: $('#AttachPicker'),
  };

  // Utilities
  function showError(msg) {
    el.error.textContent = msg;
    el.error.style.display = 'block';
    setTimeout(() => (el.error.style.display = 'none'), 4000);
  }

  function isoNow() { return new Date().toISOString(); }
  function today() { return new Date().toISOString().slice(0,10); }
  function toInt(v, d=0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

  function splitPipes(v) {
    if (!v) return [];
    return String(v).split('|').map(s => s.trim()).filter(Boolean);
  }

  function joinPipes(arr) {
    return (arr || []).map(s => String(s).trim()).filter(Boolean).join('|');
  }

  // Simple CSV parser that supports quoted fields and commas inside quotes
  function parseCSV(text) {
    const rows = [];
    let i = 0, cur = '', inQuotes = false, row = [];
    function pushCell() { row.push(cur); cur = ''; }
    function pushRow() { rows.push(row); row = []; }
    while (i < text.length) {
      const ch = text[i++];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i] === '"') { cur += '"'; i++; } // escaped quote
          else { inQuotes = false; }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { pushCell(); }
        else if (ch === '\n') { pushCell(); pushRow(); }
        else if (ch === '\r') {
          // ignore CR; handle CRLF by peeking next \n
        } else { cur += ch; }
      }
    }
    // flush last cell/row if any content
    if (cur.length || row.length) { pushCell(); pushRow(); }

    // Trim possible trailing empty row
    while (rows.length && rows[rows.length-1].every(v => v === '')) rows.pop();
    return rows;
  }

  function toCSV(rows, headers = FIELDS) {
    const esc = (v) => {
      if (v == null) v = '';
      v = String(v);
      if (/[",\n\r]/.test(v)) {
        return '"' + v.replace(/"/g, '""') + '"';
      }
      return v;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map(h => esc(row[h])).join(','));
    }
    return lines.join('\n');
  }

  function normalizeArticle(rec) {
    const a = {};
    for (const f of FIELDS) a[f] = rec[f] ?? '';
    // Coerce some
    a.ArticleID = String(a.ArticleID || '');
    a.VersionNumber = String(a.VersionNumber || '1');
    a.Status = a.Status || 'Draft';
    a.Type = a.Type || 'Guide';
    a.Visibility = a.Visibility || 'Internal';
    a.Audience = a.Audience || 'Support';
    return a;
  }

  function headersToIndex(headers) {
    const map = new Map();
    headers.forEach((h, idx) => map.set(h.trim(), idx));
    return map;
  }

  function recordsFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const headers = rows[0].map(h => h.trim());
    const idx = headersToIndex(headers);
    const recs = [];
    for (let r = 1; r < rows.length; r++) {
      if (!rows[r] || rows[r].every(v => !String(v).trim())) continue;
      const obj = {};
      for (const f of FIELDS) {
        const j = idx.has(f) ? idx.get(f) : -1;
        obj[f] = j >= 0 ? rows[r][j] : '';
      }
      recs.push(normalizeArticle(obj));
    }
    return recs;
  }

  // Filtering, sorting
  function applyFilters() {
    const q = el.search.value.trim().toLowerCase();
    const selType = el.typeFilter ? el.typeFilter.value : '';
    const st = el.statusFilter.value;
    const vis = el.visibilityFilter.value;
    const au = el.authorFilter.value;

    let list = state.articles.slice();
    if (q) {
      list = list.filter(a => [a.Title, a.Summary, a.Description, a.Tags, a.Workaround]
        .some(v => String(v).toLowerCase().includes(q)));
    }
    if (selType) list = list.filter(a => (a.Type || '') === selType);
    if (st) list = list.filter(a => a.Status === st);
    if (state.publicMode) {
      list = list.filter(a => (a.Visibility || '') === 'Public');
    } else if (vis) {
      list = list.filter(a => a.Visibility === vis);
    }
    if (au) list = list.filter(a => a.Author === au);

    // Sort using state.sortBy/state.sortDir set by header clicks
    const field = state.sortBy;
    const dir = state.sortDir;
    list.sort((a, b) => {
      const va = (a[field] || '').toString();
      const vb = (b[field] || '').toString();
      if (field.endsWith('Date')) {
        const da = Date.parse(va || '1970-01-01T00:00:00Z');
        const db = Date.parse(vb || '1970-01-01T00:00:00Z');
        return dir === 'asc' ? da - db : db - da;
      }
      return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    });

    state.filtered = list;
    renderRows();
    renderCount();
    renderSortIndicators();
    if (state.selectedId) {
      const row = document.querySelector(`tbody tr[data-id="${CSS.escape(state.selectedId)}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderCount() { if (el.count) el.count.textContent = state.filtered.length; }

  function renderRows() {
    const frag = document.createDocumentFragment();
    for (const a of state.filtered) {
      const tr = document.createElement('tr');
      tr.dataset.id = a.ArticleID;
      if (String(a.ArticleID) === String(state.selectedId)) tr.classList.add('selected');
      tr.innerHTML = `
        <td class="muted">${a.ArticleID || ''}</td>
        <td>${esc(a.Title)}</td>
        <td class="muted">${esc(a.Summary)}</td>
        <td class=\"muted\">${esc(a.Type)}</td>
        <td>${renderStatus(a.Status)}</td>
        <td>${renderVisibility(a.Visibility)}</td>
        <td class="muted">${fmtDate(a.UpdatedDate)}</td>
        <td class="muted">${esc(a.Author)}</td>
      `;
      tr.addEventListener('click', () => selectArticle(a.ArticleID));
      frag.appendChild(tr);
    }
    el.rows.replaceChildren(frag);
  }

  function renderStatus(s) {
    if (s === 'Published') return `<span class="chip ok">Published</span>`;
    if (s === 'Archived') return `<span class="chip warn">Archived</span>`;
    return `<span class="chip">${esc(s||'Draft')}</span>`;
  }
  function renderVisibility(v) {
    if (v === 'Public') return `<span class="chip pub">Public</span>`;
    return `<span class="chip">Internal</span>`;
  }
  function renderChips(list) {
    if (!list.length) return '';
    return `<div class="chips">${list.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</div>`;
  }
  function fmtDate(d) {
    if (!d) return '';
    try {
      const dt = new Date(d);
      if (isNaN(dt)) return esc(d);
      return dt.toISOString().slice(0,10);
    } catch { return esc(d); }
  }
  function esc(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
  
  function renderSortIndicators() {
    const ths = document.querySelectorAll('thead th.sortable');
    ths.forEach(th => {
      const ind = th.querySelector('.sort-ind');
      if (!ind) return;
      const f = th.dataset.field;
      if (f === state.sortBy) ind.textContent = state.sortDir === 'asc' ? '↑' : '↓';
      else ind.textContent = '';
    });
  }
  
  // URL helpers — prefer hash params to avoid conflicting with CSOD's own query
  function getHashParams() {
    const raw = (location.hash || '').replace(/^#\??/, '');
    return new URLSearchParams(raw);
  }
  function getUrlParam(name, altNames = []) {
    const hp = getHashParams();
    const qp = new URLSearchParams(location.search);
    const names = [name, ...altNames];
    for (const n of names) { const v = hp.get(n); if (v != null && v !== '') return String(v); }
    for (const n of names) { const v = qp.get(n); if (v != null && v !== '') return String(v); }
    return '';
  }
  function getUrlId() { return getUrlParam('id', ['kbid']); }
  function getUrlView() { return (getUrlParam('view', ['kbview']) || '').toLowerCase(); }
  function getNameVars() {
    const gv = (k) => (window[k] != null ? String(window[k]) : '');
    const meta = (n) => {
      const m = document.querySelector(`meta[name="${n}"]`);
      return m && m.content ? String(m.content) : '';
    };
    const elt = (id) => {
      const e = document.getElementById(id);
      return e ? String((e.getAttribute('data-value') || e.textContent || '').trim()) : '';
    };
    const first = gv('FIRSTNAME') || gv('PAGE_FIRSTNAME') || meta('FIRSTNAME') || elt('FIRSTNAME');
    const last = gv('LASTNAME') || gv('PAGE_LASTNAME') || meta('LASTNAME') || elt('LASTNAME');
    return { first: first || '', last: last || '' };
  }
  function setHashParams(updates, push=false) {
    const hp = getHashParams();
    Object.entries(updates).forEach(([k,v]) => {
      if (v == null || v === '') hp.delete(k); else hp.set(k, String(v));
    });
    const hash = hp.toString();
    const url = location.pathname + location.search + (hash ? '#' + hash : '');
    if (push) history.pushState({}, '', url); else history.replaceState({}, '', url);
  }
  function setUrlId(id, push=false) { setHashParams({ id: id || '' }, push); }

  function selectArticle(id, updateUrl = true) {
    state.selectedId = id || null;
    const a = id ? state.articles.find(x => x.ArticleID === id) : null;
    if (updateUrl && state.mode === 'list') setUrlId(id || null, false);
    renderDetails(a || null);
    renderRows();
    const row = id ? document.querySelector(`tbody tr[data-id="${CSS.escape(id)}"]`) : null;
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  function renderDetails(a) {
    if (!a) {
      if (el.detailsTitle) el.detailsTitle.textContent = '';
      el.details.innerHTML = `<p class="muted">Select an article to view details.</p>`;
      return;
    }
    if (el.detailsTitle) el.detailsTitle.textContent = a.Title || '';
    el.details.innerHTML = `
      <div class="chips">${renderStatus(a.Status)}${renderVisibility(a.Visibility)}</div>
      <p class="muted">${esc(a.Summary)}</p>
      ${(a.Type === 'Bug' || a.Type === 'Limitation') && a.Workaround ? `<div class="field"><label>Workaround</label><div>${nl2br(esc(a.Workaround))}</div></div>` : ''}
      <div class="grid-2" style="margin-top:8px">
        <div class="field"><label>Author</label><div>${esc(a.Author)}</div></div>
        <div class="field"><label>Created</label><div>${fmtDate(a.CreatedDate)}</div></div>
        <div class="field"><label>Updated</label><div>${fmtDate(a.UpdatedDate)}</div></div>
        ${a.ResolvedDate ? `<div class="field"><label>Resolved</label><div>${fmtDate(a.ResolvedDate)}</div></div>` : ''}
        ${(!state.publicMode && a.ReviewDate) ? `<div class=\"field\"><label>Review</label><div>${fmtDate(a.ReviewDate)}</div></div>` : ''}
        ${!state.publicMode ? `<div class=\"field\"><label>Audience</label><div>${esc(a.Audience)}</div></div>` : ''}
      </div>
      ${a.Tags ? `<div class="field" style="margin-top:8px"><label>Tags</label><div>${esc(a.Tags)}</div></div>` : ''}
      ${a.RelatedArticles ? `<div class="field"><label>Related</label><div>${esc(a.RelatedArticles)}</div></div>` : ''}
      <div class="field"><label>Description</label><div>${nl2br(esc(a.Description))}</div></div>
      ${parseAttachmentLinks(a.AttachmentLinks).length ? `<div class="field"><label>Attachments</label><div>${renderAttachmentList(parseAttachmentLinks(a.AttachmentLinks))}</div></div>` : (a.Attachments ? `<div class="field"><label>Attachments</label><div>${renderLinks(a.Attachments)}</div></div>` : '')}
    `;
    // Update action buttons visibility for current article
    updateEditButtonVisibility(a);
  }

  function renderLinks(csv) {
    const parts = String(csv).split(',').map(s => s.trim()).filter(Boolean);
    return parts.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`).join('<br/>');
  }
  // Added: Attachment JSON parsing and rendering
  function parseAttachmentLinks(v) {
    if (!v) return [];
    try {
      const arr = typeof v === 'string' ? JSON.parse(v) : v;
      if (Array.isArray(arr)) return arr.map(x => ({ name: x.name || x.FileName || '', url: x.url || x.ServerRelativeUrl || '' }));
    } catch {}
    return [];
  }
  function renderAttachmentList(list) {
    if (!list || !list.length) return '';
    return list.map(a => `<a href="${esc(a.url||'#')}" target="_blank" rel="noopener">${esc(a.name||a.url)}</a>`).join('<br/>');
  }
  function nl2br(s) { return s.replace(/\n/g, '<br/>'); }

  // Read selected files to base64 payload objects
  function readFilesAsBase64(fileList) {
    const files = Array.from(fileList || []);
    return Promise.all(files.map(f => new Promise((resolve,reject)=>{
      const fr = new FileReader();
      fr.onload = () => {
        const res = String(fr.result || '');
        const base64 = res.startsWith('data:') ? res.split(',')[1] : '';
        resolve({ name: f.name, content_base64: base64, contentType: f.type || 'application/octet-stream' });
      };
      fr.onerror = () => reject(fr.error || new Error('read error'));
      fr.readAsDataURL(f);
    })));
  }

  // Build filters from data
  function rebuildTaxonomy() {
    state.authors.clear();
    state.types.clear();
    for (const a of state.articles) {
      if (a.Author) state.authors.add(a.Author);
      if (a.Type) state.types.add(a.Type);
    }
    // Types (fixed list union data)
    if (el.typeFilter) {
      const allTypes = Array.from(new Set([...TYPES, ...state.types]));
      el.typeFilter.innerHTML = '<option value="">All types</option>' +
        allTypes.map(t => `<option>${esc(t)}</option>`).join('');
    }
    // Authors
    const cur = el.authorFilter.value;
    el.authorFilter.innerHTML = '<option value="">All authors</option>' +
      Array.from(state.authors).sort().map(a => `<option>${esc(a)}</option>`).join('');
    if (Array.from(el.authorFilter.options).some(o => o.value === cur)) el.authorFilter.value = cur;
  }

  // CRUD
  function nextId() {
    const max = state.articles.reduce((m,a) => Math.max(m, toInt(a.ArticleID, 0)), 0);
    return String(max + 1);
  }

  function openForm(existing) {
    el.modal.style.display = 'flex';
    el.modal.setAttribute('aria-hidden', 'false');
    if (el.form) el.form.setAttribute('novalidate', 'novalidate');
    const isNew = !existing;
    el.formTitle.textContent = isNew ? 'New Article' : `Edit Article #${existing.ArticleID}`;
    if (el.formMeta) {
      el.formMeta.textContent = isNew ? '' : `Created: ${fmtDate(existing.CreatedDate)}`;
    }
    const patch = existing || {};
    // Fill form fields by name
    for (const f of ['Title','Summary','Description','Type','Tags','Author','Status','Visibility','ResolvedDate','ReviewDate','Workaround','RelatedArticles']) {
      const input = el.form.querySelector('#'+f);
      if (!input) continue;
      if (f === 'Status' || f === 'Visibility' || f === 'Type') input.value = patch[f] || input.value;
      else input.value = patch[f] || '';
    }
    // Show/hide Workaround field depending on Type
    const typeInput = el.form.querySelector('#Type');
    const workField = el.form.querySelector('#WorkaroundField');
    function updateWorkaroundVisibility() {
      const v = (typeInput && typeInput.value) || 'Guide';
      if (workField) workField.style.display = (v === 'Bug' || v === 'Limitation') ? '' : 'none';
    }
    if (typeInput) typeInput.addEventListener('change', updateWorkaroundVisibility);
    updateWorkaroundVisibility();

    // Attachments UI
    const existingLinks = parseAttachmentLinks(existing && existing.AttachmentLinks);
    if (el.existingAtt) {
      el.existingAtt.innerHTML = existingLinks && existingLinks.length
        ? '<div class="att-list">' + existingLinks.map(a => `<div class="att-item"><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name||a.url)}</a><label class="att-actions"><input type="checkbox" class="att-remove" data-attname="${esc(a.name)}" /> Remove</label></div>`).join('') + '</div>'
        : '<div class="muted">No attachments</div>';
    }
    if (el.newAtt) el.newAtt.textContent = '';
    if (el.attachPicker) {
      el.attachPicker.value = '';
      el.attachPicker.onchange = () => {
        const files = Array.from(el.attachPicker.files || []);
        if (el.newAtt) {
          el.newAtt.innerHTML = files.length
            ? '<div class="att-list">' + files.map(f => `<div class="att-item"><span>${esc(f.name)}</span><span class="muted">${f.size} bytes</span></div>`).join('') + '</div>'
            : '';
        }
      };
    }

    // Show/hide ResolvedDate depending on Status = Resolved
    const statusInput = el.form.querySelector('#Status');
    const resolvedField = el.form.querySelector('#ResolvedDateField');
    const resolvedInput = el.form.querySelector('#ResolvedDate');
    function updateResolvedVisibility() {
      const isResolved = (statusInput && statusInput.value) === 'Resolved';
      if (resolvedField) resolvedField.style.display = isResolved ? '' : 'none';
      if (!isResolved && resolvedInput) resolvedInput.value = '';
    }
    if (statusInput) statusInput.addEventListener('change', updateResolvedVisibility);
    updateResolvedVisibility();
    if (state.submitHandler) {
      try { el.form.removeEventListener('submit', state.submitHandler); } catch {}
    }
    const onSubmit = async (e) => {
      e.preventDefault();
      const formData = Object.fromEntries(new FormData(el.form).entries());
      const now = isoNow();
      const filesToAdd = el.attachPicker && el.attachPicker.files ? el.attachPicker.files : [];
      const removeNames = Array.from(document.querySelectorAll('.att-remove:checked')).map(ch => ch.getAttribute('data-attname')).filter(Boolean);
      const attachments_add = await readFilesAsBase64(filesToAdd);
      if (isNew) {
        // Build payload for create flow
        const relatedIds = String(formData.RelatedArticles || '')
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => Number.isFinite(n));
        const relatedObjs = relatedIds.map(n => ({ Id: n }));
        const payload = {
          request: 'create',
          item: {
            Title: formData.Title,
            Summary: formData.Summary,
            Description: formData.Description,
            Type: formData.Type || 'Guide',
            Status: formData.Status,
            Visibility: formData.Visibility,
            Tags: formData.Tags,
            Workaround: formData.Workaround,
            ResolvedDate: formData.Status === 'Resolved' ? (formData.ResolvedDate || today()) : '',
            ReviewDate: formData.ReviewDate,
          Audience: inferAudience(formData.Visibility),
            RelatedArticles: relatedObjs,
            Author: formData.Author
          },
          attachments_add,
          attachments_delete: []
        };
        if (attachments_add && attachments_add.length) payload.item.attachments = 'yes';
        try {
          // Trim empty arrays to avoid sending unused properties
          if (!attachments_add || attachments_add.length === 0) delete payload.attachments_add;
          if (payload.item && !payload.item.attachments) delete payload.item.attachments;
          if (DEBUG_FLOW) console.log('[KB] Create payload:', { addLen: attachments_add ? attachments_add.length : 0, payload });
          const res = await fetch(FLOW_SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error('Create flow failed: ' + res.status);
          const item = Array.isArray(data) ? data[0] : (data.value && Array.isArray(data.value) ? data.value[0] : (data.item || data));
          if (DEBUG_FLOW) console.log('[KB] Create flow response:', data);
          let mapped = normalizeArticle(mapFlowItem(item));
          // Fallbacks if flow response omits fields; use entered form values
          mapped.Title = mapped.Title || formData.Title;
          mapped.Summary = mapped.Summary || formData.Summary;
          mapped.Description = mapped.Description || formData.Description;
          mapped.Type = mapped.Type || (formData.Type || 'Guide');
          mapped.Status = mapped.Status || formData.Status;
          mapped.Visibility = mapped.Visibility || formData.Visibility;
          mapped.Author = mapped.Author || formData.Author;
          mapped.CreatedDate = mapped.CreatedDate || now;
          mapped.UpdatedDate = mapped.UpdatedDate || now;
          // Insert new record; if ArticleID missing, synthesize one
          mapped.ArticleID = mapped.ArticleID || nextId();
          state.articles.push(mapped);
          rebuildTaxonomy();
          selectArticle(mapped.ArticleID, true);
        } catch (err) {
          console.warn('Create flow error, falling back to local create:', err);
          const rec = normalizeArticle({
            ArticleID: nextId(),
            Title: formData.Title,
            Summary: formData.Summary,
            Description: formData.Description,
            Type: formData.Type || 'Guide',
            Tags: formData.Tags,
            RelatedArticles: (relatedIds || []).join(', '),
            Author: formData.Author,
            LastEditor: formData.Author,
            CreatedDate: now,
            UpdatedDate: now,
            ResolvedDate: formData.Status === 'Resolved' ? formData.ResolvedDate : '',
            Workaround: formData.Workaround,
            Status: formData.Status,
            Visibility: formData.Visibility,
            VersionNumber: '1',
            ReviewDate: formData.ReviewDate,
            Audience: inferAudience(formData.Visibility),
          });
          state.articles.push(rec);
          rebuildTaxonomy();
          selectArticle(rec.ArticleID, true);
        }
      } else {
        // Update existing via Flow
        const idx = state.articles.findIndex(a => a.ArticleID === existing.ArticleID);
        const relatedIds = String(formData.RelatedArticles || '')
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => Number.isFinite(n));
        const relatedObjs2 = relatedIds.map(n => ({ Id: n }));
        // Build filtered AttachmentLinks locally (do not delete files on SharePoint)
        const curLinks = parseAttachmentLinks(existing && existing.AttachmentLinks);
        const filteredLinks = curLinks.filter(a => !removeNames.includes(a.name));
        const payload = {
          request: 'edit',
          id: existing.ArticleID,
          item: {
            Title: formData.Title,
            Summary: formData.Summary,
            Description: formData.Description,
            Type: formData.Type || existing.Type || 'Guide',
            Status: formData.Status,
            Visibility: formData.Visibility,
            Tags: formData.Tags,
            Workaround: formData.Workaround,
            ResolvedDate: formData.Status === 'Resolved' ? (formData.ResolvedDate || existing.ResolvedDate || today()) : '',
            ReviewDate: formData.ReviewDate,
            Audience: inferAudience(formData.Visibility || existing.Visibility),
            RelatedArticles: relatedObjs2,
            Author: formData.Author || existing.Author,
            AttachmentLinks: JSON.stringify(filteredLinks)
          },
          attachments_add,
          attachments_delete: []
        };
        if (attachments_add && attachments_add.length) payload.item.attachments = 'yes';
        try {
          // Trim empty arrays to avoid sending unused properties
          if (!attachments_add || attachments_add.length === 0) delete payload.attachments_add;
          if (removeNames.length === 0) delete payload.attachments_delete;
          if (DEBUG_FLOW) console.log('[KB] Edit payload:', { addLen: attachments_add ? attachments_add.length : 0, delLen: removeNames.length, payload });
          const res = await fetch(FLOW_SAVE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error('Edit flow failed: ' + res.status);
          const item = Array.isArray(data) ? data[0] : (data.value && Array.isArray(data.value) ? data.value[0] : (data.item || data));
          if (DEBUG_FLOW) console.log('[KB] Edit flow response:', data);
          let mapped = normalizeArticle(mapFlowItem(item));
          mapped.ArticleID = mapped.ArticleID || existing.ArticleID;
          // Fallbacks
          mapped.Title = mapped.Title || formData.Title || existing.Title;
          mapped.Summary = mapped.Summary || formData.Summary || existing.Summary;
          mapped.Description = mapped.Description || formData.Description || existing.Description;
          mapped.Type = mapped.Type || formData.Type || existing.Type;
          mapped.Status = mapped.Status || formData.Status || existing.Status;
          mapped.Visibility = mapped.Visibility || formData.Visibility || existing.Visibility;
          mapped.Author = mapped.Author || formData.Author || existing.Author;
          mapped.UpdatedDate = mapped.UpdatedDate || now;
          // If flow did not return links, keep locally filtered links so UI reflects removals immediately
          if (!mapped.AttachmentLinks || mapped.AttachmentLinks.length === 0) {
            mapped.AttachmentLinks = JSON.stringify(filteredLinks);
          }
          if (idx >= 0) state.articles[idx] = mapped; else state.articles.push(mapped);
          rebuildTaxonomy();
          selectArticle(mapped.ArticleID, false);
        } catch (err) {
          console.warn('Edit flow error, applying local update:', err);
          if (idx >= 0) {
            const cur = state.articles[idx];
            const v = String(toInt(cur.VersionNumber, 1) + 1);
            state.articles[idx] = normalizeArticle({
              ...cur,
              ...formData,
              LastEditor: formData.Author || cur.LastEditor,
            UpdatedDate: now,
            VersionNumber: cur.VersionNumber,
            Audience: inferAudience(formData.Visibility || cur.Visibility),
          });
            if (state.articles[idx].Status !== 'Resolved') state.articles[idx].ResolvedDate = '';
            rebuildTaxonomy();
            selectArticle(existing.ArticleID, false);
          }
        }
      }
      applyFilters();
      closeForm();
    };
    el.form.onsubmit = onSubmit;
    el.form.addEventListener('submit', onSubmit);
    state.submitHandler = onSubmit;
  }

  function inferAudience(visibility) {
    return visibility === 'Public' ? 'End users' : 'Support';
  }

  function closeForm() {
    el.modal.style.display = 'none';
    el.modal.setAttribute('aria-hidden', 'true');
  }

  // Deletion removed in favor of Archived status

  // CSV import/export
  function exportCSV() {
    const csv = toCSV(state.articles, FIELDS);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kb-export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importFromText(text) {
    try {
      const recs = recordsFromCSV(text);
      state.articles = recs.map(normalizeArticle);
      rebuildTaxonomy();
      applyFilters();
      // Select from URL if available; otherwise first article
      const urlId = getUrlId();
      if (urlId && state.articles.some(a => a.ArticleID === urlId)) {
        selectArticle(urlId, false); // keep URL as-is
      } else if (state.articles.length) {
        selectArticle(state.articles[0].ArticleID);
      } else {
        selectArticle(null);
      }
    } catch (e) {
      console.error(e);
      showError('Failed to parse CSV.');
    }
  }

  async function tryLoadFlow() {
    try {
      const res = await fetch(FLOW_GET_URL, { method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
      if (!res.ok) throw new Error('Flow GET failed: ' + res.status);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (Array.isArray(data?.value) ? data.value : []);
      if (DEBUG_FLOW) {
        console.log('[KB] Flow raw response:', data);
        console.log('[KB] Flow items[0]:', Array.isArray(items) ? items[0] : null);
      }
      if (!Array.isArray(items)) throw new Error('Unexpected response shape');
      const recs = items.map(mapFlowItem).map(normalizeArticle);
      if (DEBUG_FLOW) console.log('[KB] First mapped record:', recs[0]);
      state.articles = recs;
      rebuildTaxonomy();
      applyFilters();
      const urlId = getUrlId();
      if (urlId && state.articles.some(a => a.ArticleID === urlId)) selectArticle(urlId, false);
      else if (state.articles.length) selectArticle(state.articles[0].ArticleID);
      return true;
    } catch (e) {
      console.warn('Flow load failed', e);
      showError('Using sample data (flow load failed).');
      return false;
    }
  }

  function mapFlowItem(it) {
    // Heuristic mapping — we’ll refine once we see the payload
    const pick = (...names) => {
      for (const n of names) {
        if (it && it[n] != null && it[n] !== '') return it[n];
      }
      return '';
    };
    const fromPerson = (p) => {
      if (!p) return '';
      if (typeof p === 'string') return p;
      return p.Title || p.Name || p.DisplayName || p.Email || '';
    };
    const attachments = (() => {
      const files = it.AttachmentFiles || it.Attachments || [];
      if (Array.isArray(files) && files.length) {
        const urls = files.map(f => f.ServerRelativeUrl || f.Url || f.url || '').filter(Boolean);
        if (urls.length) return urls.join(',');
      }
      // SharePoint list connector often returns only {HasAttachments} and {Link}
      if (it['{HasAttachments}']) {
        const link = it['{Link}'] || '';
        return link; // Not a direct file, but at least indicates presence
      }
      return '';
    })();

    const created = pick('Created', 'CreatedDate');
    const modified = pick('Modified', 'UpdatedDate');

    // Choice fields may be expanded references with { Id, Value }
    const readChoice = (objOrStr) => {
      if (!objOrStr) return '';
      if (typeof objOrStr === 'string') return objOrStr;
      if (typeof objOrStr === 'object') return objOrStr.Value || objOrStr.value || '';
      return '';
    };

    // Multi-lookup RelatedArticles → prefer numeric IDs array `RelatedArticles#Id`
    const related = (() => {
      const ids = it['RelatedArticles#Id'];
      if (Array.isArray(ids) && ids.length) return ids.join(', ');
      const rel = it.RelatedArticles;
      if (Array.isArray(rel) && rel.length) {
        const vals = rel.map(r => r.Id || r.Value).filter(Boolean);
        if (vals.length) return vals.join(', ');
      }
      return '';
    })();

    return {
      ArticleID: String(pick('ArticleID', 'ID', 'Id') || ''),
      Title: pick('Title'),
      Summary: pick('Summary'),
      Description: pick('Description'),
      Type: readChoice(it.ArticleType) || pick('Type') || 'Guide',
      Tags: pick('Tags'),
      RelatedArticles: related,
      Attachments: attachments,
      AttachmentLinks: pick('AttachmentLinks'),
      Author: fromPerson(it.Author) || pick('Author0') || pick('Author'),
      LastEditor: fromPerson(it.Editor) || pick('LastEditor'),
      CreatedDate: created,
      UpdatedDate: modified,
      ResolvedDate: pick('ResolvedDate'),
      Workaround: pick('Workaround'),
      Status: readChoice(it.Status) || pick('Status') || 'Draft',
      Visibility: readChoice(it.Visibility) || pick('Visibility') || 'Internal',
      VersionNumber: pick('{VersionNumber}', 'VersionNumber', 'Version'),
      ReviewDate: pick('ReviewDate'),
      Audience: readChoice(it.Audience) || pick('Audience') || inferAudience(readChoice(it.Visibility) || pick('Visibility')),
    };
  }

  function tryLoadSample() {
    fetch('sample-kb.csv', { cache: 'no-store' }).then(async (res) => {
      if (!res.ok) throw new Error('No sample CSV');
      const text = await res.text();
      importFromText(text);
    }).catch(() => {
      // Start empty silently
    });
  }

  // Event wiring
  function wire() {
    ['input','change'].forEach(evt => {
      el.search.addEventListener(evt, applyFilters);
      if (el.typeFilter) el.typeFilter.addEventListener(evt, applyFilters);
      el.statusFilter.addEventListener(evt, applyFilters);
      el.visibilityFilter.addEventListener(evt, applyFilters);
      el.authorFilter.addEventListener(evt, applyFilters);
    });
    const clear = document.querySelector('#clearFilters');
    if (clear) clear.addEventListener('click', () => {
      el.search.value = '';
      if (el.typeFilter) el.typeFilter.value = '';
      el.statusFilter.value = '';
      el.visibilityFilter.value = '';
      el.authorFilter.value = '';
      applyFilters();
    });
    if (el.importBtn && el.csvFile) {
      el.importBtn.addEventListener('click', () => el.csvFile.click());
      el.csvFile.addEventListener('change', () => {
        const f = el.csvFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => importFromText(String(reader.result || ''));
        reader.readAsText(f);
      });
    }
    if (el.exportBtn) el.exportBtn.addEventListener('click', exportCSV);
    el.newBtn.addEventListener('click', () => openForm(null));
    el.editBtn.addEventListener('click', () => {
      const a = state.articles.find(x => x.ArticleID === state.selectedId);
      if (!a) return showError('Select an article first.');
      openForm(a);
    });
    if (el.copyBtn) {
      el.copyBtn.addEventListener('click', async () => {
        const a = (state.mode === 'single') ? (state.articles[0] || null) : state.articles.find(x => x.ArticleID === state.selectedId);
        if (!a) return showError('Select an article first.');
        const url = buildShareUrl(a.ArticleID);
        try {
          await copyToClipboard(url);
          const old = el.copyBtn.textContent;
          el.copyBtn.textContent = 'Copied!';
          setTimeout(() => { el.copyBtn.textContent = old; }, 1200);
        } catch (e) {
          showError('Failed to copy link');
        }
      });
    }
    el.closeModal.addEventListener('click', closeForm);
    el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeForm(); });

    // Back link
    const back = document.querySelector('#backLink');
    if (back) back.addEventListener('click', (e) => {
      e.preventDefault();
      goToList();
    });

    // Back/forward navigation — re-evaluate route (popstate and hashchange)
    window.addEventListener('popstate', handleRoute);
    window.addEventListener('hashchange', handleRoute);

    // Sort by clicking table headers (except ID)
    document.querySelectorAll('thead th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const field = th.dataset.field;
        if (!field) return;
        setSort(field);
      });
    });
  }

  function setSort(field) {
    if (field === state.sortBy) {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sortBy = field;
      state.sortDir = field.endsWith('Date') ? 'desc' : 'asc';
    }
    applyFilters();
  }

  // Init
  function init() {
    wire();
    // Route-aware init
    handleRoute();
    renderSortIndicators();
    ensureDebugBanner();
  }
  document.addEventListener('DOMContentLoaded', init);

  // ---- Routing & Single View ----
  function handleRoute() {
    const view = getUrlView();
    // Determine public mode from query or host-provided name vars
    if (view === 'public') {
      state.publicMode = true;
    } else if (view === 'internal') {
      state.publicMode = false;
    } else {
      const { first, last } = getNameVars();
      state.publicMode = !(first && last && isInternalUser(first, last));
    }
    applyPublicUI();
    ensureDebugBanner();

    if (view === 'single') {
      enterSingleMode();
    } else {
      enterListMode();
    }
  }

  // --- Debug banner (optional via #kbdebug=1) ---
  function ensureDebugBanner() {
    const dbg = getUrlParam('kbdebug', ['kbdebug']);
    const enabled = dbg && dbg !== '0' && dbg !== 'false';
    let box = document.getElementById('kb-debug');
    if (!enabled) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement('div');
      box.id = 'kb-debug';
      box.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:9999;background:#111;color:#fff;padding:8px 10px;font:12px/1.4 system-ui;opacity:0.9;border-radius:4px;max-width:50vw;';
      document.body.appendChild(box);
    }
    const { first, last } = getNameVars();
    const id = getUrlId();
    const view = getUrlView();
    const matched = (first && last) ? isInternalUser(first, last) : false;
    box.innerHTML = `KB Debug — mode: <b>${state.publicMode ? 'public' : 'internal'}</b><br/>`+
      `FIRSTNAME: ${first || '(blank)'}; LASTNAME: ${last || '(blank)'}; matched: ${matched}<br/>`+
      `id: ${id || '(none)'}; view: ${view || '(none)'}<br/>`+
      `FLOW_GET_URL: ${FLOW_GET_URL}<br/>`+
      `FLOW_SAVE_URL: ${FLOW_SAVE_URL}`;
  }

  function enterSingleMode() {
    state.mode = 'single';
    document.body.classList.add('single-view');
    const id = getUrlId();
    if (!id) {
      renderSingleError('Missing article id.');
      return;
    }
    loadSingleFromFlow(id);
  }

  function buildShareUrl(id) {
    const hash = `id=${encodeURIComponent(id)}&view=single`;
    return SHARE_BASE_URL + (SHARE_BASE_URL.includes('#') ? '&' : '#') + hash;
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  }

  function enterListMode() {
    state.mode = 'list';
    document.body.classList.remove('single-view');
    // Load full list
    tryLoadFlow().then(ok => { if (!ok) tryLoadSample(); });
  }

  function goToList() {
    // Clear our hash params to return to list view
    const hp = getHashParams();
    hp.delete('view');
    hp.delete('kbview');
    hp.delete('id');
    hp.delete('kbid');
    const hash = hp.toString();
    const url = location.pathname + location.search + (hash ? '#' + hash : '');
    history.pushState({}, '', url);
    handleRoute();
  }

  async function loadSingleFromFlow(id) {
    try {
      const res = await fetch(FLOW_GET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ request: 'readOne', id })
      });
      if (!res.ok) throw new Error('Flow readOne failed: ' + res.status);
      const data = await res.json().catch(() => ({}));
      const item = Array.isArray(data) ? data[0]
        : (Array.isArray(data?.value) ? data.value[0]
        : (data?.item || data));
      if (!item) throw new Error('Not found');
      const mapped = normalizeArticle(mapFlowItem(item));
      if (state.publicMode && mapped.Visibility !== 'Public') {
        throw new Error('Not public');
      }
      state.articles = [mapped];
      state.filtered = [mapped];
      state.selectedId = mapped.ArticleID;
      document.title = (mapped.Title ? (mapped.Title + ' – ') : '') + 'LMS Knowledge Base';
      renderDetails(mapped);
    } catch (e) {
      console.warn('Single load failed', e);
      renderSingleError('Article not found or unavailable.');
    }
  }

  function renderSingleError(msg) {
    const title = 'Article';
    if (el.detailsTitle) el.detailsTitle.textContent = title;
    el.details.innerHTML = `
      <p class="muted">${esc(msg)}</p>
      <p><a href="#" id="singleBackLink">← Back to all articles</a></p>
    `;
    const back = document.querySelector('#singleBackLink');
    if (back) back.addEventListener('click', (e) => { e.preventDefault(); goToList(); });
    updateEditButtonVisibility(null);
  }

  function updateEditButtonVisibility(a) {
    const edit = el.editBtn;
    const copy = el.copyBtn;
    // Edit visibility
    if (edit) {
      if (state.mode === 'single') {
        const show = !!(a && (a.Visibility === 'Internal'));
        edit.style.display = show ? '' : 'none';
      } else {
        const show = !!state.selectedId && !state.publicMode;
        edit.style.display = show ? '' : 'none';
        edit.disabled = !show;
      }
    }
    // Copy availability
    if (copy) {
      const canCopy = !!(a && a.ArticleID);
      copy.disabled = !canCopy;
    }
  }

  function applyPublicUI() {
    document.body.classList.toggle('public-view', !!state.publicMode);
    if (state.publicMode) {
      if (el.visibilityFilter) {
        el.visibilityFilter.value = 'Public';
        el.visibilityFilter.disabled = true;
      }
      if (el.statusFilter) {
        const allowed = new Set(['', 'Resolved', 'Published']);
        Array.from(el.statusFilter.options).forEach(opt => {
          opt.hidden = !allowed.has(opt.value);
        });
        if (!allowed.has(el.statusFilter.value)) el.statusFilter.value = '';
      }
      if (el.newBtn) el.newBtn.disabled = true;
    } else {
      if (el.visibilityFilter) el.visibilityFilter.disabled = false;
      if (el.statusFilter) {
        Array.from(el.statusFilter.options).forEach(opt => { opt.hidden = false; });
      }
      if (el.newBtn) el.newBtn.disabled = false;
    }
  }
})();
