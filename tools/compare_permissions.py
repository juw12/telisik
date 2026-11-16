"""What does a search add-on ask the browser for? Telisik next to the search engines' own Firefox add-ons.

    python tools/compare_permissions.py                 read addons.mozilla.org, print the table, save the data
    python tools/compare_permissions.py --proxy URL     the same through a proxy
    python tools/compare_permissions.py --saved         print the table from the saved data, no network

For every add-on in SAMPLE it downloads the current public package from addons.mozilla.org and reads
the manifest.json inside it. Nothing is installed and nothing is run; no search engine is queried.
Telisik's row comes from extension/manifest.json in this folder.

What is counted, straight from each manifest:
  * browser permissions: the entries of "permissions" that are not site patterns
  * site patterns: site patterns in "permissions", "host_permissions" and the "matches" of content scripts
  * every site: one of those patterns covers all websites
  * what the add-on does: default search engine, home page, new tab page, toolbar button,
    address-bar keyword, right-click entry, scripts that run inside web pages

What this does not show: what an add-on does with its permissions, what the search engine's own
website collects, and anything about Chrome's store. A permission is not misuse; a tracker blocker
needs to see every site to do its job. The table says how much has to be trusted, not who is honest.

The data is saved to founder/addon-permissions.json with the day it was read.
"""

import argparse
import datetime
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAVED = ROOT / "founder" / "addon-permissions.json"
API = "https://addons.mozilla.org/api/v5/addons/addon/{slug}/"

# Add-ons published on addons.mozilla.org by the search engine's own account. They were found on
# 2026-11-16 by searching the store for the engine names in SEARCHED and keeping every result whose
# author is the engine itself. Unofficial add-ons by other people are left out.
SAMPLE = [
    "duckduckgo-for-firefox",
    "duckduckgo-no-ai-search",
    "startpage-private-search",
    "startpage-privacy-protection",
    "ecosia-the-green-search",
    "brave-search",
    "kagi-search-for-firefox",
    "qwant-the-search-engine",
    "qwantcom-for-firefox",
    "swisscows-search",
    "metager-suche",
    "bing-search-engine-",
    "bing-homepage-searchengine",
    "yandex-homepage",
    "yandexbar",
    "lilo-moteur-de-recherche",
    "karmasearch",
    "seznam-doplněk-vyhledávač",
]
SEARCHED = [
    "duckduckgo", "startpage", "ecosia", "brave search", "kagi", "qwant", "perplexity", "bing",
    "microsoft bing search", "mojeek", "swisscows", "you.com", "yahoo", "yandex", "google", "searx",
    "searxng", "metager", "phind", "openai", "chatgpt", "mullvad leta", "presearch", "lilo",
    "karma search", "seznam", "naver", "baidu",
]
NO_OWN_ADDON_FOUND = [
    "Google", "Yahoo", "Perplexity", "ChatGPT / OpenAI", "You.com", "Mojeek", "Phind", "SearXNG",
    "Mullvad Leta", "Presearch", "Naver", "Baidu",
]
EVERY_SITE = {"<all_urls>", "*://*/*", "http://*/*", "https://*/*", "*://*/", "http://*/", "https://*/"}


def is_site_pattern(entry):
    return entry == "<all_urls>" or "://" in entry


def read_manifest(manifest, script_bytes=None, package_bytes=None):
    """The facts of one manifest, as plain values."""
    declared = [entry for entry in manifest.get("permissions", []) if isinstance(entry, str)]
    sites = [entry for entry in declared if is_site_pattern(entry)]
    sites += [entry for entry in manifest.get("host_permissions", []) if isinstance(entry, str)]
    content_scripts = manifest.get("content_scripts", [])
    for script in content_scripts:
        sites += script.get("matches", [])
    sites = sorted(set(sites))
    api = sorted(set(entry for entry in declared if not is_site_pattern(entry)))
    optional = sorted(set(manifest.get("optional_permissions", []) + manifest.get("optional_host_permissions", [])))
    overrides = manifest.get("chrome_settings_overrides", {})
    policy = manifest.get("content_security_policy", "")
    if isinstance(policy, dict):
        policy = policy.get("extension_pages", "")
    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    return {
        "name": manifest.get("name", ""),
        "version": manifest.get("version", ""),
        "manifest_version": manifest.get("manifest_version"),
        "browser_permissions": api,
        "site_patterns": len(sites),
        "site_patterns_sample": sites[:5],
        "every_site": any(entry in EVERY_SITE for entry in sites),
        "optional": optional,
        "does": {
            "default_search_engine": "search_provider" in overrides,
            "home_page": "homepage" in overrides,
            "new_tab_page": "newtab" in manifest.get("chrome_url_overrides", {}),
            "toolbar_button": "action" in manifest or "browser_action" in manifest,
            "address_bar_keyword": "omnibox" in manifest,
            "right_click_entry": "contextMenus" in api or "menus" in api,
            "scripts_inside_web_pages": bool(content_scripts),
        },
        "own_pages_barred_from_network": "default-src 'none'" in policy and "connect-src" not in policy,
        "declares_no_data_collection": gecko.get("data_collection_permissions", {}).get("required") == ["none"],
        "script_bytes": script_bytes,
        "package_bytes": package_bytes,
    }


def telisik_row():
    folder = ROOT / "extension"
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    scripts = sum(path.stat().st_size for path in folder.rglob("*.js"))
    row = read_manifest(manifest, script_bytes=scripts)
    row.update({"slug": "(this repository)", "author": "juw12", "daily_users": None, "store_name": manifest["name"]})
    return row


def fetch(opener, url, limit=30_000_000):
    request = urllib.request.Request(url, headers={"User-Agent": "telisik-compare-permissions/1.0"})
    with opener.open(request, timeout=60) as response:
        return response.read(limit)


def store_row(opener, slug):
    detail = json.loads(fetch(opener, API.format(slug=urllib.request.quote(slug))).decode("utf-8"))
    file_info = detail["current_version"]["file"]
    package = fetch(opener, file_info["url"])
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        manifest = json.loads(archive.read("manifest.json").decode("utf-8-sig"))
        scripts = sum(info.file_size for info in archive.infolist() if info.filename.endswith(".js"))
    row = read_manifest(manifest, script_bytes=scripts, package_bytes=len(package))
    names = detail["name"]
    row.update({
        "slug": slug,
        "author": ", ".join(author["name"] for author in detail["authors"]),
        "daily_users": detail.get("average_daily_users"),
        "store_name": names.get("en-US") or next(iter(names.values())),
        "package_sha256": file_info.get("hash", ""),
    })
    return row


def access_key(row):
    """Smaller means less to trust: every site first, then site patterns, then browser permissions."""
    return (row["every_site"], row["site_patterns"], len(row["browser_permissions"]))


def verdict(telisik, others):
    """Sentences worked out from the rows, so the README cannot drift from the data."""
    lines = []
    less = [row for row in others if access_key(row) < access_key(telisik)]
    same = [row for row in others if access_key(row) == access_key(telisik)]
    more = [row for row in others if access_key(row) > access_key(telisik)]
    lines.append(
        f"Of {len(others)} add-ons, {len(more)} ask for more than Telisik, {len(same)} for the same and {len(less)} for less."
    )
    if less:
        names = "; ".join(f"{row['store_name']} ({row['author']})" for row in less)
        lines.append(f"Asking for less: {names}.")
        only_engine = [row for row in less if not any(
            row["does"][key] for key in ("new_tab_page", "toolbar_button", "address_bar_keyword", "right_click_entry")
        )]
        if len(only_engine) == len(less):
            lines.append(
                "Each of those only changes the browser's search engine or home page; none adds a new tab page, "
                "a toolbar button, an address-bar keyword or a right-click entry."
            )
    wanted = [key for key, value in telisik["does"].items() if value]
    matching = [row for row in others if all(row["does"][key] for key in wanted)]
    lines.append(
        f"Add-ons that do everything Telisik's does ({', '.join(wanted).replace('_', ' ')}): {len(matching)}."
    )
    with_page_scripts = [row for row in others if row["does"]["scripts_inside_web_pages"]]
    every_site = [row for row in others if row["every_site"]]
    with_sites = [row for row in others if row["site_patterns"]]
    lines.append(
        f"{len(with_sites)} of {len(others)} can read or change at least one website, {len(every_site)} of them every website; "
        f"{len(with_page_scripts)} run scripts inside web pages. Telisik: no website, no script inside pages."
    )
    barred = [row for row in others if row["own_pages_barred_from_network"]]
    lines.append(
        f"Add-ons whose own pages are barred from the network by their content security policy: {len(barred)} of {len(others)}"
        f"{' (Telisik: yes)' if telisik['own_pages_barred_from_network'] else ''}."
    )
    return lines


def table(telisik, others):
    def cell(row):
        does = [key.replace("_", " ") for key, value in row["does"].items() if value]
        sites = "every site" if row["every_site"] else (str(row["site_patterns"]) if row["site_patterns"] else "none")
        users = "" if row["daily_users"] is None else f"{row['daily_users']:,}"
        return (
            f"| {row['store_name']} | {row['author']} | {users} | {len(row['browser_permissions'])} | {sites} | "
            f"{', '.join(row['browser_permissions']) or 'none'} | {', '.join(does) or 'nothing listed'} |"
        )

    lines = [
        "| Add-on | From | Daily users | Browser permissions | Websites it can read or change | Which permissions | What it does |",
        "| --- | --- | ---: | ---: | --- | --- | --- |",
        cell(telisik).replace(f"| {telisik['store_name']} |", "| **Telisik** (not in the store) |", 1),
    ]
    lines += [cell(row) for row in sorted(others, key=lambda row: (access_key(row), row["store_name"]))]
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--proxy", default=None, help="for example http://proxy.example:80")
    parser.add_argument("--saved", action="store_true", help="print from the saved data, no network")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    telisik = telisik_row()
    if args.saved:
        saved = json.loads(SAVED.read_text(encoding="utf-8"))
        others, read_on = saved["addons"], saved["read_on"]
    else:
        handlers = [urllib.request.ProxyHandler({"http": args.proxy, "https": args.proxy})] if args.proxy else []
        opener = urllib.request.build_opener(*handlers)
        others = []
        for slug in SAMPLE:
            print(f"reading {slug}", file=sys.stderr, flush=True)
            others.append(store_row(opener, slug))
        read_on = datetime.date.today().isoformat()
        saved = {
            "read_on": read_on,
            "source": "addons.mozilla.org, the current public package of each add-on; manifest.json inside it",
            "names_searched_in_the_store": SEARCHED,
            "no_add_on_from_the_engine_itself_found_for": NO_OWN_ADDON_FOUND,
            "telisik": telisik,
            "addons": others,
        }
        SAVED.write_text(json.dumps(saved, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"read on {read_on}; {len(others)} add-ons from the search engines' own accounts on addons.mozilla.org\n")
    print("\n".join(table(telisik, others)))
    print()
    for line in verdict(telisik, others):
        print(line)
    if json.dumps(saved["telisik"], sort_keys=True) != json.dumps(telisik, sort_keys=True):
        print("\nnote: Telisik's manifest changed since the data was saved; run without --saved to refresh")


if __name__ == "__main__":
    main()
