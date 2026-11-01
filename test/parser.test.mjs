// Run with: node test/parser.test.mjs   (or: deno run test/parser.test.mjs)
import assert from 'node:assert';
import '../site/os9.js';
import '../site/sample.js';

const OS9 = globalThis.OS9;
const sample = globalThis.OS9_SAMPLE;

const R = OS9.parse(sample);
const p = k => R.ports[k];

assert.strictEqual(R.hostname, 'S4048-LAB');
assert.deepStrictEqual(R.sections.sort(), ['arp', 'interfaces status', 'lldp neighbors', 'mac-address-table', 'running-config', 'vlan']);
assert.strictEqual(Object.keys(R.ports).length, 54);

// Hybrid ESXi port: untagged 10, tagged 20+30, LLDP neighbor, MACs joined with ARP.
assert.strictEqual(p('1/1').type, 'Te');
assert.strictEqual(p('1/1').description, 'esxi-01 vmnic0');
assert.strictEqual(p('1/1').mode, 'hybrid');
assert.strictEqual(p('1/1').untagged, 10);
assert.deepStrictEqual(p('1/1').tagged, [20, 30]);
assert.strictEqual(p('1/1').neighbor, 'esxi-01 (vmnic0)');
assert.strictEqual(p('1/1').link, 'up');
assert.strictEqual(p('1/1').speed, '10G');
assert.strictEqual(p('1/1').mtu, '9216');
assert.deepStrictEqual(p('1/1').hosts, [
  { mac: '00:50:56:aa:01:0a', vlan: 10, ip: '10.0.10.11' },
  { mac: '00:50:56:aa:01:1e', vlan: 30, ip: '10.0.30.101' },
]);

// Access port, and a shut-down port.
assert.strictEqual(p('1/9').mode, 'access');
assert.strictEqual(p('1/9').untagged, 40);
assert.strictEqual(p('1/30').admin, 'down');
assert.strictEqual(p('1/30').link, 'down');

// Port-channel members inherit the Po's VLANs and MACs.
assert.strictEqual(p('1/13').portChannel, 10);
assert.strictEqual(p('1/13').untagged, 40);
assert.strictEqual(p('1/14').hosts.length, 1);
assert.strictEqual(p('1/49').type, 'Fo');
assert.strictEqual(p('1/49').portChannel, 1);
assert.deepStrictEqual(p('1/49').tagged, [10, 20, 30, 40, 99]);
assert.strictEqual(p('1/49').hosts.length, 14);
assert.strictEqual(p('1/49').neighbor, 'spine-01 (fortyGigE 1/1)');

// Routed port, with a host learned from ARP only.
assert.strictEqual(p('1/47').mode, 'routed');
assert.strictEqual(p('1/47').ip, '10.255.0.1/30');
assert.deepStrictEqual(p('1/47').hosts, [{ mac: '00:1b:21:c0:ff:ee', ip: '10.255.0.2', vlan: '' }]);

// VLANs.
assert.strictEqual(R.vlans[10].name, 'Servers');
assert.strictEqual(R.vlans[10].ip, '10.0.10.1/24');
assert.strictEqual(R.vlans[99].name, 'Mgmt');

// Layout derived from the output.
assert.deepStrictEqual(OS9.layoutFrom(R), {
  unit: 1,
  firstPort: 1,
  groups: [{ count: 48, speed: '10G', media: 'SFP+' }, { count: 6, speed: '40G', media: 'QSFP+' }],
});

// Helpers and odd formats.
assert.strictEqual(OS9.compressVlans([30, 10, 11, 12, 20]), '10-12,20,30');
assert.deepStrictEqual(OS9.expandVlans('10-12, 20'), [10, 11, 12, 20]);
assert.deepStrictEqual(OS9.parsePortList('TenGigabitEthernet 0/0-3,0/7').ports, ['0/0', '0/1', '0/2', '0/3', '0/7']);
assert.deepStrictEqual(OS9.parsePortList('Te 1/49/1-1/49/4').ports, ['1/49']);
assert.deepStrictEqual(OS9.parsePortList('Port-channel 10-11').pos, [10, 11]);
assert.strictEqual(OS9.normMac('0050.56AA.0102'), '00:50:56:aa:01:02');

// `show interfaces description` plus descriptions containing "Up", and CRLF line endings.
const R2 = OS9.parse([
  'sw1#show interfaces description',
  'Interface                OK Status     Protocol Description',
  'TenGigabitEthernet 0/0   YES up         up       Uplink to core',
  'TenGigabitEthernet 0/1   NO  admin down down     spare',
  'sw1#show interfaces status',
  'Port                 Description  Status Speed        Duplex Vlan',
  'Te 0/0               Up link A    Up     10000 Mbit   Full   --',
].join('\r\n'));
assert.strictEqual(R2.hostname, 'sw1');
assert.strictEqual(R2.ports['0/0'].description, 'Uplink to core');
assert.strictEqual(R2.ports['0/0'].link, 'up');
assert.strictEqual(R2.ports['0/1'].admin, 'down');
assert.strictEqual(R2.ports['0/1'].description, 'spare');

// Shapes seen in real S4048-ON output: a "!" line in the middle of an
// interface block, default-VLAN members listed as comments, VLAN `name`.
const R3 = OS9.parse([
  'sw01#terminal length 0',
  'sw01#show running-config',
  'Current Configuration ...',
  '! Version 9.14(2.23)',
  'hostname sw01',
  '!',
  'stack-unit 1 provision S4048-ON',
  '!',
  'interface TenGigabitEthernet 1/1',
  ' no ip address',
  ' mtu 9216',
  ' switchport',
  ' spanning-tree rstp edge-port bpduguard shutdown-on-violation ',
  ' no shutdown',
  '!',
  'interface fortyGigE 1/49',
  ' description ISL sw01-sw02 Fo 1/49',
  ' no ip address',
  ' mtu 9216',
  '!  ',
  ' port-channel-protocol LACP ',
  '  port-channel 100 mode active ',
  ' no shutdown',
  '!',
  'interface fortyGigE 1/50',
  ' description unused',
  ' switchport',
  ' shutdown',
  '!',
  'interface ManagementEthernet 1/1',
  ' ip address 192.0.2.10/24',
  ' no shutdown',
  '!',
  'interface Port-channel 100',
  ' description ISL sw01-sw02',
  ' switchport',
  ' no shutdown',
  '!',
  'interface Vlan 1',
  '!untagged TenGigabitEthernet 1/1-1/48',
  '!untagged fortyGigE 1/50-1/54',
  '!',
  'interface Vlan 10',
  ' description 172.16.10.0/24',
  ' name servers',
  ' no ip address',
  ' tagged Port-channel 100',
  ' no shutdown',
  '!',
  'management route 0.0.0.0/0 192.0.2.1 ',
  'end',
  'sw01#',
].join('\n'));
assert.strictEqual(R3.hostname, 'sw01');
assert.strictEqual(R3.model, 'S4048-ON');
assert.strictEqual(R3.ports['1/1'].mode, 'access');
assert.strictEqual(R3.ports['1/1'].untagged, 1);
assert.strictEqual(R3.ports['1/48'].untagged, 1);
assert.strictEqual(R3.ports['1/49'].portChannel, 100);
assert.strictEqual(R3.ports['1/49'].admin, 'up');
assert.strictEqual(R3.ports['1/49'].mode, 'trunk');
assert.deepStrictEqual(R3.ports['1/49'].tagged, [10]);
assert.strictEqual(R3.ports['1/50'].admin, 'down');
assert.strictEqual(R3.ports['1/50'].untagged, 1);
assert.strictEqual(R3.vlans[10].name, 'servers');
assert.strictEqual(Object.keys(R3.ports).some(k => k.startsWith('2/')), false);

// Real `show vlan` / `show interfaces status` shapes, including the errors
// left behind when the switch swallowed part of a pasted command.
const R4 = OS9.parse([
  'sw01#terminal length 0',
  'sw01#show vlan',
  '',
  'Codes: * - Default VLAN, G - GVRP VLANs, R - Remote Port Mirroring VLANs, P - Primary, C - Community, I - Isolated',
  '       O - Openflow, Vx - Vxlan',
  'Q: U - Untagged, T - Tagged',
  '   G - GVRP tagged, M - Vlan-stack',
  '   i - Internal untagged, I - Internal tagged, v - VLT untagged, V - VLT tagged',
  '',
  '    NUM    Status    Description                     Q Ports',
  '*   1      Active                                    U Te 1/1-1/48',
  '                                                     U Fo 1/50-1/54',
  '    10     Active    172.16.10.0/24                  T Po100(Fo 1/49)',
  '    20     Inactive  172.16.20.0/24                  ',
  'sw01#s',
  '% Error: Ambiguous command "s".',
  'sw01#how arp',
  '       ^',
  '% Error: Invalid input at "^" marker.',
  'sw01#show interfaces status',
  'Port                 Description  Status Speed        Duplex Vlan  ',
  'Te 1/1                            Down   Auto         Auto   1',
  'Te 1/17                           Up     10000 Mbit   Full   1',
  'Fo 1/49              ISL sw01-  Up     40000 Mbit   Full   --',
  'Fo 1/50              unused       Down   40000 Mbit   Auto   1',
  'sw01#',
].join('\n'));
assert.strictEqual(R4.hostname, 'sw01');
assert.strictEqual(Object.keys(R4.ports).length, 54);
assert.strictEqual(R4.ports['1/17'].untagged, 1);
assert.strictEqual(R4.ports['1/17'].link, 'up');
assert.strictEqual(R4.ports['1/17'].speed, '10G');
assert.strictEqual(R4.ports['1/1'].link, 'down');
assert.strictEqual(R4.ports['1/49'].portChannel, 100);
assert.deepStrictEqual(R4.ports['1/49'].tagged, [10]);
assert.strictEqual(R4.ports['1/49'].description, 'ISL sw01-');
assert.strictEqual(R4.ports['1/50'].description, 'unused');
assert.strictEqual(R4.ports['1/50'].untagged, 1);
assert.strictEqual(R4.vlans[10].name, '172.16.10.0/24');
assert.strictEqual(R4.vlans[20].name, '172.16.20.0/24');

console.log('parser tests passed');
