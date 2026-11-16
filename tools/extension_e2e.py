"""Check the browser extension inside real browsers.

    python tools/extension_e2e.py                      Chromium that Playwright ships
    python tools/extension_e2e.py --browser chrome     the Chrome installed on this computer
    python tools/extension_e2e.py --browser edge       the Edge installed on this computer
    python tools/extension_e2e.py --browser firefox    Firefox (--firefox-binary PATH if it is not found)
    python tools/extension_e2e.py --shots DIR          also save screenshots

Hermetic: the browser gets a proxy that does not exist, and in Chromium the pages of
https://juw12.github.io/telisik/ are answered from this folder. Nothing reaches the network.
The browser runs headless on a throwaway profile; only that browser is stopped at the end.

Four things need the real keyboard and mouse of the computer and are not done here: typing "tk"
in the real address bar, opening the real right-click menu, pressing Alt+Shift+K and the real toolbar
bubble. Here the code those four run is called directly; tools/extension_real_input.py does them
with real keys and a real mouse in a window on the screen.
Exit code 1 when a check fails.
"""

import argparse
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "extension"
HOME = "https://juw12.github.io/telisik/"
DEAD_PROXY_PORT = 9
MENU_ID = "telisik-search-selection"
GECKO_ID = "telisik@juw12.github.io"
SHORTCUT = "Alt+Shift+K"
# Installed browsers that Playwright starts by channel: its channel name and the name to print.
BRANDED = {"chrome": ("chrome", "Chrome"), "edge": ("msedge", "Edge")}
ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"
ENTER = "\ue007"

# What is typed or selected, and the query that must arrive.
TYPED = ("  binary   search tree ", "binary search tree")
ADDRESS_BAR = ("rust borrow checker", "rust borrow checker")
NEW_TAB = ("c++ & c# \u00fcber", "c++ & c# \u00fcber")
BACKGROUND_TAB = ("what is 50% of 1/2?", "what is 50% of 1/2?")
SELECTION = ("Krebs\n  cycle\tsteps", "Krebs cycle steps")
POPUP = ("toolbar question", "toolbar question")


def search_url(query):
    """The same rule as extension/url.js, written a second time on purpose."""
    from urllib.parse import urlencode

    return HOME + "#" + urlencode({"q": query})


class Checks:
    def __init__(self):
        self.passed = 0
        self.total = 0

    def check(self, name, ok, detail=""):
        self.total += 1
        if ok:
            self.passed += 1
            print(f"ok    {name}", flush=True)
        else:
            print(f"FAIL  {name}: {detail}", flush=True)
        return bool(ok)

    def note(self, text):
        print(f"      {text}", flush=True)


def stop_marked_processes(marker):
    """Stop the browser started here and nothing else: its command line holds the profile folder."""
    if os.name == "nt":
        query = (
            "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*" + marker + "*' } | "
            "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
        )
        # Listing every process took over 40 s once on a busy computer (measured), so the limit is generous.
        subprocess.run(["powershell", "-NoProfile", "-Command", query], capture_output=True, timeout=120)
    else:
        subprocess.run(["pkill", "-f", marker], capture_output=True, timeout=40)


def remove_folder(folder):
    for _ in range(5):
        shutil.rmtree(folder, ignore_errors=True)
        if not Path(folder).exists():
            return
        time.sleep(0.5)


def wait_until(probe, seconds=30.0, pause=0.2):
    """Ask until the answer is truthy; return the last answer either way."""
    deadline = time.time() + seconds
    answer = probe()
    while not answer and time.time() < deadline:
        time.sleep(pause)
        answer = probe()
    return answer


def save_png(shots, name, data):
    if shots:
        Path(shots).mkdir(parents=True, exist_ok=True)
        Path(shots, name).write_bytes(data)


# ---------------------------------------------------------------------------------------------
# Chromium and Chrome
# ---------------------------------------------------------------------------------------------

PAGE_AUDIT_JS = """
() => new Promise((resolve) => {
  const root = document.documentElement;
  const report = {
    overflow: Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth,
    focus: document.activeElement ? document.activeElement.id : "",
    resources: performance.getEntriesByType("resource").map((entry) => entry.name),
    blocked: "",
  };
  document.addEventListener("securitypolicyviolation", (event) => {
    report.blocked = event.effectiveDirective;
    resolve(report);
  }, { once: true });
  fetch("https://example.com/telisik-must-not-leave").then(
    () => { report.blocked = "not blocked: the request was answered"; resolve(report); },
    () => {},
  );
  setTimeout(() => { report.blocked = report.blocked || "no violation event within 3 s"; resolve(report); }, 3000);
})
"""

WORKER_FACTS_JS = """
async () => {
  const handlers = globalThis.telisikHandlers;
  if (!handlers) {
    return { handlers: false };
  }
  const permissions = await chrome.permissions.getAll();
  const commands = await chrome.commands.getAll();
  return {
    handlers: true,
    menuId: handlers.MENU_ID,
    addressBar: chrome.omnibox.onInputEntered.hasListener(handlers.openFromAddressBar),
    suggestion: chrome.omnibox.onInputStarted.hasListeners(),
    menuClick: chrome.contextMenus.onClicked.hasListener(handlers.openFromMenu),
    menu: await chrome.contextMenus.update(handlers.MENU_ID, {}).then(() => "ok", (error) => String(error)),
    permissions: permissions.permissions || [],
    origins: permissions.origins || [],
    commands: commands.map((command) => [command.name, command.shortcut]),
    popup: await chrome.action.getPopup({}),
  };
}
"""

EXTENSION_INFO_JS = """
(id) => Promise.race([
  chrome.developerPrivate.getExtensionInfo(id).then((info) => ({
    state: info.state,
    manifestErrors: info.manifestErrors || [],
    installWarnings: info.installWarnings || [],
    runtimeErrors: (info.runtimeErrors || []).map((error) => error.message),
    runtimeWarnings: info.runtimeWarnings || [],
  })),
  new Promise((resolve) => setTimeout(() => resolve({ state: "no answer within 20 s" }), 20000)),
])
"""

DEVELOPER_MODE_JS = """
() => Promise.race([
  chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }).then(() => "on"),
  new Promise((resolve) => setTimeout(() => resolve("no answer within 20 s"), 20000)),
])
"""


def run_chromium(args, checks):
    from playwright.sync_api import sync_playwright

    profile = tempfile.mkdtemp(prefix="telisik-ext-")
    marker = Path(profile).name
    refused = []

    def answer_from_folder(route):
        url = route.request.url
        if not url.startswith(HOME):
            refused.append(url)
            route.abort()
            return
        relative = unquote(urlparse(url).path[len("/telisik/"):]) or "index.html"
        target = (ROOT / relative).resolve()
        if ROOT in target.parents and target.is_file():
            route.fulfill(path=str(target))
        else:
            route.fulfill(status=404, body="not in the folder")

    try:
        with sync_playwright() as playwright:
            # Every tab the extension opens runs into this proxy, which does not exist.
            switches = [f"--proxy-server=http://127.0.0.1:{DEAD_PROXY_PORT}"]
            if args.browser in BRANDED:
                # Chrome took --load-extension out of its branded builds, and Edge is loaded the same
                # way: the folder goes in the way the "Load unpacked" button does, over the debugging
                # protocol.
                context = playwright.chromium.launch_persistent_context(
                    profile,
                    channel=BRANDED[args.browser][0],
                    headless=True,
                    args=switches + ["--enable-unsafe-extension-debugging"],
                    ignore_default_args=["--disable-extensions"],
                )
            else:
                context = playwright.chromium.launch_persistent_context(
                    profile,
                    channel="chromium",
                    headless=True,
                    args=switches + [f"--disable-extensions-except={EXTENSION}", f"--load-extension={EXTENSION}"],
                )
            context.set_default_timeout(8000)
            name = BRANDED[args.browser][1] if args.browser in BRANDED else "Chromium"
            print(f"browser: {name} {context.browser.version}", flush=True)
            session = context.browser.new_browser_cdp_session()

            settings = context.new_page()
            settings.goto("chrome://extensions/")
            developer_mode = settings.evaluate(DEVELOPER_MODE_JS)
            extension_id = ""
            if args.browser in BRANDED:
                extension_id = session.send("Extensions.loadUnpacked", {"path": str(EXTENSION)})["id"]

            def wait_for(probe, seconds=20.0):
                """Like wait_until, but Playwright keeps reading the browser's messages while it waits."""
                deadline = time.time() + seconds
                answer = probe()
                while not answer and time.time() < deadline:
                    settings.wait_for_timeout(150)
                    answer = probe()
                return answer

            def tabs():
                """Every tab and its address, as the browser itself reports them."""
                targets = session.send("Target.getTargets")["targetInfos"]
                return {target["targetId"]: target["url"] for target in targets if target["type"] == "page"}

            def opened_since(before, address):
                return [key for key, url in tabs().items() if key not in before and url == address]

            def worker():
                for candidate in context.service_workers:
                    if candidate.url.startswith("chrome-extension://") and candidate.url.endswith("/background.js"):
                        return candidate
                return None

            background = wait_for(worker, 10)
            if not checks.check("the background worker starts", background is not None, "no service worker"):
                return
            extension_id = extension_id or background.url.split("/")[2]
            origin = f"chrome-extension://{extension_id}"

            # --- new tab page ---------------------------------------------------------------
            page = context.new_page()
            page.route(lambda url: url.startswith("http"), answer_from_folder)
            page_requests = []
            problems = []
            page.on("request", lambda request: page_requests.append(request.url))
            page.on("console", lambda message: problems.append(message.text) if message.type == "error" else None)
            page.on("pageerror", lambda error: problems.append(str(error)))
            page.goto("chrome://newtab/")
            checks.check("a new tab opens the extension's page", page.url == f"{origin}/newtab.html", page.url)
            page.wait_for_timeout(400)
            audit = page.evaluate(PAGE_AUDIT_JS)
            outside = [url for url in page_requests + audit["resources"] if not url.startswith(origin)]
            checks.check("the new tab page loads nothing from outside the extension", not outside, outside)
            checks.check(
                "a network request from the page is blocked by its content security policy",
                audit["blocked"] == "connect-src",
                audit["blocked"],
            )
            # Opened by address, as here, the page gets the cursor. After a real Ctrl+T the browser keeps the
            # cursor in its own address bar (measured with tools/extension_real_input.py); that is not claimed here.
            checks.check("the new tab page, opened by its address, has the cursor in the search box", audit["focus"] == "q", audit["focus"])
            for width in (320, 1280):
                page.set_viewport_size({"width": width, "height": 720})
                overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                checks.check(f"new tab page: no sideways scroll at {width} px", overflow <= 0, f"{overflow} px")
                for scheme in ("light", "dark"):
                    page.emulate_media(color_scheme=scheme)
                    save_png(args.shots, f"{args.browser}-newtab-{width}-{scheme}.png", page.screenshot())
            page.emulate_media(color_scheme="light")
            # The blocked request above is reported in the console; that one line is the policy working.
            problems = [text for text in problems if "telisik-must-not-leave" not in text]
            checks.check("the new tab page reports no error", not problems, problems)

            page.fill("#q", TYPED[0])
            page.press("#q", "Enter")
            page.wait_for_url(search_url(TYPED[1]))
            checks.check("typing and Enter opens Telisik with the query", page.url == search_url(TYPED[1]), page.url)
            read_box = "document.querySelector('#q') ? document.querySelector('#q').value : 'no #q'"
            wait_for(lambda: page.evaluate(read_box) == TYPED[1])
            checks.check("the site shows that query in its search box", page.evaluate(read_box) == TYPED[1], page.evaluate(read_box))
            save_png(args.shots, f"{args.browser}-site-after-search.png", page.screenshot())

            page.goto(f"{origin}/newtab.html")
            page.press("#q", "Enter")
            # Only the address matters here; Chrome can keep the home page "loading" past the timeout.
            page.wait_for_url(HOME, wait_until="commit")
            checks.check("an empty search box opens the home page", page.url == HOME, page.url)

            # --- what the browser registered ---------------------------------------------------
            facts = background.evaluate(WORKER_FACTS_JS)
            if checks.check("the background worker exposes its handlers", facts.get("handlers"), facts):
                if facts["menu"] != "ok":
                    wait_for(lambda: background.evaluate(WORKER_FACTS_JS)["menu"] == "ok", 5)
                    facts = background.evaluate(WORKER_FACTS_JS)
                checks.check("the address-bar keyword has its listener", facts["addressBar"] and facts["suggestion"], facts)
                checks.check("the right-click entry exists and has its listener", facts["menu"] == "ok" and facts["menuClick"] and facts["menuId"] == MENU_ID, facts)
                # Chrome lists "newTabPageOverride" itself for any extension that replaces the new tab page.
                checks.check(
                    "the permissions are contextMenus plus the new-tab override Chrome lists itself, with no site access",
                    sorted(facts["permissions"]) == ["contextMenus", "newTabPageOverride"] and facts["origins"] == [],
                    facts,
                )
                checks.check(f"the toolbar button has the shortcut {SHORTCUT}", ["_execute_action", SHORTCUT] in facts["commands"], facts["commands"])
                checks.check("the toolbar button opens the popup", facts["popup"] == f"{origin}/popup.html", facts["popup"])

            # --- the code behind the address bar and the right-click menu ---------------------
            front = context.new_page()
            front.goto(f"{origin}/newtab.html")
            front.bring_to_front()
            front_id = context.new_cdp_session(front).send("Target.getTargetInfo")["targetInfo"]["targetId"]
            before = tabs()
            background.evaluate("([text]) => telisikHandlers.openFromAddressBar(text, 'currentTab').then(() => true)", [ADDRESS_BAR[0]])
            wait_for(lambda: tabs().get(front_id) == search_url(ADDRESS_BAR[1]))
            after = tabs()
            checks.check(
                "address bar, Enter: the search opens in the tab in front",
                after.get(front_id) == search_url(ADDRESS_BAR[1]) and set(after) == set(before),
                {"front": after.get(front_id), "tabs": sorted(after.values())},
            )

            before = tabs()
            made = background.evaluate("([text]) => telisikHandlers.openFromAddressBar(text, 'newForegroundTab').then((tab) => ({ active: tab.active }))", [NEW_TAB[0]])
            found = wait_for(lambda: opened_since(before, search_url(NEW_TAB[1])))
            checks.check("address bar, Alt+Enter: the search opens in a new tab in front", len(found) == 1 and made["active"], {"tab": made, "tabs": sorted(tabs().values())})

            before = tabs()
            made = background.evaluate("([text]) => telisikHandlers.openFromAddressBar(text, 'newBackgroundTab').then((tab) => ({ active: tab.active }))", [BACKGROUND_TAB[0]])
            found = wait_for(lambda: opened_since(before, search_url(BACKGROUND_TAB[1])))
            checks.check("address bar, background tab: the search opens behind", len(found) == 1 and not made["active"], {"tab": made, "tabs": sorted(tabs().values())})

            before = tabs()
            made = background.evaluate(
                "([id, text]) => telisikHandlers.openFromMenu({ menuItemId: id, selectionText: text }, { index: 0 }).then((tab) => ({ index: tab.index }))",
                [MENU_ID, SELECTION[0]],
            )
            found = wait_for(lambda: opened_since(before, search_url(SELECTION[1])))
            checks.check("right-click on selected text: the search opens next to that tab", len(found) == 1 and made["index"] == 1, {"tab": made, "tabs": sorted(tabs().values())})

            before = tabs()
            ignored = background.evaluate("() => telisikHandlers.openFromMenu({ menuItemId: 'someone-else', selectionText: 'x' }, { index: 0 }) === undefined")
            settings.wait_for_timeout(400)
            checks.check("a menu click that is not Telisik's opens nothing", ignored and set(tabs()) == set(before), sorted(tabs().values()))

            # --- toolbar popup (the same page the bubble shows, opened as a tab) ---------------
            popup = context.new_page()
            popup_problems = []
            popup.on("console", lambda message: popup_problems.append(message.text) if message.type == "error" else None)
            popup.on("pageerror", lambda error: popup_problems.append(str(error)))
            popup.set_viewport_size({"width": 368, "height": 220})
            popup.goto(f"{origin}/popup.html")
            overflow = popup.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            checks.check("popup: no sideways scroll at its own width", overflow <= 0, f"{overflow} px")
            hint_hidden = popup.evaluate("document.getElementById('firefox-hint').hidden")
            checks.check("popup: the hint that is only for Firefox stays hidden here", hint_hidden is True, hint_hidden)
            for scheme in ("light", "dark"):
                popup.emulate_media(color_scheme=scheme)
                save_png(args.shots, f"{args.browser}-popup-{scheme}.png", popup.screenshot())
            popup.fill("#q", POPUP[0])
            before = tabs()
            try:
                popup.press("#q", "Enter")
            except Exception:
                pass  # the popup closes itself after it opened the tab
            found = wait_for(lambda: opened_since(before, search_url(POPUP[1])))
            checks.check("popup: Enter opens the search in a new tab", len(found) == 1, sorted(tabs().values()))
            checks.check("the popup reports no error", not popup_problems, popup_problems)

            # --- what the browser itself says about the extension, after all of the above ------
            info = settings.evaluate(EXTENSION_INFO_JS, extension_id)
            checks.check("the browser lists the extension as enabled", info.get("state") == "ENABLED", info)
            if developer_mode == "on":
                checks.check(
                    "the browser reports no manifest error, install warning or runtime error",
                    not info.get("manifestErrors") and not info.get("installWarnings") and not info.get("runtimeErrors"),
                    info,
                )
            else:
                checks.check("developer mode could be switched on to read the browser's error list", False, developer_mode)
            checks.note(f"requests the site made to its sources after the search, refused by the test: {len(refused)}")
            # The browser is stopped below by its profile folder; context.close() can hang with a worker attached.
    finally:
        stop_marked_processes(marker)
        remove_folder(profile)


# ---------------------------------------------------------------------------------------------
# Firefox (Marionette, the remote control built into Firefox)
# ---------------------------------------------------------------------------------------------


class Marionette:
    def __init__(self, port):
        deadline = time.time() + 60
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=90)
                break
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)
        self.buffer = b""
        self.count = 0
        self.receive()

    def receive(self):
        while b":" not in self.buffer:
            self.buffer += self.sock.recv(65536)
        length, _, rest = self.buffer.partition(b":")
        length = int(length)
        while len(rest) < length:
            rest += self.sock.recv(65536)
        self.buffer = rest[length:]
        return json.loads(rest[:length])

    def send(self, name, params=None):
        self.count += 1
        payload = json.dumps([0, self.count, name, params or {}]).encode("utf-8")
        self.sock.sendall(str(len(payload)).encode() + b":" + payload)
        _, _, error, result = self.receive()
        if error:
            raise RuntimeError(f"{name}: {error.get('error')}: {error.get('message')}")
        if isinstance(result, dict) and set(result) == {"value"}:
            return result["value"]
        return result

    def scope(self, name):
        self.send("Marionette:SetContext", {"value": name})

    def browser_script(self, script, arguments=()):
        """Run in the browser's own scope (not in a page)."""
        self.scope("chrome")
        try:
            return self.send("WebDriver:ExecuteScript", {"script": script, "args": list(arguments)})
        finally:
            self.scope("content")

    def page_script(self, body, arguments=()):
        """Run an async body in the page; `api` is the extension API, the value returned comes back."""
        script = (
            "const done = arguments[arguments.length - 1];"
            "const api = window.browser || (window.wrappedJSObject && window.wrappedJSObject.browser);"
            "(async () => {" + body + "})().then("
            "(value) => done(JSON.stringify({ value: value === undefined ? null : value })),"
            "(error) => done(JSON.stringify({ error: String(error) })));"
        )
        answer = json.loads(self.send("WebDriver:ExecuteAsyncScript", {"script": script, "args": list(arguments), "sandbox": None}))
        if "error" in answer:
            raise RuntimeError(answer["error"])
        return answer["value"]


FIREFOX_POLICY_JS = """
const { AboutNewTab } = ChromeUtils.importESModule("resource:///modules/AboutNewTab.sys.mjs");
const policy = WebExtensionPolicy.getByID(arguments[0]);
if (!policy) {
  return { found: false };
}
return {
  found: true,
  host: policy.mozExtensionHostname,
  newTab: AboutNewTab.newTabURL,
  warnings: Array.from(policy.extension.warnings || [], String),
  errors: Array.from(policy.extension.errors || [], String),
  temporary: policy.temporarilyInstalled,
};
"""

FIREFOX_TABS_JS = """
const tabs = Services.wm.getMostRecentWindow("navigator:browser").gBrowser;
return {
  urls: Array.from(tabs.tabs, (tab) => tab.linkedBrowser.currentURI.spec),
  selected: tabs.tabContainer.selectedIndex,
};
"""

FIREFOX_OPEN_TAB_JS = """
const win = Services.wm.getMostRecentWindow("navigator:browser");
if (win.BrowserCommands && win.BrowserCommands.openTab) {
  win.BrowserCommands.openTab();
} else {
  win.BrowserOpenTab();
}
return true;
"""

FIREFOX_FACTS_JS = """
const background = await api.runtime.getBackgroundPage();
const handlers = background && background.telisikHandlers;
if (!handlers) {
  return { handlers: false };
}
const permissions = await api.permissions.getAll();
const commands = await api.commands.getAll();
return {
  handlers: true,
  menuId: handlers.MENU_ID,
  addressBar: background.browser.omnibox.onInputEntered.hasListener(handlers.openFromAddressBar),
  menuClick: background.browser.contextMenus.onClicked.hasListener(handlers.openFromMenu),
  menu: await api.contextMenus.update(handlers.MENU_ID, {}).then(() => "ok", (error) => String(error)),
  permissions: permissions.permissions || [],
  origins: permissions.origins || [],
  commands: commands.map((command) => [command.name, command.shortcut]),
  popup: await api.action.getPopup({}),
};
"""

FIREFOX_AUDIT_JS = """
const root = document.documentElement;
const report = {
  overflow: Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth,
  width: root.clientWidth,
  focus: document.activeElement ? document.activeElement.id : "",
  resources: performance.getEntriesByType("resource").map((entry) => entry.name),
  blocked: "",
};
await new Promise((resolve) => {
  document.addEventListener("securitypolicyviolation", (event) => {
    report.blocked = event.effectiveDirective;
    resolve();
  }, { once: true });
  fetch("https://example.com/telisik-must-not-leave").then(
    () => { report.blocked = "not blocked: the request was answered"; resolve(); },
    () => {},
  );
  setTimeout(() => { report.blocked = report.blocked || "no violation event within 3 s"; resolve(); }, 3000);
});
return report;
"""


def firefox_environment():
    """The environment Firefox is started with.

    The tests reach Firefox's own toolbar and address bar through Marionette. The Firefox that Playwright
    ships allows that with the -remote-allow-system-access switch alone; release Firefox (160 tested) also
    wants this variable, and without it answers "System access is required".
    """
    environment = dict(os.environ)
    environment["MOZ_REMOTE_ALLOW_SYSTEM_ACCESS"] = "1"
    return environment


def find_firefox(named):
    candidates = [named, os.environ.get("TELISIK_FIREFOX")]
    stores = [os.environ.get("PLAYWRIGHT_BROWSERS_PATH"), str(Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright")]
    for store in stores:
        if store and Path(store).is_dir():
            candidates += [str(path) for path in sorted(Path(store).glob("firefox-*/firefox/firefox.exe"), reverse=True)]
            candidates += [str(path) for path in sorted(Path(store).glob("firefox-*/firefox/firefox"), reverse=True)]
    candidates += [
        r"C:\Program Files\Mozilla Firefox\firefox.exe",
        r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe",
        "/Applications/Firefox.app/Contents/MacOS/firefox",
        shutil.which("firefox"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def run_firefox(args, checks):
    sys.path.insert(0, str(ROOT / "tools"))
    import pack_extension

    binary = find_firefox(args.firefox_binary)
    if not binary:
        checks.check("Firefox is on this computer", False, "not found; pass --firefox-binary PATH")
        return
    profile = tempfile.mkdtemp(prefix="telisik-fx-")
    marker = Path(profile).name
    build = tempfile.mkdtemp(prefix="telisik-fx-build-")
    folder = pack_extension.build(build)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    preferences = {
        "marionette.port": port,
        "network.proxy.type": 1,
        "network.proxy.http": "127.0.0.1",
        "network.proxy.http_port": DEAD_PROXY_PORT,
        "network.proxy.ssl": "127.0.0.1",
        "network.proxy.ssl_port": DEAD_PROXY_PORT,
        "browser.shell.checkDefaultBrowser": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "app.update.enabled": False,
        "browser.aboutwelcome.enabled": False,
        "browser.startup.homepage_override.mstone": "ignore",
    }
    Path(profile, "user.js").write_text(
        "\n".join(f"user_pref({json.dumps(name)}, {json.dumps(value)});" for name, value in preferences.items()),
        encoding="utf-8",
    )
    process = subprocess.Popen(
        [binary, "-marionette", "-headless", "-no-remote", "-remote-allow-system-access", "-profile", profile],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=firefox_environment(),
    )
    try:
        client = Marionette(port)
        session = client.send("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": False}}})
        version = session.get("capabilities", {}).get("browserVersion", "?")
        print(f"browser: Firefox {version}", flush=True)
        client.send("WebDriver:SetTimeouts", {"script": 20000, "pageLoad": 15000, "implicit": 0})

        installed = client.send("Addon:Install", {"path": str(folder), "temporary": True})
        if not checks.check("Firefox installs the extension", installed == GECKO_ID, installed):
            return
        policy = client.browser_script(FIREFOX_POLICY_JS, [GECKO_ID])
        if not checks.check("Firefox lists the extension as active", policy.get("found"), policy):
            return
        origin = f"moz-extension://{policy['host']}"
        checks.check("Firefox reports no warning and no error for the manifest", not policy["warnings"] and not policy["errors"], policy)
        checks.check("Firefox's new tab address is the extension's page", policy["newTab"] == f"{origin}/newtab.html", policy["newTab"])

        def tabs():
            return client.browser_script(FIREFOX_TABS_JS)

        def selected_url():
            state = tabs()
            return state["urls"][state["selected"]]

        def settle_on(expected, seconds=60.0):
            """Follow the tab in front until it shows the expected address.

            Firefox passes through about:blank on the way to a new address, so
            one early reading is not the answer. Returns every address seen, in order.
            The limit is long because release Firefox 160 stayed on about:blank for 5 to 26 s
            before it gave up on the proxy that refuses everything (measured; the Firefox that
            Playwright ships took under 20 s every time). It returns as soon as the address is there.
            """
            seen = []
            deadline = time.time() + seconds
            while True:
                url = selected_url()
                if not seen or seen[-1] != url:
                    seen.append(url)
                if url == expected or time.time() > deadline:
                    return seen
                time.sleep(0.2)

        before = len(tabs()["urls"])
        client.browser_script(FIREFOX_OPEN_TAB_JS)
        wait_until(lambda: selected_url() == f"{origin}/newtab.html")
        state = tabs()
        checks.check(
            "a new tab opens the extension's page",
            len(state["urls"]) == before + 1 and state["urls"][state["selected"]] == f"{origin}/newtab.html",
            state,
        )

        # The page under test is the robot's own tab; the tab opened above stays in front.
        client.send("WebDriver:Navigate", {"url": f"{origin}/newtab.html"})
        audit = client.page_script(FIREFOX_AUDIT_JS)
        outside = [url for url in audit["resources"] if not url.startswith(origin)]
        checks.check("the new tab page loads nothing from outside the extension", not outside, outside)
        checks.check("a network request from the page is blocked by its content security policy", audit["blocked"] == "connect-src", audit["blocked"])
        checks.check(f"new tab page: no sideways scroll at {audit['width']} px", audit["overflow"] <= 0, f"{audit['overflow']} px")
        if args.shots:
            save_png(args.shots, "firefox-newtab.png", base64.b64decode(client.send("WebDriver:TakeScreenshot", {"full": True})))

        facts = client.page_script(FIREFOX_FACTS_JS)
        if checks.check("the background script exposes its handlers", facts.get("handlers"), facts):
            checks.check("the address-bar keyword has its listener", facts["addressBar"], facts)
            checks.check("the right-click entry exists and has its listener", facts["menu"] == "ok" and facts["menuClick"] and facts["menuId"] == MENU_ID, facts)
            checks.check("the only permission is contextMenus, with no site access", facts["permissions"] == ["contextMenus"] and facts["origins"] == [], facts)
            checks.check(f"the toolbar button has the shortcut {SHORTCUT}", ["_execute_action", SHORTCUT] in facts["commands"], facts["commands"])
            checks.check("the toolbar button opens the popup", facts["popup"] == f"{origin}/popup.html", facts["popup"])

        call = "const background = await api.runtime.getBackgroundPage(); const handlers = background.telisikHandlers;"

        before = tabs()
        client.page_script(call + "await handlers.openFromAddressBar(arguments[0], 'currentTab'); return true;", [ADDRESS_BAR[0]])
        wait_until(lambda: selected_url() == search_url(ADDRESS_BAR[1]))
        state = tabs()
        checks.check(
            "address bar, Enter: the search opens in the tab in front",
            state["urls"][state["selected"]] == search_url(ADDRESS_BAR[1]) and len(state["urls"]) == len(before["urls"]) and state["selected"] == before["selected"],
            state,
        )

        before = tabs()
        client.page_script(call + "await handlers.openFromAddressBar(arguments[0], 'newForegroundTab'); return true;", [NEW_TAB[0]])
        wait_until(lambda: search_url(NEW_TAB[1]) in tabs()["urls"])
        state = tabs()
        checks.check(
            "address bar, Alt+Enter: the search opens in a new tab in front",
            len(state["urls"]) == len(before["urls"]) + 1 and state["urls"][state["selected"]] == search_url(NEW_TAB[1]),
            state,
        )

        before = tabs()
        front = before["urls"][before["selected"]]
        client.page_script(call + "await handlers.openFromAddressBar(arguments[0], 'newBackgroundTab'); return true;", [BACKGROUND_TAB[0]])
        wait_until(lambda: search_url(BACKGROUND_TAB[1]) in tabs()["urls"])
        state = tabs()
        checks.check(
            "address bar, background tab: the search opens behind",
            len(state["urls"]) == len(before["urls"]) + 1 and search_url(BACKGROUND_TAB[1]) in state["urls"] and state["urls"][state["selected"]] == front,
            state,
        )

        before = tabs()
        made = client.page_script(
            call + "const tab = await handlers.openFromMenu({ menuItemId: handlers.MENU_ID, selectionText: arguments[0] }, { index: 0 }); return tab.index;",
            [SELECTION[0]],
        )
        wait_until(lambda: search_url(SELECTION[1]) in tabs()["urls"])
        state = tabs()
        checks.check(
            "right-click on selected text: the search opens next to that tab",
            made == 1 and len(state["urls"]) == len(before["urls"]) + 1 and state["urls"][1] == search_url(SELECTION[1]),
            {"index": made, "tabs": state},
        )

        before = tabs()
        ignored = client.page_script(call + "return handlers.openFromMenu({ menuItemId: 'someone-else', selectionText: 'x' }, { index: 0 }) === undefined;")
        time.sleep(0.5)
        checks.check("a menu click that is not Telisik's opens nothing", ignored and len(tabs()["urls"]) == len(before["urls"]), tabs())

        # Typing needs the robot's tab in front.
        handle = client.send("WebDriver:GetWindowHandle")
        client.send("WebDriver:SwitchToWindow", {"handle": handle, "focus": True})
        box = client.send("WebDriver:FindElement", {"using": "css selector", "value": "#q"})[ELEMENT_KEY]
        try:
            client.send("WebDriver:ElementSendKeys", {"id": box, "text": TYPED[0] + ENTER})
        except RuntimeError as error:
            checks.note(f"Firefox on the page that cannot load (no network in this test): {str(error)[:90]}")
        seen = settle_on(search_url(TYPED[1]))
        checks.check("typing and Enter opens Telisik with the query", seen[-1] == search_url(TYPED[1]), seen)

        try:
            client.send("WebDriver:Navigate", {"url": f"{origin}/newtab.html"})
        except RuntimeError as error:
            checks.note(f"going back to the new tab page: {str(error)[:90]}")
        box = client.send("WebDriver:FindElement", {"using": "css selector", "value": "#q"})[ELEMENT_KEY]
        try:
            client.send("WebDriver:ElementSendKeys", {"id": box, "text": ENTER})
        except RuntimeError as error:
            checks.note(f"Firefox on the page that cannot load: {str(error)[:90]}")
        seen = settle_on(HOME)
        checks.check("an empty search box opens the home page", seen[-1] == HOME, seen)

        # Toolbar popup: the same page the bubble shows, opened as a tab.
        try:
            client.send("WebDriver:Navigate", {"url": f"{origin}/popup.html"})
        except RuntimeError as error:
            checks.note(f"opening the popup page: {str(error)[:90]}")
        overflow = client.page_script("return document.documentElement.scrollWidth - document.documentElement.clientWidth;")
        checks.check("popup: no sideways scroll", overflow <= 0, f"{overflow} px")
        hint = client.page_script(
            "const hint = document.getElementById('firefox-hint');"
            " return { hidden: hint.hidden, height: hint.getBoundingClientRect().height, text: hint.textContent };"
        )
        checks.check(
            "popup: Firefox shows the hint to click in the box first",
            hint["hidden"] is False and hint["height"] > 0 and "click in the box" in hint["text"],
            hint,
        )
        if args.shots:
            save_png(args.shots, "firefox-popup.png", base64.b64decode(client.send("WebDriver:TakeScreenshot", {"full": True})))
        before = tabs()
        box = client.send("WebDriver:FindElement", {"using": "css selector", "value": "#q"})[ELEMENT_KEY]
        try:
            client.send("WebDriver:ElementSendKeys", {"id": box, "text": POPUP[0] + ENTER})
        except RuntimeError as error:
            checks.note(f"the popup closed itself while Firefox answered: {str(error)[:90]}")
        wait_until(lambda: search_url(POPUP[1]) in tabs()["urls"])
        state = tabs()
        checks.check("popup: Enter opens the search in a new tab", search_url(POPUP[1]) in state["urls"], state)

        policy = client.browser_script(FIREFOX_POLICY_JS, [GECKO_ID])
        checks.check("after all of that Firefox still reports no warning and no error", policy.get("found") and not policy["warnings"] and not policy["errors"], policy)
    finally:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=40)
        else:
            process.kill()
        stop_marked_processes(marker)
        remove_folder(profile)
        remove_folder(build)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--browser", choices=["chromium", "chrome", "edge", "firefox"], default="chromium")
    parser.add_argument("--firefox-binary", default=None)
    parser.add_argument("--shots", default=None)
    parser.add_argument("--seconds", type=int, default=300, help="give up after this long")
    args = parser.parse_args()
    checks = Checks()

    def give_up():
        print(f"FAIL  the run did not finish within {args.seconds} s", flush=True)
        for prefix in ("telisik-ext-", "telisik-fx-"):
            for folder in Path(tempfile.gettempdir()).glob(prefix + "*"):
                if folder.stat().st_mtime >= started:
                    stop_marked_processes(folder.name)
                    remove_folder(folder)
        os._exit(3)

    started = time.time() - 1
    watchdog = threading.Timer(args.seconds, give_up)
    watchdog.daemon = True
    watchdog.start()
    try:
        if args.browser == "firefox":
            run_firefox(args, checks)
        else:
            run_chromium(args, checks)
    except Exception as error:
        checks.check("the run reached its end", False, f"{type(error).__name__}: {str(error)[:600]}")
    watchdog.cancel()
    print(f"{checks.passed}/{checks.total} checks passed", flush=True)
    sys.stdout.flush()
    os._exit(0 if checks.passed == checks.total and checks.total > 0 else 1)


if __name__ == "__main__":
    main()
