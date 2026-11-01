/* Sample OS9 output for a made-up S4048-ON, used by "Load sample" in the
 * import dialog and by test/parser.test.js. */
(function (root) {
  'use strict';
  const L = [];
  const pad = (s, n) => String(s).padEnd(n);
  const hex = n => n.toString(16).padStart(2, '0');
  const mac = (port, vlan) => `00:50:56:aa:${hex(port)}:${hex(vlan)}`;

  // ---- show running-config ----
  const iface = (name, lines) => L.push(`interface ${name}`, ...lines.map(l => ' ' + l), '!');
  L.push('S4048-LAB#show running-config', 'Current Configuration ...', '! Version 9.14(2.4)', '!',
    'hostname S4048-LAB', '!');
  for (let i = 1; i <= 48; i++) {
    const name = `TenGigabitEthernet 1/${i}`;
    if (i <= 8) iface(name, [`description esxi-0${Math.ceil(i / 2)} vmnic${(i - 1) % 2}`, 'no ip address', 'mtu 9216', 'portmode hybrid', 'switchport', 'no shutdown']);
    else if (i <= 12) iface(name, [`description san-0${i - 8} iscsi`, 'no ip address', 'mtu 9216', 'switchport', 'no shutdown']);
    else if (i <= 14) iface(name, ['description nas-01 bond0', 'no ip address', 'mtu 9216', 'port-channel-protocol LACP', ' port-channel 10 mode active', 'no shutdown']);
    else if (i <= 20) iface(name, [`description app-0${i - 14}`, 'no ip address', 'switchport', 'no shutdown']);
    else if (i === 47) iface(name, ['description fw-01 transit', 'ip address 10.255.0.1/30', 'no shutdown']);
    else if (i === 48) iface(name, ['description oob-mgmt-sw', 'no ip address', 'switchport', 'no shutdown']);
    else iface(name, ['no ip address', 'shutdown']);
  }
  for (let i = 49; i <= 54; i++) {
    const name = `fortyGigE 1/${i}`;
    if (i <= 50) iface(name, [`description spine-0${i - 48} uplink`, 'no ip address', 'mtu 9216', 'port-channel-protocol LACP', ' port-channel 1 mode active', 'no shutdown']);
    else iface(name, ['no ip address', 'shutdown']);
  }
  iface('Port-channel 1', ['description uplink to spines', 'no ip address', 'mtu 9216', 'portmode hybrid', 'switchport', 'no shutdown']);
  iface('Port-channel 10', ['description nas-01', 'no ip address', 'mtu 9216', 'switchport', 'no shutdown']);
  iface('Vlan 10', ['description Servers', 'ip address 10.0.10.1/24', 'tagged Port-channel 1', 'untagged TenGigabitEthernet 1/1-1/8,1/15-1/20', 'no shutdown']);
  iface('Vlan 20', ['description vMotion', 'no ip address', 'tagged TenGigabitEthernet 1/1-1/8', 'tagged Port-channel 1', 'no shutdown']);
  iface('Vlan 30', ['description VM-Network', 'ip address 10.0.30.1/24', 'tagged TenGigabitEthernet 1/1-1/8', 'tagged Port-channel 1', 'no shutdown']);
  iface('Vlan 40', ['description Storage', 'no ip address', 'mtu 9216', 'tagged Port-channel 1', 'untagged TenGigabitEthernet 1/9-1/12', 'untagged Port-channel 10', 'no shutdown']);
  iface('Vlan 99', ['description Mgmt', 'ip address 10.0.99.1/24', 'tagged Port-channel 1', 'untagged TenGigabitEthernet 1/48', 'no shutdown']);
  L.push('end', '');

  // ---- show vlan ----
  L.push('S4048-LAB#show vlan', '',
    'Codes: * - Default VLAN, G - GVRP VLANs, R - Remote Port Mirroring VLANs, P - Primary, C - Community, I - Isolated',
    'Q: U - Untagged, T - Tagged',
    '   x - Dot1x untagged, X - Dot1x tagged',
    '',
    '    NUM    Status    Description                     Q Ports',
    '*   1      Active                                    U Po1(Fo 1/49-1/50)',
    '    10     Active    Servers                         T Po1(Fo 1/49-1/50)',
    '                                                     U Te 1/1-1/8,1/15-1/20',
    '    20     Active    vMotion                         T Po1(Fo 1/49-1/50)',
    '                                                     T Te 1/1-1/8',
    '    30     Active    VM-Network                      T Po1(Fo 1/49-1/50)',
    '                                                     T Te 1/1-1/8',
    '    40     Active    Storage                         T Po1(Fo 1/49-1/50)',
    '                                                     U Po10(Te 1/13-1/14)',
    '                                                     U Te 1/9-1/12',
    '    99     Active    Mgmt                            T Po1(Fo 1/49-1/50)',
    '                                                     U Te 1/48',
    '');

  // ---- show interfaces status ----
  const up = i => (i <= 20 && i !== 18 && i !== 19) || (i >= 47 && i <= 50);
  L.push('S4048-LAB#show interfaces status',
    'Port                 Description  Status Speed        Duplex Vlan');
  for (let i = 1; i <= 54; i++) {
    const fo = i > 48;
    L.push(pad(`${fo ? 'Fo' : 'Te'} 1/${i}`, 21) + pad('', 13) +
      (up(i) ? pad('Up', 7) + pad(fo ? '40000 Mbit' : '10000 Mbit', 13) + pad('Full', 7) : pad('Down', 7) + pad('Auto', 13) + pad('Auto', 7)) + '--');
  }
  L.push('');

  // ---- show mac-address-table / show arp ----
  const macs = [];
  const arps = [];
  const learn = (iface, port, vlan, ip) => {
    macs.push(` ${pad(vlan, 10)}${pad(mac(port, vlan), 22)}${pad('Dynamic', 14)}${pad(iface, 17)}Active`);
    if (ip) arps.push(`${pad('Internet', 12)}${pad(ip, 21)}${pad(Math.floor(port * 3.7) % 120, 5)}${pad(mac(port, vlan), 20)}${pad(iface, 15)}${pad('Vl ' + vlan, 15)}CP`);
  };
  for (let i = 1; i <= 8; i++) {
    learn(`Te 1/${i}`, i, 10, `10.0.10.${10 + i}`);
    learn(`Te 1/${i}`, i, 30, `10.0.30.${100 + i}`);
  }
  for (let i = 9; i <= 12; i++) learn(`Te 1/${i}`, i, 40);
  learn('Po 10', 13, 40);
  for (const i of [15, 16, 17, 20]) learn(`Te 1/${i}`, i, 10, `10.0.10.${30 + i}`);
  learn('Te 1/48', 48, 99, '10.0.99.2');
  for (let n = 0; n < 14; n++) learn('Po 1', 200 + n, [10, 20, 30, 40, 99][n % 5]);
  L.push('S4048-LAB#show mac-address-table',
    'Codes: *N - VLT Peer Synced MAC',
    'VlanId     Mac Address           Type          Interface        State',
    ...macs, '');
  L.push('S4048-LAB#show arp', '',
    'Protocol    Address         Age(min)  Hardware Address    Interface      VLAN             CPU',
    '-'.repeat(88),
    ...arps,
    'Internet    10.255.0.2             4    00:1b:21:c0:ff:ee   Te 1/47        -              CP',
    '');

  // ---- show lldp neighbors ----
  L.push('S4048-LAB#show lldp neighbors',
    ' Loc PortID   Rem Host Name     Rem Port Id                Rem Chassis Id',
    ' ' + '-'.repeat(73));
  for (let i = 1; i <= 8; i++) {
    L.push(` ${pad('Te 1/' + i, 13)}${pad('esxi-0' + Math.ceil(i / 2), 18)}${pad('vmnic' + ((i - 1) % 2), 27)}${mac(i, 0)}`);
  }
  L.push(` ${pad('Te 1/48', 13)}${pad('oob-mgmt-sw', 18)}${pad('GigabitEthernet 1/24', 27)}00:01:e8:8b:44:10`);
  L.push(` ${pad('Fo 1/49', 13)}${pad('spine-01', 18)}${pad('fortyGigE 1/1', 27)}00:01:e8:d5:a1:00`);
  L.push(` ${pad('Fo 1/50', 13)}${pad('spine-02', 18)}${pad('fortyGigE 1/1', 27)}00:01:e8:d5:b2:00`);
  L.push('S4048-LAB#');

  const sample = L.join('\n');
  root.OS9_SAMPLE = sample;
  if (typeof module !== 'undefined' && module.exports) module.exports = sample;
})(typeof window !== 'undefined' ? window : globalThis);
