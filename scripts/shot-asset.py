"""Screenshot a single viewer asset: python3 scripts/shot-asset.py <model> [out]"""
import sys
from playwright.sync_api import sync_playwright

model = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/alley-assets/{model}.png"
url = f"http://localhost:5199/viewer?model={model}"

import os
os.makedirs(os.path.dirname(out), exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 960, "height": 700})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_timeout(2500)
    page.screenshot(path=out)
    if errors:
        print("ERRORS:", errors[:5])
    browser.close()
print(out)
