"""Pack the browser extension for each browser.

    python tools/pack_extension.py            writes dist/ (not in git)

    dist/telisik-chrome.zip      extension/ as it is: Chrome, Edge and other Chromium browsers
    dist/telisik-firefox/        the same files with Firefox's manifest (load this folder in Firefox)
    dist/telisik-firefox.zip     that folder zipped, the form addons.mozilla.org takes

Why two: Chrome starts the background file as a service worker and reports a manifest error
if "background.scripts" is present; Firefox does not run extension service workers and needs
exactly that key. Everything else is byte for byte the same.
"""

import argparse
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def firefox_manifest(manifest):
    """Chrome's manifest with the background started the way Firefox starts it."""
    changed = dict(manifest)
    background = dict(manifest["background"])
    changed["background"] = {"scripts": [background["service_worker"]], "type": background["type"]}
    return changed


def source_files():
    return sorted(path for path in SOURCE.rglob("*") if path.is_file())


def write_zip(target, folder):
    """Same input, same bytes: sorted names and one fixed date."""
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(item for item in folder.rglob("*") if item.is_file()):
            entry = zipfile.ZipInfo(path.relative_to(folder).as_posix(), FIXED_TIME)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, path.read_bytes())


def build(out):
    """Write the three outputs into out and return the Firefox folder."""
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    firefox = out / "telisik-firefox"
    if firefox.exists():
        shutil.rmtree(firefox)
    for path in source_files():
        target = firefox / path.relative_to(SOURCE)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    with open(firefox / "manifest.json", "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(firefox_manifest(manifest), indent=2, ensure_ascii=False) + "\n")
    write_zip(out / "telisik-chrome.zip", SOURCE)
    write_zip(out / "telisik-firefox.zip", firefox)
    return firefox


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", default=str(ROOT / "dist"))
    args = parser.parse_args()
    firefox = build(args.out)
    for path in sorted(Path(args.out).iterdir()):
        size = "" if path.is_dir() else f"  {path.stat().st_size} bytes"
        print(f"{path}{size}")
    print(f"Firefox: about:debugging > This Firefox > Load Temporary Add-on > {firefox / 'manifest.json'}")


if __name__ == "__main__":
    main()
