/* Dell OS9 (FTOS) CLI output parser.
 *
 * Accepts any mix of the following, pasted together in any order:
 *   show running-config            show vlan
 *   show interfaces status         show interfaces description
 *   show mac-address-table         show arp
 *   show lldp neighbors
 *
 * Ports are keyed "unit/port" (e.g. "1/49"); breakout sub-ports fold into
 * their parent port.
 */
(function (root) {
  'use strict';

  const TYPES = [
    { abbr: 'Gi', full: 'GigabitEthernet', speed: '1G' },
    { abbr: 'Te', full: 'TenGigabitEthernet', speed: '10G' },
    { abbr: 'Tf', full: 'TwentyFiveGigE', speed: '25G' },
    { abbr: 'Fo', full: 'fortyGigE', speed: '40G' },
    { abbr: 'Fi', full: 'fiftyGigE', speed: '50G' },
    { abbr: 'Hu', full: 'hundredGigE', speed: '100G' },
  ];
  const DEFAULT_MEDIA = { '1G': 'RJ45', '10G': 'SFP+', '25G': 'SFP28', '40G': 'QSFP+', '50G': 'QSFP28', '100G': 'QSFP28' };

  const PHYS = TYPES.map(t => t.full).concat(TYPES.map(t => t.abbr)).join('|');
  const ABBRS = TYPES.map(t => t.abbr).join('|');
  const PORT_ID = '\\d+\\/\\d+(?:\\/\\d+)?';
  const MAC = '(?:[0-9a-f]{2}[:\\-]){5}[0-9a-f]{2}|(?:[0-9a-f]{4}\\.){2}[0-9a-f]{4}';

  const RE = {
    prompt: /^([A-Za-z][\w.\-]*)(?:\([\w\-\/ ]+\))?[#>]\s*(.*)$/,
    iface: /^interface\s+(\S+)\s+(\d\S*)\s*$/,
    hStatus: /^\s*Port\s+Description\s+Status\s+Speed\s+Duplex/i,
    hDesc: /^\s*Interface\s+OK\s+Status\s+Protocol/i,
    hVlan: /NUM\s+Status\s+Description\s+Q\s+Ports/i,
    hMac: /^\s*VlanId\s+Mac Address/i,
    hArp: /^\s*Protocol\s+Address\s+Age/i,
    hLldp: /Loc PortID\s+Rem Host Name/i,
    status: new RegExp(`^\\s*(${ABBRS})\\s+(${PORT_ID})\\s+(.*?)\\s*\\b(Up|Down)\\s+(Auto|\\d+\\s*Mbit)\\s+(\\S+)\\s*(.*)$`, 'i'),
    desc: new RegExp(`^\\s*(${PHYS})\\s+(${PORT_ID})\\s+(YES|NO)\\s+(admin down|up|down)\\s+(up|down|not present)\\s*(.*)$`, 'i'),
    vlanRow: /^\s*(?:[*A-Za-z]{1,2}\s+)?(\d+)\s+(Active|Inactive)\b(.*)$/,
    vlanPorts: new RegExp(`^\\s*(.*?)\\s*\\b([UTxXGMHiIV])\\s+((?:Po|${ABBRS})\\s*\\d.*)$`),
    vlanCont: new RegExp(`^\\s+([UTxXGMHiIV])\\s+((?:Po|${ABBRS})\\s*\\d.*)$`),
    mac: new RegExp(`^\\s*\\*?N?\\s*(\\d+)\\s+(${MAC})\\s+(\\S+)\\s+(${ABBRS}|Po)\\s*(\\S+)`, 'i'),
    arp: new RegExp(`^\\s*Internet\\s+(\\S+)\\s+(\\S+)\\s+(${MAC})\\s+(?:(${ABBRS}|Po|Ma)\\s+(\\S+)|-)\\s*(?:Vl\\s+(\\d+))?`, 'i'),
    lldp: new RegExp(`^\\s*(${ABBRS})\\s+(${PORT_ID})\\s+(\\S+)\\s+(.+?)\\s+(${MAC})\\s*$`, 'i'),
  };

  function normType(name) {
    const n = String(name).toLowerCase();
    const t = TYPES.find(t => t.full.toLowerCase() === n || t.abbr.toLowerCase() === n);
    if (t) return t.abbr;
    if (n === 'port-channel' || n === 'po') return 'Po';
    if (n === 'vlan' || n === 'vl') return 'Vl';
    return null;
  }

  function portKey(id) {
    const m = String(id).match(/^(\d+)\/(\d+)/);
    return m ? `${+m[1]}/${+m[2]}` : null;
  }

  function normMac(mac) {
    const hex = String(mac).toLowerCase().replace(/[^0-9a-f]/g, '');
    return hex.length === 12 ? hex.match(/../g).join(':') : String(mac).trim();
  }

  function addUnique(arr, v) {
    if (!arr.includes(v)) arr.push(v);
  }

  // "10-12,20" -> [10, 11, 12, 20]
  function expandVlans(str) {
    const out = [];
    for (const part of String(str || '').split(/[,\s]+/)) {
      const m = part.match(/^(\d+)(?:-(\d+))?$/);
      if (!m) continue;
      const a = +m[1], b = m[2] ? +m[2] : a;
      if (b < a || b - a > 4094) continue;
      for (let i = a; i <= b; i++) addUnique(out, i);
    }
    return out.sort((x, y) => x - y);
  }

  // [10, 11, 12, 20] -> "10-12,20"
  function compressVlans(list) {
    const ids = [...new Set((list || []).map(Number).filter(n => !isNaN(n)))].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      let j = i;
      while (j + 1 < ids.length && ids[j + 1] === ids[j] + 1) j++;
      out.push(j > i ? `${ids[i]}-${ids[j]}` : `${ids[i]}`);
      i = j;
    }
    return out.join(',');
  }

  // "1/1-1/4,1/10" or "1/1-4" or "1/49/1-1/49/4" -> ["1/1", ...]
  function expandPortRanges(list) {
    const out = [];
    for (const item of list.split(',')) {
      const m = item.trim().match(/^(\d+)\/(\d+)(\/\d+)?(?:\s*-\s*(?:(\d+)\/)?(\d+)(?:\/\d+)?)?$/);
      if (!m) continue;
      const unit = +m[1], start = +m[2];
      let end = m[5] == null ? start : +m[5];
      if (m[3] && m[4] == null) end = start; // "1/49/1-4": sub-port range of one parent
      for (let n = start; n <= end && n - start < 1024; n++) addUnique(out, `${unit}/${n}`);
    }
    return out;
  }

  // Parses the interface lists used by `tagged`/`untagged`/`channel-member`
  // lines and by the Ports column of `show vlan`.
  function parsePortList(str) {
    const res = { ports: [], types: {}, pos: [], poMembers: {} };
    const rest = String(str).replace(
      /\b(?:Port-channel|Po)\s*(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)(?:\(([^)]*)\))?/gi,
      (all, ids, members) => {
        for (const id of expandVlans(ids.replace(/\s/g, ''))) {
          addUnique(res.pos, id);
          if (members) {
            const inner = parsePortList(members);
            res.poMembers[id] = inner.ports;
            Object.assign(res.types, inner.types);
          }
        }
        return ' ';
      });
    const re = new RegExp(`\\b(${PHYS})\\s*([\\d\\/,\\-\\s]+)`, 'gi');
    let m;
    while ((m = re.exec(rest))) {
      const abbr = normType(m[1]);
      for (const key of expandPortRanges(m[2])) {
        addUnique(res.ports, key);
        res.types[key] = abbr;
      }
    }
    return res;
  }

  function fmtSpeed(s) {
    const m = String(s).match(/(\d+)\s*Mbit/i);
    if (!m) return '';
    const mb = +m[1];
    return mb >= 1000 ? `${mb / 1000}G` : `${mb}M`;
  }

  function parse(text) {
    const R = { hostname: '', model: '', sections: [], ports: {}, portChannels: {}, vlans: {} };
    const sections = new Set();
    const arpByMac = {};
    const arpDirect = [];

    const port = (key, type) => {
      const p = R.ports[key] || (R.ports[key] = { key, ips: [], tagged: [], hosts: [] });
      if (type && !p.type) p.type = type;
      return p;
    };
    const po = id => R.portChannels[id] ||
      (R.portChannels[id] = { id: +id, members: [], ips: [], tagged: [], hosts: [] });
    const vlan = id => R.vlans[id] || (R.vlans[id] = { id: +id });
    const joinPo = (id, key, type) => {
      addUnique(po(id).members, key);
      port(key, type).portChannel = +id;
    };

    // Adds a parsed port list to a VLAN as tagged or untagged members.
    const addMembers = (vid, list, tagged) => {
      const targets = list.ports.map(k => port(k, list.types[k]));
      for (const id of list.pos) {
        targets.push(po(id));
        for (const k of list.poMembers[id] || []) joinPo(id, k, list.types[k]);
      }
      for (const t of targets) {
        if (tagged) addUnique(t.tagged, +vid);
        else t.untagged = +vid;
      }
    };

    let mode = null;     // which table we are inside
    let block = null;    // running-config interface block: { kind, obj }
    let curVlan = null;  // `show vlan` row that continuation lines belong to

    const blockLine = t => {
      const { kind, obj } = block;
      let m;
      if (kind === 'other') return;
      if ((m = t.match(/^description\s+(.+)/i))) obj.description = m[1].trim();
      else if ((m = t.match(/^name\s+(.+)/i))) obj.name = m[1].trim();
      else if ((m = t.match(/^ip(?:v6)? address\s+(\S+)/i))) addUnique(obj.ips || (obj.ips = []), m[1]);
      else if ((m = t.match(/^mtu\s+(\d+)/i))) obj.mtu = m[1];
      else if (/^switchport$/i.test(t)) obj.l2 = true;
      else if (/^portmode hybrid$/i.test(t)) obj.hybrid = true;
      else if (/^shutdown$/i.test(t)) obj.admin = 'down';
      else if (/^no shutdown$/i.test(t)) obj.admin = 'up';
      else if (kind === 'port' && (m = t.match(/^port-channel\s+(\d+)\s+mode\s+(\S+)/i))) joinPo(m[1], obj.key);
      else if (kind === 'po' && (m = t.match(/^channel-member\s+(.+)/i))) {
        const list = parsePortList(m[1]);
        for (const k of list.ports) joinPo(obj.id, k, list.types[k]);
      } else if (kind === 'vlan' && (m = t.match(/^(tagged|untagged)\s+(.+)/i))) {
        addMembers(obj.id, parsePortList(m[2]), m[1].toLowerCase() === 'tagged');
      }
    };

    for (const raw of String(text || '').split('\n')) {
      const line = raw.replace(/\r$/, '').replace(/^.*\x08/, '').replace(/^\s*--More--\s*/, '');
      let m;

      if (block) {
        if (/^\s+\S/.test(line)) { blockLine(line.trim()); continue; }
        // "!" lines can appear in the middle of an interface block, and the
        // default VLAN lists its members as "!untagged ..." comments.
        if (/^!/.test(line)) {
          const c = line.match(/^!(tagged|untagged)\s+(.+)/i);
          if (c && block.kind === 'vlan') addMembers(block.obj.id, parsePortList(c[2]), c[1].toLowerCase() === 'tagged');
          continue;
        }
        block = null;
      }
      if (!line.trim()) continue;

      if ((m = line.match(RE.prompt))) {
        R.hostname = R.hostname || m[1];
        mode = null;
        continue;
      }
      if ((m = line.match(/^hostname\s+(\S+)/i))) { R.hostname = m[1]; continue; }
      if ((m = line.match(/^stack-unit\s+\d+\s+provision\s+(\S+)/i))) { R.model = R.model || m[1]; continue; }

      if ((m = line.match(RE.iface))) {
        const type = normType(m[1]);
        sections.add('running-config');
        mode = null;
        if (type === 'Po') block = { kind: 'po', obj: po(m[2]) };
        else if (type === 'Vl') block = { kind: 'vlan', obj: vlan(m[2]) };
        else if (type && portKey(m[2])) block = { kind: 'port', obj: port(portKey(m[2]), type) };
        else block = { kind: 'other', obj: {} };
        continue;
      }

      if (RE.hStatus.test(line)) { mode = 'status'; sections.add('interfaces status'); continue; }
      if (RE.hDesc.test(line)) { mode = 'desc'; sections.add('interfaces description'); continue; }
      if (RE.hVlan.test(line)) { mode = 'vlan'; curVlan = null; sections.add('vlan'); continue; }
      if (RE.hMac.test(line)) { mode = 'mac'; sections.add('mac-address-table'); continue; }
      if (RE.hArp.test(line)) { mode = 'arp'; sections.add('arp'); continue; }
      if (RE.hLldp.test(line)) { mode = 'lldp'; sections.add('lldp neighbors'); continue; }

      if (mode === 'status' && (m = line.match(RE.status))) {
        const p = port(portKey(m[2]), normType(m[1]));
        if (m[3].trim() && !p.description) p.description = m[3].trim();
        p.link = m[4].toLowerCase();
        p.speed = fmtSpeed(m[5]);
      } else if (mode === 'desc' && (m = line.match(RE.desc))) {
        const p = port(portKey(m[2]), normType(m[1]));
        p.admin = /admin/i.test(m[4]) ? 'down' : 'up';
        p.link = m[5].toLowerCase() === 'up' ? 'up' : 'down';
        if (m[6].trim()) p.description = m[6].trim();
      } else if (mode === 'vlan') {
        let q = null, list = null;
        if ((m = line.match(RE.vlanRow))) {
          curVlan = vlan(m[1]);
          const pm = m[3].match(RE.vlanPorts);
          const desc = (pm ? pm[1] : m[3]).trim();
          if (desc && !curVlan.name) curVlan.name = desc;
          if (pm) { q = pm[2]; list = pm[3]; }
        } else if (curVlan && (m = line.match(RE.vlanCont))) {
          q = m[1]; list = m[2];
        }
        if (list && (q === 'U' || q === 'T')) addMembers(curVlan.id, parsePortList(list), q === 'T');
      } else if (mode === 'mac' && (m = line.match(RE.mac))) {
        const host = { mac: normMac(m[2]), vlan: +m[1] };
        if (normType(m[4]) === 'Po') po(parseInt(m[5], 10)).hosts.push(host);
        else if (portKey(m[5])) port(portKey(m[5]), normType(m[4])).hosts.push(host);
      } else if (mode === 'arp' && (m = line.match(RE.arp))) {
        const mac = normMac(m[3]);
        arpByMac[mac] = m[1];
        if (m[4]) arpDirect.push({ ip: m[1], mac, type: normType(m[4]), id: m[5], vlan: m[6] ? +m[6] : '' });
      } else if (mode === 'lldp' && (m = line.match(RE.lldp))) {
        const host = m[3] === '-' ? '' : m[3];
        const remPort = new RegExp(`^(${MAC})$`, 'i').test(m[4]) && host ? '' : m[4].trim();
        port(portKey(m[2]), normType(m[1])).neighbor = host && remPort ? `${host} (${remPort})` : host || remPort;
      }
    }

    // ARP entries that name an interface directly.
    for (const a of arpDirect) {
      const host = { mac: a.mac, ip: a.ip, vlan: a.vlan };
      if (a.type === 'Po') po(parseInt(a.id, 10)).hosts.push(host);
      else if (a.type && a.type !== 'Vl' && portKey(a.id)) port(portKey(a.id), a.type).hosts.push(host);
    }

    // Port-channel settings apply to every member port.
    for (const pc of Object.values(R.portChannels)) {
      for (const key of pc.members) {
        const p = port(key);
        p.portChannel = pc.id;
        for (const v of pc.tagged) addUnique(p.tagged, v);
        if (pc.untagged != null && p.untagged == null) p.untagged = pc.untagged;
        if (pc.l2) p.l2 = true;
        if (pc.hybrid) p.hybrid = true;
        p.hosts.push(...pc.hosts.map(h => ({ ...h })));
      }
    }

    let hostCount = 0;
    for (const p of Object.values(R.ports)) {
      const seen = new Map();
      for (const h of p.hosts) {
        const prev = seen.get(h.mac);
        if (prev) {
          prev.ip = prev.ip || h.ip;
          prev.vlan = prev.vlan || h.vlan;
        } else seen.set(h.mac, h);
      }
      p.hosts = [...seen.values()];
      for (const h of p.hosts) h.ip = h.ip || arpByMac[h.mac] || '';
      hostCount += p.hosts.length;

      p.tagged.sort((a, b) => a - b);
      p.ip = p.ips.join(', ');
      if (p.ips.length) p.mode = 'routed';
      else if (p.tagged.length && p.untagged != null) p.mode = 'hybrid';
      else if (p.tagged.length) p.mode = 'trunk';
      else if (p.untagged != null) p.mode = 'access';
      else p.mode = '';
    }
    for (const v of Object.values(R.vlans)) {
      v.name = v.name || v.description || '';
      v.ip = (v.ips || []).join(', ');
    }

    R.sections = [...sections];
    R.hostCount = hostCount;
    return R;
  }

  // Derives a port layout (unit, first port number, port groups) from the
  // interfaces seen in the output.
  function layoutFrom(R) {
    const all = Object.values(R.ports).filter(p => p.type).map(p => {
      const [unit, num] = p.key.split('/').map(Number);
      return { unit, num, type: p.type };
    });
    if (!all.length) return null;
    const counts = {};
    for (const p of all) counts[p.unit] = (counts[p.unit] || 0) + 1;
    const unit = +Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const ports = all.filter(p => p.unit === unit).sort((a, b) => a.num - b.num);
    const groups = [];
    let last = null;
    for (const p of ports) {
      if (last && last.type === p.type) {
        last.end = p.num;
      } else {
        last = { type: p.type, start: p.num, end: p.num };
        groups.push(last);
      }
    }
    // A group runs up to the start of the next one, so gaps in the output
    // (e.g. a MAC table that only lists active ports) don't shift numbering.
    return {
      unit,
      firstPort: ports[0].num,
      groups: groups.map((g, i) => {
        const speed = TYPES.find(t => t.abbr === g.type).speed;
        const end = i + 1 < groups.length ? groups[i + 1].start - 1 : g.end;
        return { count: end - g.start + 1, speed, media: DEFAULT_MEDIA[speed] };
      }),
    };
  }

  const api = { parse, layoutFrom, parsePortList, expandVlans, compressVlans, normMac, TYPES, DEFAULT_MEDIA };
  root.OS9 = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
