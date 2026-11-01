#!/usr/bin/env python3
"""Bundles site/ into one self-contained HTML page (dist/switch-map.html)
that opens on the sample switch. Useful as a demo or for hosts that serve a
single file."""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
site = root / "site"
read = lambda name: (site / name).read_text()

html = read("index.html")
body = html.split("<body>", 1)[1].split("</body>", 1)[0]
body = body.split('<script src="os9.js">', 1)[0]
scripts = ["window.SWITCHMAP_DEMO = true;", read("os9.js"), read("sample.js"), read("app.js")]

out = "<title>Switch Map</title>\n<style>\n" + read("style.css") + "</style>\n" + body
out += "".join(f"<script>\n{js}\n</script>\n" for js in scripts)

dist = root / "dist"
dist.mkdir(exist_ok=True)
(dist / "switch-map.html").write_text(out)
print(f"wrote dist/switch-map.html ({len(out) // 1024} KB)")
