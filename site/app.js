(function () {
  'use strict';

  const STORE_KEY = 'switchmap.doc.v1';
  const SPEEDS = ['1G', '10G', '25G', '40G', '50G', '100G'];
  const MEDIA = ['RJ45', 'SFP', 'SFP+', 'SFP28', 'QSFP+', 'QSFP28'];
  const DEFAULT_MEDIA = OS9.DEFAULT_MEDIA;
  const ABBR = Object.fromEntries(OS9.TYPES.map(t => [t.speed, t.abbr]));
  const PRESETS = {
    'S4048-ON': [[48, '10G', 'SFP+'], [6, '40G', 'QSFP+']],
    'S4048T-ON': [[48, '10G', 'RJ45'], [6, '40G', 'QSFP+']],
    'S3048-ON': [[48, '1G', 'RJ45'], [4, '10G', 'SFP+']],
  };
  const PALETTE = [
    ['#e5484d', 'Red'], ['#f76b15', 'Orange'], ['#f5b700', 'Yellow'], ['#46a758', 'Green'],
    ['#12a594', 'Teal'], ['#0090ff', 'Blue'], ['#5b5bd6', 'Indigo'], ['#8e4ec6', 'Purple'],
    ['#d6409f', 'Pink'], ['#8b8d98', 'Gray'],
  ];
  const AUTO_COLORS = ['#0090ff', '#46a758', '#f76b15', '#8e4ec6', '#12a594', '#e5484d',
    '#f5b700', '#d6409f', '#5b5bd6', '#7ce2fe', '#bdee63', '#a18072'];
  const MODES = [['access', 'Access', '#0090ff'], ['trunk', 'Trunk', '#8e4ec6'],
    ['hybrid', 'Hybrid', '#12a594'], ['routed', 'Routed (L3)', '#f76b15']];
  const STATUS_COLORS = { up: '#46a758', down: '#6b7280', 'admin-down': '#b91c1c' };
  const COLOR_BY = [['custom', 'Custom colors'], ['vlan', 'Untagged VLAN'], ['status', 'Link status'],
    ['mode', 'Port mode'], ['po', 'Port-channel']];
  const TEXT_FIELDS = ['description', 'connectedTo', 'mode', 'untagged', 'tagged', 'ip',
    'portChannel', 'admin', 'link', 'speed', 'mtu', 'notes', 'color'];

  // ---------- state ----------
  let doc = null; // loaded at the bottom, once everything it needs is defined
  const ui = { sw: 0, selected: new Set(), anchor: null, filter: '' };
  const undoStack = [];

  const $ = sel => document.querySelector(sel);
  const cur = () => doc.switches[ui.sw] || null;
  const uid = () => Math.random().toString(36).slice(2, 10);

  function newDoc() {
    return { format: 'switchmap', version: 1, switches: [] };
  }

  function blankPort(num) {
    const p = { num, hosts: [] };
    for (const k of TEXT_FIELDS) p[k] = '';
    return p;
  }

  function newSwitch() {
    return { id: uid(), name: 'New switch', model: '', unit: 1, firstPort: 1, rows: 2,
      groups: [], ports: [], vlans: {}, colorLabels: {}, colorBy: 'custom', showMac: false };
  }

  // Fills in anything missing so files from older versions or hand edits load safely.
  function normalizeDoc(d) {
    if (!d || d.format !== 'switchmap' || !Array.isArray(d.switches)) return null;
    for (const sw of d.switches) {
      const base = newSwitch();
      for (const k of Object.keys(base)) if (sw[k] == null) sw[k] = base[k];
      sw.ports = sw.ports.map((p, i) => {
        const full = Object.assign(blankPort(sw.firstPort + i), p);
        full.hosts = Array.isArray(p.hosts) ? p.hosts : [];
        return full;
      });
    }
    return d;
  }

  function loadDoc() {
    try {
      return normalizeDoc(JSON.parse(localStorage.getItem(STORE_KEY))) || newDoc();
    } catch (e) {
      return newDoc();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(doc));
    } catch (e) { /* storage unavailable or full: the Save button still works */ }
  }

  // Every change goes through here: snapshot for undo, mutate, save, re-render.
  // `skip` names the panel the user is typing in, which must not be rebuilt.
  function commit(fn, skip) {
    undoStack.push(JSON.stringify({ doc, sw: ui.sw }));
    if (undoStack.length > 50) undoStack.shift();
    fn();
    persist();
    render(skip);
  }

  function undo() {
    const snap = undoStack.pop();
    if (!snap) return;
    const s = JSON.parse(snap);
    doc = s.doc;
    ui.sw = Math.min(s.sw, Math.max(0, doc.switches.length - 1));
    ui.selected.clear();
    persist();
    render();
  }

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  function select(options, value, attrs) {
    const el = h('select', attrs, options.map(([v, label]) => h('option', { value: v }, label)));
    el.value = value;
    return el;
  }

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 4000);
  }

  // confirm() is unavailable when the page is embedded, so ask in the page.
  function ask(message, okLabel, onYes) {
    const dlg = $('#ask');
    dlg.replaceChildren(h('p', {}, message), h('div', { class: 'foot' },
      h('button', { onclick: () => dlg.close() }, 'Cancel'),
      h('button', { class: 'primary', onclick: () => { dlg.close(); onYes(); } }, okLabel)));
    dlg.showModal();
  }

  async function download(name, text, type) {
    // Some sandboxed embeds block downloads and offer a save API instead.
    if (window.claude && window.claude.use) {
      const dl = await window.claude.use('downloads');
      if (!dl) { toast('Saving files is not available in this view.'); return; }
      try {
        await dl.save({ filename: name, data: text });
        toast(`Saved ${name}.`);
      } catch (e) {
        if (!e || e.code !== 'declined') toast('The file could not be saved here.');
      }
      return;
    }
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const slug = s => String(s || '').trim().replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '') || 'switch-map';

  function textOn(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return lum > 0.6 ? '#111' : '#fff';
  }

  // Maps each port number to its interface label and group info.
  function portIndex(sw) {
    const map = new Map();
    let i = 0;
    sw.groups.forEach((g, gi) => {
      for (let n = 0; n < g.count && i < sw.ports.length; n++, i++) {
        const p = sw.ports[i];
        map.set(p.num, { gi, speed: g.speed, media: g.media, label: `${ABBR[g.speed]} ${sw.unit}/${p.num}` });
      }
    });
    return map;
  }

  // Resizes sw.ports to match sw.groups, keeping existing data by position.
  function rebuildPorts(sw) {
    const total = sw.groups.reduce((n, g) => n + g.count, 0);
    sw.ports = Array.from({ length: total }, (_, i) =>
      Object.assign(sw.ports[i] || blankPort(0), { num: sw.firstPort + i }));
  }

  const hasData = p => TEXT_FIELDS.some(k => p[k]) || p.hosts.length > 0;
  const groupsText = groups => groups.map(g => `${g.count}× ${g.speed} ${g.media}`).join(', ');
  const selPorts = () => (cur() ? cur().ports.filter(p => ui.selected.has(p.num)) : []);

  function usedVlans(sw) {
    const ids = new Set(Object.keys(sw.vlans).map(Number));
    for (const p of sw.ports) {
      for (const v of OS9.expandVlans(p.untagged)) ids.add(v);
      for (const v of OS9.expandVlans(p.tagged)) ids.add(v);
    }
    return [...ids].sort((a, b) => a - b);
  }

  const vlanColor = (sw, id) => (sw.vlans[id] && sw.vlans[id].color) || AUTO_COLORS[id % AUTO_COLORS.length];
  const poNum = p => { const m = /(\d+)/.exec(p.portChannel); return m ? +m[1] : null; };
  const statusOf = p => (p.admin === 'down' ? 'admin-down' : p.link);
  const STRIPES = 'repeating-linear-gradient(45deg, #4a5262 0 5px, #323845 5px 10px)';

  function portFill(sw, p) {
    let bg = '';
    if (sw.colorBy === 'vlan') {
      const u = OS9.expandVlans(p.untagged)[0];
      if (u != null) bg = vlanColor(sw, u);
      else if (p.tagged) return { background: STRIPES, color: '#fff' };
    } else if (sw.colorBy === 'status') bg = STATUS_COLORS[statusOf(p)] || '';
    else if (sw.colorBy === 'mode') bg = (MODES.find(m => m[0] === p.mode) || [])[2] || '';
    else if (sw.colorBy === 'po') bg = poNum(p) == null ? '' : AUTO_COLORS[poNum(p) % AUTO_COLORS.length];
    else bg = p.color;
    return bg ? { background: bg, color: textOn(bg) } : {};
  }

  function portSub(p) {
    if (p.mode === 'routed' || (p.ip && !p.untagged && !p.tagged)) return 'L3';
    if (p.untagged && p.tagged) return `${p.untagged}+T`;
    if (p.untagged) return String(p.untagged);
    if (p.tagged) return 'trunk';
    return '';
  }

  // Last four hex digits of a MAC, e.g. "01:0a".
  function macTail(mac) {
    const hex = String(mac || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
    return hex.length >= 4 ? `${hex.slice(-4, -2)}:${hex.slice(-2)}` : '';
  }

  const vlanLabel = (sw, id) => (sw.vlans[id] && sw.vlans[id].name ? `${id} (${sw.vlans[id].name})` : String(id));

  function vlanList(sw, text) {
    const ids = OS9.expandVlans(text);
    return ids.length && ids.length <= 16 ? ids.map(id => vlanLabel(sw, id)).join(', ') : text;
  }

  // The hover card: everything recorded for one port.
  function showTip(target, sw, p, info) {
    const tip = $('#tip');
    const state = [p.admin && `admin ${p.admin}`, p.link && `link ${p.link}`].filter(Boolean).join(', ');
    const rows = [
      ['Description', p.description],
      ['Connected to', p.connectedTo],
      ['Mode', (MODES.find(m => m[0] === p.mode) || [])[1]],
      ['Untagged VLAN', vlanList(sw, p.untagged)],
      ['Tagged VLANs', vlanList(sw, p.tagged)],
      ['Interface IP', p.ip],
      ['Port-channel', p.portChannel],
      ['State', state],
      ['Speed', p.speed],
      ['MTU', p.mtu],
      ['Color', p.color && (sw.colorLabels[p.color] || (PALETTE.find(c => c[0] === p.color) || [])[1] || p.color)],
      ['Notes', p.notes],
    ].filter(r => r[1]);
    const kids = [h('h3', {}, info.label, h('span', {}, `${info.speed} ${info.media}`))];
    if (rows.length) kids.push(h('dl', {}, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));
    if (p.hosts.length) {
      kids.push(h('div', { class: 'tip-sec' }, `Devices (${p.hosts.length})`),
        h('table', { class: 'mono' }, p.hosts.slice(0, 20).map(d => h('tr', {},
          h('td', {}, d.mac || '—'), h('td', {}, d.ip || ''), h('td', {}, d.vlan ? `VLAN ${d.vlan}` : ''), h('td', {}, d.name || '')))));
      if (p.hosts.length > 20) kids.push(h('div', { class: 'muted' }, `…and ${p.hosts.length - 20} more`));
    }
    if (!rows.length && !p.hosts.length) kids.push(h('div', { class: 'muted' }, 'Nothing recorded for this port yet.'));
    tip.replaceChildren(...kids);
    tip.classList.add('show');

    const r = target.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.bottom + 8;
    if (top + t.height > window.innerHeight - 8) top = Math.max(8, r.top - t.height - 8);
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - t.width - 8)) + 'px';
    tip.style.top = top + 'px';
  }

  const hideTip = () => $('#tip').classList.remove('show');

  function matches(p, info, q) {
    if (!q) return true;
    const hay = [info.label, ...TEXT_FIELDS.map(k => p[k]),
      ...p.hosts.flatMap(d => [d.mac, d.ip, d.name, d.vlan])].join('\n').toLowerCase();
    return hay.includes(q);
  }

  // ---------- rendering ----------
  function render(skip) {
    if (!skip) { renderTabs(); renderHeader(); }
    renderFace();
    if (skip !== 'legend') renderLegend();
    renderTable();
    if (skip !== 'editor') renderEditor();
    $('#btn-undo').disabled = !undoStack.length;
    $('#btn-csv').disabled = $('#btn-save').disabled = !doc.switches.length;
  }

  function renderTabs() {
    $('#tabs').replaceChildren(
      ...doc.switches.map((sw, i) => h('button', {
        class: i === ui.sw ? 'active' : '',
        onclick: () => { ui.sw = i; ui.selected.clear(); render(); },
      }, sw.name || 'Unnamed')),
      h('button', { title: 'Add a switch', onclick: () => openSwitchDialog(null) }, '+ Add switch'));
  }

  function renderHeader() {
    const sw = cur();
    const el = $('#sw-header');
    if (!sw) {
      el.replaceChildren(h('div', { class: 'welcome' },
        h('h1', {}, 'Map your switch ports'),
        h('p', { class: 'muted' }, 'Lay out a switch by hand, or paste Dell OS9 output and let it build the map for you.'),
        h('div', { class: 'row' },
          h('button', { class: 'primary', onclick: () => openSwitchDialog(null) }, 'New switch'),
          h('button', { onclick: openImportDialog }, 'Import OS9 output…'),
          h('button', { onclick: () => $('#file-open').click() }, 'Open a saved map…'))));
      return;
    }
    el.replaceChildren(h('div', { class: 'sw-head' },
      h('div', { class: 'title' },
        h('h1', {}, sw.name),
        h('div', { class: 'muted' }, [sw.model, groupsText(sw.groups), `unit ${sw.unit}`].filter(Boolean).join(' · '))),
      h('div', { class: 'controls' },
        h('label', {}, 'Color by',
          select(COLOR_BY, sw.colorBy, { onchange: e => commit(() => { sw.colorBy = e.target.value; }) })),
        h('label', { class: 'toggle', title: 'Make ports taller and show the last four digits of each MAC address' },
          h('input', { type: 'checkbox', checked: sw.showMac, onchange: e => commit(() => { sw.showMac = e.target.checked; }) }),
          'Show MACs'),
        h('input', { type: 'search', placeholder: 'Filter ports…', value: ui.filter,
          oninput: e => { ui.filter = e.target.value; renderFace(); renderTable(); } }),
        h('button', { onclick: () => openSwitchDialog(sw) }, 'Edit switch…'),
        h('button', { class: 'danger', onclick: deleteSwitch }, 'Delete'))));
  }

  function renderFace() {
    const sw = cur();
    const el = $('#face');
    hideTip();
    if (!sw) { el.replaceChildren(); return; }
    const index = portIndex(sw);
    const q = ui.filter.trim().toLowerCase();
    let i = 0;
    const groups = sw.groups.map(g => {
      const ports = sw.ports.slice(i, i + g.count);
      i += g.count;
      const range = ports.length ? `${ports[0].num}–${ports[ports.length - 1].num}` : '';
      return h('div', { class: 'pgroup' },
        h('div', { class: `pgrid rows-${sw.rows}` + (sw.showMac ? ' expanded' : '') }, ports.map(p => {
          const info = index.get(p.num);
          const st = statusOf(p);
          const tails = sw.showMac ? p.hosts.map(d => macTail(d.mac)).filter(Boolean) : [];
          const show = e => showTip(e.currentTarget, sw, p, info);
          return h('button', {
            class: 'port' + (g.media.startsWith('QSFP') ? ' wide' : '') +
              (ui.selected.has(p.num) ? ' selected' : '') + (matches(p, info, q) ? '' : ' dim'),
            style: portFill(sw, p),
            'aria-label': info.label + (p.description ? `, ${p.description}` : ''),
            onclick: e => selectPort(p.num, e),
            onmouseenter: show, onmouseleave: hideTip, onfocus: show, onblur: hideTip,
          },
          h('span', { class: 'num' }, String(p.num)),
          h('span', { class: 'sub' }, portSub(p)),
          tails.slice(0, tails.length > 2 ? 1 : 2).map(t => h('span', { class: 'mac' }, t)),
          tails.length > 2 && h('span', { class: 'mac' }, `+${tails.length - 1}`),
          st && h('i', { class: 'dot ' + st }));
        })),
        h('div', { class: 'pgroup-cap' }, `${range} · ${g.speed} ${g.media}`));
    });
    el.replaceChildren(h('div', { class: 'chassis' }, h('div', { class: 'groups' }, groups)));
  }

  function chip(color, ...kids) {
    return h('span', { class: 'chip' }, h('span', { class: 'sw', style: { background: color } }), ...kids);
  }

  function renderLegend() {
    const sw = cur();
    const el = $('#legend');
    if (!sw) { el.replaceChildren(); return; }
    const items = [];
    if (sw.colorBy === 'custom') {
      items.push(h('span', { class: 'lg-title' }, 'Color meanings'));
      for (const [c, name] of PALETTE) {
        items.push(chip(c, h('input', { type: 'text', placeholder: name, value: sw.colorLabels[c] || '',
          'aria-label': `Meaning of ${name}`,
          onchange: e => commit(() => { sw.colorLabels[c] = e.target.value.trim(); }, 'legend') })));
      }
    } else if (sw.colorBy === 'vlan') {
      items.push(h('span', { class: 'lg-title' }, 'VLANs'));
      const inUse = new Set(sw.ports.flatMap(p => [...OS9.expandVlans(p.untagged), ...OS9.expandVlans(p.tagged)]));
      const entry = id => sw.vlans[id] || (sw.vlans[id] = {});
      for (const id of usedVlans(sw)) {
        items.push(h('span', { class: 'chip' },
          h('input', { type: 'color', value: vlanColor(sw, id), title: 'Change color',
            onchange: e => commit(() => { entry(id).color = e.target.value; }, 'legend') }),
          h('b', {}, String(id)),
          h('input', { type: 'text', placeholder: 'name', value: (sw.vlans[id] && sw.vlans[id].name) || '',
            'aria-label': `Name of VLAN ${id}`,
            onchange: e => commit(() => { entry(id).name = e.target.value.trim(); }, 'legend') }),
          !inUse.has(id) && h('button', { class: 'x', title: 'Remove unused VLAN',
            onclick: () => commit(() => { delete sw.vlans[id]; }) }, '×')));
      }
      const add = h('input', { type: 'number', min: 1, max: 4094, placeholder: 'VLAN ID' });
      const doAdd = () => {
        const id = parseInt(add.value, 10);
        if (id >= 1 && id <= 4094) commit(() => { sw.vlans[id] = sw.vlans[id] || {}; });
      };
      add.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
      items.push(h('span', { class: 'add' }, add, h('button', { onclick: doAdd }, 'Add')));
      items.push(chip(STRIPES, 'tagged only'));
    } else if (sw.colorBy === 'status') {
      items.push(h('span', { class: 'lg-title' }, 'Link'),
        chip(STATUS_COLORS.up, 'Up'), chip(STATUS_COLORS.down, 'Down'), chip(STATUS_COLORS['admin-down'], 'Admin down'));
    } else if (sw.colorBy === 'mode') {
      items.push(h('span', { class: 'lg-title' }, 'Mode'), ...MODES.map(m => chip(m[2], m[1])));
    } else {
      items.push(h('span', { class: 'lg-title' }, 'Port-channels'));
      const ids = [...new Set(sw.ports.map(poNum).filter(n => n != null))].sort((a, b) => a - b);
      items.push(...ids.map(n => chip(AUTO_COLORS[n % AUTO_COLORS.length], `Po${n}`)));
      if (!ids.length) items.push(h('span', { class: 'muted' }, 'No ports are in a port-channel yet.'));
    }
    el.replaceChildren(h('div', { class: 'legend' }, items));
  }

  function renderTable() {
    const sw = cur();
    const el = $('#table');
    if (!sw || !sw.ports.length) { el.replaceChildren(); return; }
    const index = portIndex(sw);
    const q = ui.filter.trim().toLowerCase();
    const rows = sw.ports.filter(p => matches(p, index.get(p.num), q)).map(p => {
      const fill = portFill(sw, p);
      return h('tr', { class: ui.selected.has(p.num) ? 'selected' : '', onclick: e => selectPort(p.num, e) },
        h('td', { class: 'mono' },
          h('span', { class: 'swatch', style: { background: fill.background || 'transparent' } }), index.get(p.num).label),
        h('td', {}, p.description),
        h('td', {}, p.connectedTo),
        h('td', {}, p.mode),
        h('td', {}, p.untagged),
        h('td', {}, p.tagged),
        h('td', { class: 'mono' }, p.ip),
        h('td', {}, p.portChannel),
        h('td', {}, statusOf(p)),
        h('td', { class: 'mono wrap' }, p.hosts.map(d => h('div', {}, [d.mac, d.ip, d.name].filter(Boolean).join('  ')))));
    });
    const head = ['Port', 'Description', 'Connected to', 'Mode', 'Untagged', 'Tagged', 'IP', 'Po', 'Link', 'Devices (MAC / IP)'];
    el.replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, head.map(t => h('th', {}, t)))),
      h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: head.length, class: 'muted' }, 'No ports match the filter.'))))));
  }

  // ---------- selection ----------
  function selectPort(num, e) {
    const sw = cur();
    if (e.shiftKey && ui.anchor != null) {
      const nums = sw.ports.map(p => p.num);
      const [a, b] = [nums.indexOf(ui.anchor), nums.indexOf(num)].sort((x, y) => x - y);
      if (a >= 0) for (const n of nums.slice(a, b + 1)) ui.selected.add(n);
    } else if (e.metaKey || e.ctrlKey) {
      if (ui.selected.has(num)) ui.selected.delete(num); else ui.selected.add(num);
      ui.anchor = num;
    } else {
      const only = ui.selected.size === 1 && ui.selected.has(num);
      ui.selected.clear();
      if (!only) ui.selected.add(num);
      ui.anchor = num;
    }
    renderFace(); renderTable(); renderEditor();
  }

  // ---------- port editor ----------
  const UPDOWN = [['', '—'], ['up', 'Up'], ['down', 'Down']];
  const FIELDS = [
    { k: 'description', label: 'Description', ph: 'e.g. esxi-01 vmnic0' },
    { k: 'connectedTo', label: 'Connected to', ph: 'device / remote port' },
    { k: 'mode', label: 'Mode', options: [['', '—'], ...MODES.map(m => [m[0], m[1]])] },
    { k: 'portChannel', label: 'Port-channel', ph: 'Po10' },
    { k: 'untagged', label: 'Untagged VLAN', ph: '10' },
    { k: 'tagged', label: 'Tagged VLANs', ph: '20-22,30' },
    { k: 'ip', label: 'Interface IP', ph: '10.0.0.1/24', wide: true },
    { k: 'admin', label: 'Admin state', options: UPDOWN },
    { k: 'link', label: 'Link', options: UPDOWN },
    { k: 'speed', label: 'Speed', ph: '10G' },
    { k: 'mtu', label: 'MTU', ph: '1500' },
    { k: 'notes', label: 'Notes', textarea: true, wide: true },
  ];
  const WIDE = new Set(['description', 'connectedTo', 'ip', 'notes']);

  function cleanField(k, v) {
    v = v.trim();
    if (k === 'tagged') {
      const ids = OS9.expandVlans(v);
      return ids.length ? OS9.compressVlans(ids) : v;
    }
    if (k === 'portChannel' && /^\d+$/.test(v)) return 'Po' + v;
    return v;
  }

  function renderEditor() {
    const el = $('#editor');
    const sw = cur();
    if (!sw) { el.replaceChildren(); return; }
    const ports = selPorts();
    if (!ports.length) {
      el.replaceChildren(h('h2', {}, 'No port selected'),
        h('p', { class: 'muted' }, 'Click a port to edit it. Shift-click selects a range; Ctrl/⌘-click adds or removes single ports. Edits apply to every selected port.'));
      return;
    }
    const index = portIndex(sw);
    const multi = ports.length > 1;
    const common = k => {
      const vals = new Set(ports.map(p => p[k] || ''));
      return vals.size === 1 ? { value: [...vals][0], mixed: false } : { value: '', mixed: true };
    };
    const setAll = (k, v) => commit(() => { for (const p of ports) p[k] = v; }, 'editor');

    const field = f => {
      const c = common(f.k);
      const onchange = e => {
        const v = cleanField(f.k, e.target.value);
        if (!f.options) e.target.value = v;
        setAll(f.k, v);
      };
      let input;
      if (f.options) {
        input = select(c.mixed ? [['__mixed', '(mixed)'], ...f.options] : f.options, c.mixed ? '__mixed' : c.value, { onchange });
      } else {
        input = h(f.textarea ? 'textarea' : 'input', { type: f.textarea ? null : 'text', rows: f.textarea ? 3 : null,
          value: c.value, placeholder: c.mixed ? '(mixed)' : f.ph || '', onchange });
      }
      return h('label', { class: 'field' }, h('span', {}, f.label), input);
    };

    const body = [];
    for (let i = 0; i < FIELDS.length; i++) {
      const f = FIELDS[i];
      if (WIDE.has(f.k)) body.push(field(f));
      else body.push(h('div', { class: 'field-row' }, field(f), field(FIELDS[++i])));
    }

    const color = common('color');
    const swatches = h('div', { class: 'swatches' },
      h('button', { class: 'none' + (!color.mixed && !color.value ? ' on' : ''), title: 'No color',
        onclick: () => { setAll('color', ''); renderEditor(); } }),
      PALETTE.map(([c, name]) => h('button', {
        class: color.value === c ? 'on' : '', style: { background: c }, title: sw.colorLabels[c] || name,
        onclick: () => { setAll('color', c); renderEditor(); },
      })),
      h('input', { type: 'color', title: 'Other color', value: /^#[0-9a-f]{6}$/i.test(color.value) ? color.value : '#888888',
        onchange: e => { setAll('color', e.target.value); renderEditor(); } }));

    const out = [
      h('h2', {}, multi ? `${ports.length} ports selected` : index.get(ports[0].num).label),
      h('div', { class: 'sub' }, multi
        ? 'Changes apply to all selected ports.'
        : `${index.get(ports[0].num).speed} ${index.get(ports[0].num).media}`),
      h('div', { class: 'section-label' }, 'Color'),
      swatches,
      ...body,
    ];
    if (sw.colorBy !== 'custom' && !color.mixed && color.value) {
      out.splice(4, 0, h('p', { class: 'muted', style: { marginBottom: '10px' } },
        'Custom colors show when “Color by” is set to Custom colors.'));
    }

    if (!multi) {
      const p = ports[0];
      const hostInput = (d, k, ph) => h('input', { type: 'text', value: d[k] == null ? '' : d[k], placeholder: ph, 'aria-label': ph,
        onchange: e => {
          const v = k === 'mac' ? OS9.normMac(e.target.value) : e.target.value.trim();
          e.target.value = v;
          commit(() => { d[k] = v; }, 'editor');
        } });
      out.push(h('div', { class: 'section-label' }, `Devices on this port (${p.hosts.length})`),
        h('div', { class: 'hosts' }, p.hosts.map((d, i) => h('div', { class: 'host' },
          hostInput(d, 'mac', 'MAC address'), hostInput(d, 'ip', 'IP address'),
          h('button', { class: 'x', title: 'Remove device', onclick: () => commit(() => { p.hosts.splice(i, 1); }) }, '×'),
          hostInput(d, 'name', 'Name'), hostInput(d, 'vlan', 'VLAN')))),
        h('button', { onclick: () => commit(() => { p.hosts.push({ mac: '', ip: '', vlan: '', name: '' }); }) }, '+ Add device'));
    }
    out.push(h('div', { class: 'editor-actions' },
      h('button', { class: 'danger', onclick: () => ask(
        `Clear all data on ${multi ? `these ${ports.length} ports` : 'this port'}?`, 'Clear',
        () => commit(() => { for (const p of ports) Object.assign(p, blankPort(p.num)); })),
      }, multi ? 'Clear ports' : 'Clear port')));
    el.replaceChildren(...out);
  }

  // ---------- switch dialog ----------
  // "24x 10 Gb SFP, 6x 40Gb QSFP" -> port groups
  function parseQuick(text) {
    const groups = [];
    const re = /(\d+)\s*[x×*]\s*(\d+)\s*(g|m)[a-z]*(?:[\s\-]+([a-z0-9+\-]+))?/gi;
    let m;
    while ((m = re.exec(text))) {
      const speed = m[3].toLowerCase() === 'm' ? `${+m[2] / 1000}G` : `${+m[2]}G`;
      if (!SPEEDS.includes(speed) || +m[1] < 1) continue;
      const t = (m[4] || '').toLowerCase();
      let media = DEFAULT_MEDIA[speed];
      if (/qsfp28/.test(t)) media = 'QSFP28';
      else if (/qsfp/.test(t)) media = speed === '100G' || speed === '50G' ? 'QSFP28' : 'QSFP+';
      else if (/sfp28/.test(t)) media = 'SFP28';
      else if (/sfp/.test(t)) media = speed === '25G' ? 'SFP28' : speed === '1G' ? 'SFP' : 'SFP+';
      else if (/rj|base|copper|^t$/.test(t)) media = 'RJ45';
      groups.push({ count: +m[1], speed, media });
    }
    return groups;
  }

  function openDialog(...content) {
    const dlg = $('#dlg');
    dlg.replaceChildren(...content);
    if (!dlg.open) dlg.showModal();
    return dlg;
  }

  function openSwitchDialog(existing) {
    const draft = existing
      ? { name: existing.name, model: existing.model, unit: existing.unit, firstPort: existing.firstPort,
        rows: existing.rows, groups: existing.groups.map(g => ({ ...g })) }
      : { name: '', model: '', unit: 1, firstPort: 1, rows: 2, groups: [] };

    const rowsEl = h('div', {});
    const totalEl = h('span', { class: 'muted' });
    const drawGroups = () => {
      rowsEl.replaceChildren(...draft.groups.map((g, i) => h('div', { class: 'grp-row' },
        h('input', { type: 'number', min: 1, max: 256, value: g.count, 'aria-label': 'Port count',
          oninput: e => { g.count = Math.max(0, parseInt(e.target.value, 10) || 0); drawTotal(); } }),
        select(SPEEDS.map(s => [s, s]), g.speed, { 'aria-label': 'Speed',
          onchange: e => { g.speed = e.target.value; g.media = DEFAULT_MEDIA[g.speed]; drawGroups(); } }),
        select(MEDIA.map(s => [s, s]), g.media, { 'aria-label': 'Connector', onchange: e => { g.media = e.target.value; } }),
        h('button', { class: 'x', title: 'Remove group', onclick: () => { draft.groups.splice(i, 1); drawGroups(); } }, '×'))));
      drawTotal();
    };
    const drawTotal = () => {
      const n = draft.groups.reduce((s, g) => s + g.count, 0);
      totalEl.textContent = n ? `${n} ports total` : 'No port groups yet';
    };
    drawGroups();

    const modelInput = h('input', { type: 'text', value: draft.model, placeholder: 'e.g. S4048-ON',
      oninput: e => { draft.model = e.target.value; } });
    const quick = h('input', { type: 'text', placeholder: '24x 10Gb SFP+, 6x 40Gb QSFP+',
      oninput: e => {
        const g = parseQuick(e.target.value);
        if (g.length) { draft.groups = g; drawGroups(); }
      } });
    const preset = select([['', 'Preset…'], ...Object.keys(PRESETS).map(k => [k, k])], '', {
      style: { width: 'auto' },
      onchange: e => {
        const p = PRESETS[e.target.value];
        if (!p) return;
        draft.groups = p.map(([count, speed, media]) => ({ count, speed, media }));
        draft.model = modelInput.value = e.target.value;
        drawGroups();
      } });

    const save = () => {
      draft.groups = draft.groups.filter(g => g.count > 0);
      const total = draft.groups.reduce((s, g) => s + g.count, 0);
      if (!total) { toast('Add at least one port group.'); return; }
      if (total > 512) { toast('That is more than 512 ports — check the counts.'); return; }
      const apply = () => {
        commit(() => {
        const sw = existing || newSwitch();
        Object.assign(sw, {
          name: draft.name.trim() || draft.model.trim() || 'Switch',
          model: draft.model.trim(), unit: draft.unit, firstPort: draft.firstPort, rows: draft.rows, groups: draft.groups,
        });
        rebuildPorts(sw);
        if (!existing) { doc.switches.push(sw); ui.sw = doc.switches.length - 1; }
        ui.selected.clear();
        });
        $('#dlg').close();
      };
      if (existing && existing.ports.slice(total).some(hasData)) {
        ask('This removes ports that have data on them.', 'Remove ports', apply);
      } else apply();
    };

    const num = (k, min) => h('input', { type: 'number', min, value: draft[k],
      oninput: e => { draft[k] = Math.max(min, parseInt(e.target.value, 10) || 0); } });

    openDialog(
      h('h2', {}, existing ? 'Edit switch' : 'New switch'),
      h('p', { class: 'hint' }, 'Describe the front panel as groups of ports, left to right.'),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', {}, 'Name'),
          h('input', { type: 'text', value: draft.name, placeholder: 'e.g. rack1-tor-a', oninput: e => { draft.name = e.target.value; } })),
        h('label', { class: 'field' }, h('span', {}, 'Model'), modelInput)),
      h('label', { class: 'field' }, h('span', {}, 'Quick entry'), quick),
      h('div', { class: 'section-label' }, 'Port groups (count · speed · connector)'),
      rowsEl,
      h('div', { class: 'inline-row' },
        h('button', { onclick: () => { draft.groups.push({ count: 24, speed: '10G', media: 'SFP+' }); drawGroups(); } }, '+ Add group'),
        preset, totalEl),
      h('div', { class: 'field-row' },
        h('label', { class: 'field' }, h('span', {}, 'Stack unit (the “1” in Te 1/5)'), num('unit', 0)),
        h('label', { class: 'field' }, h('span', {}, 'First port number'), num('firstPort', 0))),
      h('label', { class: 'field' }, h('span', {}, 'Faceplate rows'),
        select([['2', 'Two rows (odd on top, even below)'], ['1', 'Single row']], String(draft.rows),
          { onchange: e => { draft.rows = +e.target.value; } })),
      h('div', { class: 'foot' },
        h('button', { onclick: () => $('#dlg').close() }, 'Cancel'),
        h('button', { class: 'primary', onclick: save }, existing ? 'Save changes' : 'Create switch')));
    (existing ? modelInput : quick).focus();
  }

  function deleteSwitch() {
    const sw = cur();
    if (!sw) return;
    ask(`Delete “${sw.name}” and all its port data?`, 'Delete', () => commit(() => {
      doc.switches.splice(ui.sw, 1);
      ui.sw = Math.max(0, ui.sw - 1);
      ui.selected.clear();
    }));
  }

  // ---------- OS9 import ----------
  let sshLogin = ''; // remembered while the page is open

  // A button that copies text. If the clipboard is refused it selects `node`
  // instead, so the usual copy shortcut works.
  function copyButton(label, getText, node) {
    const btn = h('button', { onclick: async () => {
      try {
        await navigator.clipboard.writeText(getText());
        btn.textContent = 'Copied';
      } catch (e) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        btn.textContent = 'Selected — now copy';
      }
      setTimeout(() => { btn.textContent = label; }, 2500);
    } }, label);
    return btn;
  }

  // show running-config goes last so its VLAN names and full descriptions
  // win over the shortened ones in the tables.
  const OS9_COMMANDS = ['terminal length 0', 'show vlan', 'show lldp neighbors', 'show arp',
    'show interfaces status', 'show mac-address-table', 'show running-config'];

  function applyImport(sw, R, opts) {
    const stats = { matched: 0, unmatched: 0, hosts: 0, skipped: 0 };
    if (opts.setLayout) {
      const L = OS9.layoutFrom(R);
      if (L) {
        Object.assign(sw, { unit: L.unit, firstPort: L.firstPort, groups: L.groups });
        rebuildPorts(sw);
      }
    }
    const byKey = new Map(sw.ports.map(p => [`${sw.unit}/${p.num}`, p]));
    for (const src of Object.values(R.ports)) {
      const p = byKey.get(src.key);
      if (!p) { stats.unmatched++; continue; }
      stats.matched++;
      const set = (k, v) => {
        if (v == null || v === '') return;
        // `show interfaces status` cuts descriptions short; keep a fuller one.
        if (k === 'description' && p[k].length > String(v).length && p[k].startsWith(v)) return;
        if (opts.overwrite || !p[k]) p[k] = String(v);
      };
      set('description', src.description);
      set('connectedTo', src.neighbor);
      set('mode', src.mode);
      set('untagged', src.untagged);
      set('tagged', OS9.compressVlans(src.tagged));
      set('ip', src.ip);
      set('portChannel', src.portChannel != null ? `Po${src.portChannel}` : '');
      set('admin', src.admin);
      set('link', src.link);
      set('speed', src.speed);
      set('mtu', src.mtu);

      if (src.hosts.length > opts.maxHosts) {
        stats.skipped++;
        const note = `${src.hosts.length} MAC addresses learned here (not imported — likely an uplink).`;
        p.notes = [p.notes.replace(/\d+ MAC addresses learned here[^\n]*\n?/, '').trim(), note].filter(Boolean).join('\n');
        continue;
      }
      for (const d of src.hosts) {
        const prev = p.hosts.find(x => x.mac === d.mac);
        if (prev) {
          if (d.ip && (opts.overwrite || !prev.ip)) prev.ip = d.ip;
          if (d.vlan && (opts.overwrite || !prev.vlan)) prev.vlan = String(d.vlan);
        } else {
          p.hosts.push({ mac: d.mac, ip: d.ip || '', vlan: d.vlan ? String(d.vlan) : '', name: '' });
          stats.hosts++;
        }
      }
    }
    for (const v of Object.values(R.vlans)) {
      const entry = sw.vlans[v.id] || (sw.vlans[v.id] = {});
      if (v.name && (opts.overwrite || !entry.name)) entry.name = v.name;
    }
    return stats;
  }

  function openImportDialog() {
    const NEW = '__new';
    const state = { target: cur() ? cur().id : NEW, overwrite: true, setLayout: false, layoutTouched: false, maxHosts: 10, R: null };
    const preview = h('div', { class: 'preview muted' });
    const layoutBox = h('input', { type: 'checkbox', onchange: e => { state.setLayout = e.target.checked; state.layoutTouched = true; update(); } });
    const applyBtn = h('button', { class: 'primary' }, 'Import');
    const text = h('textarea', { class: 'paste', spellcheck: false,
      placeholder: 'Paste the terminal output here' });

    // One line for a terminal on the visitor's own computer. It hands the
    // session to them until the # prompt appears, then sends each command
    // only after the previous one's prompt has come back.
    const loginOk = v => /^([\w.\-]+@)?[\w.\-:]+$/.test(v);
    const sshLine = login => `expect -c 'set timeout 120; spawn ssh ${login}; ` +
      `interact -o -nobuffer -re {(^|[\\r\\n])[\\w.\\-]+#$} return; ` +
      `foreach c {${OS9_COMMANDS.map(c => `"${c}"`).join(' ')}} {send "$c\\r"; expect -re {[\\r\\n][\\w.\\-]+#$}}; ` +
      `send "exit\\r"; expect eof'`;
    const cmds = h('pre', { class: 'mono' });
    const copyBtn = copyButton('Copy command', () => sshLine(sshLogin) + '\n', cmds);
    const drawCmd = () => {
      const ok = loginOk(sshLogin);
      cmds.textContent = sshLine(ok ? sshLogin : 'admin@switch-address');
      cmds.classList.toggle('muted', !ok);
      copyBtn.disabled = !ok;
    };
    const loginInput = h('input', { type: 'text', value: sshLogin, placeholder: 'admin@10.0.0.2', spellcheck: false,
      autocapitalize: 'off', 'aria-label': 'Switch login, as user@address',
      oninput: e => { sshLogin = e.target.value.trim(); drawCmd(); } });
    drawCmd();

    const targetSwitch = () => doc.switches.find(s => s.id === state.target) || null;

    const update = () => {
      const R = state.R = OS9.parse(text.value);
      const n = Object.keys(R.ports).length;
      const sw = targetSwitch();
      const L = OS9.layoutFrom(R);
      const complete = R.sections.some(s => /running-config|interfaces/.test(s));
      const matched = sw ? Object.keys(R.ports).filter(k => {
        const [u, num] = k.split('/').map(Number);
        return u === sw.unit && sw.ports.some(p => p.num === num);
      }).length : 0;

      // Default the layout option on when the output lists every interface and
      // the target has no layout or mostly doesn't line up with it.
      if (!state.layoutTouched) state.setLayout = !!L && complete && (!sw || !sw.ports.length || matched < n * 0.6);
      if (!sw) state.setLayout = true;
      layoutBox.checked = state.setLayout;
      layoutBox.disabled = !sw || !L;

      applyBtn.disabled = !n;
      preview.className = 'preview' + (n ? '' : ' muted');
      if (!text.value.trim()) { preview.textContent = 'Paste output above to see what will be imported.'; return; }
      if (!n) { preview.textContent = 'No OS9 interface data recognised yet.'; return; }
      const lines = [
        `Found: ${R.sections.map(s => 'show ' + s).join(', ')}` + (R.hostname ? ` — from ${R.hostname}` : ''),
        `${n} interfaces, ${Object.keys(R.vlans).length} VLANs, ${Object.keys(R.portChannels).length} port-channels, ${R.hostCount} MAC entries.`,
      ];
      if (state.setLayout && L) lines.push(`Port layout will be set to ${groupsText(L.groups)} (unit ${L.unit}, first port ${L.firstPort}).`);
      else if (sw) {
        lines.push(`${matched} of ${n} interfaces match ports on “${sw.name}”.`);
        if (matched < n) {
          preview.classList.add('warn');
          lines.push(`${n - matched} will be skipped — check the stack unit and port count under Edit switch, or tick “Set the port layout”.`);
        }
      }
      preview.replaceChildren(...lines.map(l => h('div', {}, l)));
    };
    text.addEventListener('input', update);

    const file = h('input', { type: 'file', accept: '.txt,.log,.cfg,.conf,text/plain', hidden: true,
      onchange: async e => {
        if (e.target.files[0]) { text.value = await e.target.files[0].text(); update(); }
      } });

    applyBtn.addEventListener('click', () => {
      const R = state.R;
      let stats;
      commit(() => {
        let sw = targetSwitch();
        if (!sw) {
          sw = newSwitch();
          sw.name = R.hostname || 'Imported switch';
          sw.colorBy = 'vlan';
          doc.switches.push(sw);
        } else if (R.hostname && /^(New switch|Switch)$/.test(sw.name)) sw.name = R.hostname;
        if (R.model && !sw.model) sw.model = R.model;
        ui.sw = doc.switches.indexOf(sw);
        ui.selected.clear();
        stats = applyImport(sw, R, state);
      });
      $('#dlg').close();
      toast(`Imported ${stats.matched} ports and ${stats.hosts} devices` +
        (stats.unmatched ? `; ${stats.unmatched} interfaces had no matching port` : '') +
        (stats.skipped ? `; MACs skipped on ${stats.skipped} busy ports` : '') + '.');
    });

    openDialog(
      h('h2', {}, 'Import Dell OS9 output'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Enter how you log in to the switch over SSH, as user@address.', h('div', { class: 'login-row' }, loginInput)),
        h('li', {}, 'Open a new terminal window on your Mac or Linux computer and paste this command.',
          h('div', { class: 'cmd-block' }, cmds, copyBtn),
          'Log in as usual. If you land at a ', h('code', {}, '>'), ' prompt, type ', h('code', {}, 'enable'),
          '. Once the ', h('code', {}, '#'), ' prompt appears it runs each show command in turn and logs out.'),
        h('li', {}, 'Select all of the terminal output, copy it, and paste it below.')),
      h('details', { class: 'manual' },
        h('summary', {}, 'On Windows, PuTTY or a serial console? Run the commands by hand'),
        h('p', {}, 'At the ', h('code', {}, '#'), ' prompt, paste one command, wait for the prompt to come back, then paste the next. The switch drops anything it receives while it is still printing, so pasting them all at once loses commands.'),
        h('div', { class: 'cmd-list' }, OS9_COMMANDS.map(c => {
          const code = h('code', {}, c);
          return h('div', {}, code, copyButton('Copy', () => c + '\n', code));
        }))),
      h('p', { class: 'hint' }, 'Each import adds to the map, so you can also bring the output in a piece at a time. Nothing you paste leaves this browser.'),
      text, file,
      h('div', { class: 'inline-row' },
        h('button', { onclick: () => file.click() }, 'Choose a file…'),
        h('button', { onclick: () => { text.value = window.OS9_SAMPLE; update(); } }, 'Load sample'),
        h('label', { class: 'muted', style: { marginLeft: 'auto' } }, 'Import into '),
        select([...doc.switches.map(s => [s.id, s.name]), [NEW, 'A new switch']], state.target,
          { style: { width: 'auto' }, onchange: e => { state.target = e.target.value; state.layoutTouched = false; update(); } })),
      h('label', { class: 'check' }, layoutBox, 'Set the port layout from this output'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: true, onchange: e => { state.overwrite = e.target.checked; } }),
        'Overwrite values already on the map (untick to only fill blanks)'),
      h('label', { class: 'check' }, 'Skip MAC addresses on ports that have more than',
        h('input', { type: 'number', min: 1, value: state.maxHosts,
          oninput: e => { state.maxHosts = Math.max(1, parseInt(e.target.value, 10) || 1); } }),
        '(uplinks)'),
      preview,
      h('div', { class: 'foot' },
        h('button', { onclick: () => $('#dlg').close() }, 'Cancel'), applyBtn));
    update();
    text.focus();
  }

  // ---------- files ----------
  function saveFile() {
    if (!doc.switches.length) return;
    const name = doc.switches.length === 1 ? doc.switches[0].name : 'switch-map';
    download(`${slug(name)}.switchmap.json`, JSON.stringify({ ...doc, saved: new Date().toISOString() }, null, 2), 'application/json');
  }

  async function openFile(file) {
    let loaded = null;
    try {
      loaded = normalizeDoc(JSON.parse(await file.text()));
    } catch (e) { /* handled below */ }
    if (!loaded) { toast(`“${file.name}” is not a Switch Map file.`); return; }
    commit(() => { doc = loaded; ui.sw = 0; ui.selected.clear(); });
    toast(`Opened ${file.name} — ${doc.switches.length} switch${doc.switches.length === 1 ? '' : 'es'}.`);
  }

  function exportCsv() {
    const sw = cur();
    if (!sw) return;
    const index = portIndex(sw);
    // Leading = + - @ would be run as a formula by spreadsheet apps.
    const cell = v => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ['Switch', 'Port', 'Type', 'Description', 'Connected to', 'Mode', 'Untagged VLAN', 'Tagged VLANs', 'IP',
      'Port-channel', 'Admin', 'Link', 'Speed', 'MTU', 'MAC addresses', 'Device IPs', 'Device names', 'Color', 'Notes'];
    const rows = sw.ports.map(p => {
      const info = index.get(p.num);
      return [sw.name, info.label, `${info.speed} ${info.media}`, p.description, p.connectedTo, p.mode, p.untagged, p.tagged, p.ip,
        p.portChannel, p.admin, p.link, p.speed, p.mtu,
        p.hosts.map(d => d.mac).filter(Boolean).join('; '), p.hosts.map(d => d.ip).filter(Boolean).join('; '),
        p.hosts.map(d => d.name).filter(Boolean).join('; '), sw.colorLabels[p.color] || p.color, p.notes];
    });
    download(`${slug(sw.name)}.csv`, [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n', 'text/csv');
  }

  // ---------- wiring ----------
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-import').addEventListener('click', openImportDialog);
  $('#btn-open').addEventListener('click', () => $('#file-open').click());
  $('#btn-save').addEventListener('click', saveFile);
  $('#btn-csv').addEventListener('click', exportCsv);
  $('#file-open').addEventListener('change', e => {
    if (e.target.files[0]) openFile(e.target.files[0]);
    e.target.value = '';
  });
  window.addEventListener('scroll', hideTip, true);
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(); }
    else if (mod && e.key.toLowerCase() === 'z' && !typing && !$('#dlg').open) { e.preventDefault(); undo(); }
    else if (e.key === 'Escape' && !typing && !$('#dlg').open && ui.selected.size) {
      ui.selected.clear();
      renderFace(); renderTable(); renderEditor();
    }
  });

  doc = loadDoc();
  // The hosted demo opens on the sample switch instead of an empty page.
  if (window.SWITCHMAP_DEMO && !doc.switches.length) {
    const sw = Object.assign(newSwitch(), { name: 'S4048-LAB (example)', model: 'S4048-ON', colorBy: 'vlan', showMac: true });
    doc.switches.push(sw);
    applyImport(sw, OS9.parse(window.OS9_SAMPLE), { setLayout: true, overwrite: true, maxHosts: 10 });
  }
  render();
})();
