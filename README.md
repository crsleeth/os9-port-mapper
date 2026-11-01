# Switch Map

Status: working; OS9 import checked against S4048-ON output (OS9 9.14) | Next: try more switch models and OS9 versions

A small web app for documenting switch ports. Lay out a switch's front panel
(for example `48x 10Gb SFP+, 6x 40Gb QSFP+`), then record per port: description,
what it connects to, mode, VLANs, IP, port-channel, link state, and the devices
(MAC / IP) behind it. Ports can be color coded by hand or automatically by VLAN,
link status, mode or port-channel. Hover a port to see everything recorded for it.

It is a static site: no database and no server-side code. Maps live in your
browser and in the files you save.

## Run it

### Docker or Podman (compose)

```bash
docker compose up -d --build
```

or

```bash
podman compose up -d --build
```

Then open http://localhost:8080. Set `PORT` (in the environment or a `.env`
file next to `compose.yaml`) to use another port.

The image is the official Caddy image with `site/` copied in. After pulling new
code, run the same command again to rebuild. If you already run a reverse
proxy, point it at the published port.

Compose-based managers such as Dockge or Portainer can use `compose.yaml` as
is: put this repository in the stack's directory and start the stack.

### Without containers

```bash
python3 -m http.server 8137 --directory site
```

Then open http://localhost:8137. Any static file server works.

## Importing Dell OS9 output

**Import OS9…** collects the switch's state for you:

1. Enter your SSH login (`user@address`).
2. Paste the generated one-line command into a terminal on macOS or Linux. It
   uses `expect` (preinstalled on macOS; on Linux install the `expect` package).
   Log in as usual; once the `#` prompt appears it runs each show command,
   waiting for the prompt between them, then logs out.
3. Copy the terminal output and paste it into the dialog.

The commands are sent one at a time because OS9 discards input that arrives
while a command is still printing, so pasting a block of show commands at the
prompt loses most of them. On Windows, PuTTY or a serial console, the dialog
lists the commands to run one by one.

The import reads any mix of:

| Command | What it fills in |
| --- | --- |
| `show running-config` | descriptions, mode, VLANs, IPs, MTU, port-channels, admin state, VLAN names, model |
| `show vlan` | untagged / tagged VLANs, VLAN names, port-channel members |
| `show interfaces status` | link state, speed |
| `show interfaces description` | admin and link state, descriptions |
| `show mac-address-table` | devices on each port |
| `show arp` | IP addresses for those devices |
| `show lldp neighbors` | "Connected to" |

It can also build the port layout from the output, so you can start from an
empty page. Ports with many MAC addresses (uplinks) are skipped for devices and
get a note instead; the limit is adjustable in the import dialog. Breakout
sub-ports (`Te 1/49/1`) are folded into their parent port. Pasted output is
parsed in the browser and is never sent anywhere.

## Saving

- **Save** downloads every switch as one `<name>.switchmap.json` file. **Open…** loads it back.
- **Export CSV** writes the current switch as a spreadsheet, one row per port.
- The browser also keeps a working copy automatically, but only in that
  browser. The saved file is how you move a map between machines or people.

## Single-file build

```bash
python3 tools/build_single_file.py
```

Writes `dist/switch-map.html`, the whole app in one page that opens on a sample
switch. Handy as a demo or for hosts that only serve a single file.

## Tests

```bash
node test/parser.test.mjs
```

(`deno run test/parser.test.mjs` works too.)
