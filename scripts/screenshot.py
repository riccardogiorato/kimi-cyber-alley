"""Headless screenshot harness for the alley.

Usage: python3 scripts/screenshot.py [outdir] [url]
Loads the page, auto-walks the player through the alley by injecting
camera poses, and captures screenshots at several waypoints.
"""
import sys
import time
from playwright.sync_api import sync_playwright

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/alley-shots"
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:5199/"

# (name, x, z, yaw, pitch) — yaw: 0 faces +Z? we set camera directly.
# (name, x, z, yaw, pitch) — yaw=0 faces +Z (down the alley).
POSES = [
    ("01-entrance", 0.0, 2.5, 0.0, 0.02),
    ("02-hotel-sign", 0.4, 8.0, -0.35, 0.35),
    ("03-mid-alley", 0.0, 20.0, 0.0, 0.05),
    ("04-karaoke", -0.4, 27.0, 0.3, 0.25),
    ("05-noodle-stand", 0.3, 31.5, -0.15, 0.0),
    ("06-stand-close", -0.6, 35.5, -0.5, -0.05),
    ("07-lanterns", 0.0, 45.0, 0.0, 0.3),
    ("08-t-approach", 0.0, 60.0, 0.0, 0.05),
    ("09-t-junction", 0.0, 68.5, 0.0, 0.1),
    ("10-look-back", 0.0, 55.0, 3.14159, 0.1),
]

with sync_playwright() as p:
    browser = p.chromium.launch(args=[
        "--use-angle=metal",
        "--enable-gpu",
        "--ignore-gpu-blocklist",
    ])
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.goto(URL)
    page.wait_for_timeout(4000)  # let textures generate + first frames render

    for name, x, z, yaw, pitch in POSES:
        page.evaluate(
            """([x, z, yaw, pitch]) => {
                const pl = window.__player;
                if (!pl) return;
                pl.teleport(x, z, yaw);
                pl.setPitch(pitch);
            }""",
            [x, z, yaw, pitch],
        )
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/{name}.png")

    if errors:
        print("PAGE ERRORS:")
        for e in errors[:20]:
            print(" ", e)
    else:
        print("no page errors")
    browser.close()
print("done ->", OUT)
