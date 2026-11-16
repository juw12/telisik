"""Check the browser extension with a real keyboard and a real mouse (Windows only).

    python tools/extension_real_input.py --browser chrome      the Chrome installed on this computer
    python tools/extension_real_input.py --browser edge        the Edge installed on this computer
    python tools/extension_real_input.py --browser chromium    Chromium that Playwright ships
    python tools/extension_real_input.py --browser firefox     Firefox (--firefox-binary PATH if it is not found)
    python tools/extension_real_input.py --shots DIR           also save pictures of the test window
    python tools/extension_real_input.py --live                the real Telisik site and its real sources answer
    python tools/extension_real_input.py --live --proxy URL    the same, when this network needs a proxy

tools/extension_e2e.py calls the extension's code directly. This one presses the keys and moves the
mouse of the whole computer for about half a minute (about a minute in Firefox), so it covers what that one cannot: Ctrl+T,
typing "tk" in the real address bar, the real right-click menu, Alt+Shift+K and the real toolbar.

Safety rules it keeps:
  * It starts only after keyboard and mouse have been idle for a few seconds (--idle), so it does
    not cut into your typing. If the computer stays busy it gives up and sends nothing.
  * A separate browser on a throwaway profile, in its own window. Only that browser is stopped at the end.
  * Before every key press and every click it checks that the test browser owns the window that gets
    the input. If you take the keyboard back, it stops sending for the rest of the run and those
    checks fail. It never fights you for the window.
  * The address-bar query is only confirmed with Enter after the browser shows that the text goes
    to Telisik. Otherwise Escape is pressed, so no query can fall through to a search engine.
  * Hermetic by default: the browser gets a proxy that does not exist. Nothing reaches the network.
  * With --live the browser gets a gate on this computer instead. The gate lets through the Telisik
    site and the sources named in the connect-src list of index.html, and refuses every other host,
    so no query can reach Google, Bing or any other search engine. What it refused is printed.
  * The mouse pointer is put back where it was, and the window that was in front is asked back.

Firefox: without --live this test cannot answer the Telisik site from the folder there, so the tabs
show Firefox's "proxy refused" page and only the address each tab was sent to is checked. With --live
the page behind each address is read as well.

--live asks the public sources five small questions per run. GitHub answers ten searches a minute
without an account, so leave a minute between runs.

Exit code 1 when a check fails, 4 when the computer was never idle.
"""

import argparse
import ctypes
import http.server
import json
import os
import re
import select
import socket
import socketserver
import subprocess
import sys
import tempfile
import threading
import time
from ctypes import wintypes
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import extension_e2e as shared  # noqa: E402

ROOT = shared.ROOT
EXTENSION = shared.EXTENSION
HOME = shared.HOME
search_url = shared.search_url
wait_until = shared.wait_until

ADDRESS_BAR_QUERY = "rust borrow checker"
SELECTED_TEXT = "Krebs cycle steps"
POPUP_QUERY = "toolbar question"
TOOLBAR_QUERY = "second toolbar question"
NEW_TAB_QUERY = "new tab question"
MENU_LABEL = f"Search Telisik for \u201c{SELECTED_TEXT}\u201d"
STRAY_TEXT = "zq"
RESULT = {}

TEST_PAGE = """<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Telisik real-input test page</title>
<style>
  body { margin: 0; font: 16px sans-serif; background: #fff; color: #111; }
  #target { position: absolute; left: 80px; top: 120px; margin: 0; font-size: 44px; line-height: 1.2; }
  #note { position: absolute; left: 80px; top: 40px; margin: 0; }
</style>
<p id="note">Test window of tools/extension_real_input.py. It closes by itself.</p>
<p id="target">Krebs cycle steps</p>
<script>
  // The page reports where it saw the pointer, so the test can aim without guessing the toolbar height.
  // It is kept twice: as a page variable (read by Chromium) and as an attribute, because Firefox's
  // remote scripts run in a sandbox that sees the document but not the page's own variables.
  addEventListener('mousemove', (event) => {
    window.pointerSeen = { x: event.clientX, y: event.clientY };
    document.documentElement.dataset.pointer = event.clientX + ',' + event.clientY;
  });
</script>
</html>
"""
BLANK_SPOT = (420, 420)  # CSS pixels in the test page where a click does nothing

# ---------------------------------------------------------------------------------------------
# Windows: real keys, real mouse, and who owns the window in front
# ---------------------------------------------------------------------------------------------

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
POINTER_SIZED = ctypes.c_size_t

VK = {
    "ctrl": 0x11,
    "shift": 0x10,
    "alt": 0x12,
    "enter": 0x0D,
    "escape": 0x1B,
    "space": 0x20,
    "tab": 0x09,
    "delete": 0x2E,
}
KEY_UP = 0x0002
KEY_UNICODE = 0x0004
MOUSE_FLAGS = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010)}
MOUSE_MOVE = 0x0001


class MouseInput(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", POINTER_SIZED),
    ]


class KeyboardInput(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", POINTER_SIZED),
    ]


class InputUnion(ctypes.Union):
    _fields_ = [("mouse", MouseInput), ("keyboard", KeyboardInput)]


class Input(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("union", InputUnion)]


class LastInputInfo(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


user32.SendInput.argtypes = [wintypes.UINT, ctypes.POINTER(Input), ctypes.c_int]
user32.SendInput.restype = wintypes.UINT
user32.GetForegroundWindow.restype = wintypes.HWND
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.WindowFromPoint.argtypes = [wintypes.POINT]
user32.WindowFromPoint.restype = wintypes.HWND
user32.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
user32.GetAncestor.restype = wintypes.HWND
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wintypes.UINT]
user32.GetCursorPos.argtypes = [ctypes.POINTER(wintypes.POINT)]
user32.SetCursorPos.argtypes = [ctypes.c_int, ctypes.c_int]
user32.GetLastInputInfo.argtypes = [ctypes.POINTER(LastInputInfo)]
kernel32.GetTickCount.restype = wintypes.DWORD
ENUM_CALLBACK = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [ENUM_CALLBACK, wintypes.LPARAM]
user32.EnumChildWindows.argtypes = [wintypes.HWND, ENUM_CALLBACK, wintypes.LPARAM]


def idle_seconds():
    """How long nobody has touched the keyboard or the mouse."""
    info = LastInputInfo()
    info.cbSize = ctypes.sizeof(LastInputInfo)
    user32.GetLastInputInfo(ctypes.byref(info))
    return ((kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000.0


def wait_for_idle(needed, give_up_after):
    deadline = time.time() + give_up_after
    while idle_seconds() < needed:
        if time.time() > deadline:
            return False
        time.sleep(0.5)
    return True


def window_pid(handle):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(handle, ctypes.byref(pid))
    return pid.value


def window_class(handle):
    buffer = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(handle, buffer, 256)
    return buffer.value


def window_title(handle):
    buffer = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(handle, buffer, 512)
    return buffer.value


def window_rect(handle):
    rect = wintypes.RECT()
    user32.GetWindowRect(handle, ctypes.byref(rect))
    return rect.left, rect.top, rect.right, rect.bottom


def top_windows(pid):
    """Visible top-level windows of one process, front to back."""
    found = []

    def visit(handle, _):
        if user32.IsWindowVisible(handle) and window_pid(handle) == pid:
            found.append(handle)
        return True

    user32.EnumWindows(ENUM_CALLBACK(visit), 0)
    return found


def child_windows(parent, class_name):
    found = []

    def visit(handle, _):
        if user32.IsWindowVisible(handle) and window_class(handle) == class_name:
            found.append(handle)
        return True

    user32.EnumChildWindows(parent, ENUM_CALLBACK(visit), 0)
    return found


def keyboard_event(virtual_key=0, scan=0, flags=0):
    event = Input()
    event.type = 1
    event.union.keyboard = KeyboardInput(virtual_key, scan, flags, 0, 0)
    return event


def mouse_event(flags):
    event = Input()
    event.type = 0
    event.union.mouse = MouseInput(0, 0, 0, flags, 0, 0)
    return event


def send(events):
    array = (Input * len(events))(*events)
    return user32.SendInput(len(events), array, ctypes.sizeof(Input)) == len(events)


class Desk:
    """The keyboard and mouse, usable only while the test browser owns the window in front."""

    def __init__(self, checks):
        self.checks = checks
        self.pid = None
        self.main_window = None
        self.refused = []
        self.lost = False
        self.first_input = None
        self.last_input = None
        self.cursor_before = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(self.cursor_before))
        self.window_before = user32.GetForegroundWindow()

    def owns_front(self):
        return self.pid is not None and window_pid(user32.GetForegroundWindow()) == self.pid

    def bring_to_front(self):
        """Ask Windows to put the test window in front. No key and no click is used for this."""
        handle = self.main_window
        if user32.IsIconic(handle):
            user32.ShowWindow(handle, 9)
        front_thread = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
        this_thread = kernel32.GetCurrentThreadId()
        attached = front_thread and user32.AttachThreadInput(this_thread, front_thread, True)
        user32.BringWindowToTop(handle)
        user32.SetForegroundWindow(handle)
        if attached:
            user32.AttachThreadInput(this_thread, front_thread, False)
        return wait_until(self.owns_front, 2.0, 0.1)

    def click_to_front(self, point):
        """Second way: show the window above the others and click a blank spot inside it."""
        flags = 0x0001 | 0x0002 | 0x0010  # keep size, keep position, do not activate
        user32.SetWindowPos(self.main_window, wintypes.HWND(-1), 0, 0, 0, 0, flags)
        time.sleep(0.3)
        try:
            self.click(point, "a blank spot of the test page", need_front=False)
        finally:
            user32.SetWindowPos(self.main_window, wintypes.HWND(-2), 0, 0, 0, 0, flags)
        return wait_until(self.owns_front, 2.0, 0.1)

    def guard(self, what):
        """True only while the test browser owns the window in front. It is never taken back by force."""
        if not self.lost and self.owns_front():
            return True
        if not self.lost:
            front = user32.GetForegroundWindow()
            self.checks.note(
                f"the window in front now belongs to another program ({window_class(front)}); "
                "no more keys or clicks are sent in this run"
            )
        self.lost = True
        self.refused.append(what)
        return False

    def stamp(self):
        now = time.time()
        self.first_input = self.first_input or now
        self.last_input = now

    def chord(self, *names):
        """Press keys together, for example chord("ctrl", "t"). One batch that cannot be split."""
        if not self.guard("+".join(names)):
            return False
        codes = [VK[name] if name in VK else ord(name.upper()) for name in names]
        events = [keyboard_event(code) for code in codes]
        events += [keyboard_event(code, flags=KEY_UP) for code in reversed(codes)]
        self.stamp()
        sent = send(events)
        time.sleep(0.15)
        return sent

    def type_text(self, text):
        """Type letters as characters, so the keyboard layout and an input method cannot change them."""
        for character in text:
            if not self.guard(f"typing {text!r}"):
                return False
            if character == " ":
                events = [keyboard_event(VK["space"]), keyboard_event(VK["space"], flags=KEY_UP)]
            else:
                code = ord(character)
                events = [keyboard_event(scan=code, flags=KEY_UNICODE), keyboard_event(scan=code, flags=KEY_UNICODE | KEY_UP)]
            self.stamp()
            send(events)
            time.sleep(0.03)
        time.sleep(0.15)
        return True

    def click(self, point, what, button="left", times=1, need_front=True):
        """Click a screen point, but only when the window under that point belongs to the test browser."""
        x, y = int(round(point[0])), int(round(point[1]))
        if need_front and not self.guard(f"click on {what}"):
            return False
        under = user32.GetAncestor(user32.WindowFromPoint(wintypes.POINT(x, y)), 2)
        if window_pid(under) != self.pid:
            self.refused.append(what)
            self.checks.note(f"not clicked ({what}): another program's window ({window_class(under)}) is at {x},{y}")
            return False
        user32.SetCursorPos(x, y)
        time.sleep(0.12)
        down, up = MOUSE_FLAGS[button]
        for _ in range(times):
            self.stamp()
            send([mouse_event(down), mouse_event(up)])
            time.sleep(0.07)
        time.sleep(0.15)
        return True

    def move(self, point, what):
        """Move the pointer, without a click, to a point inside the test browser."""
        x, y = int(round(point[0])), int(round(point[1]))
        if not self.guard(f"pointer to {what}"):
            return False
        under = user32.GetAncestor(user32.WindowFromPoint(wintypes.POINT(x, y)), 2)
        if window_pid(under) != self.pid:
            self.refused.append(what)
            self.checks.note(f"pointer not moved ({what}): another program's window ({window_class(under)}) is at {x},{y}")
            return False
        self.stamp()
        user32.SetCursorPos(x + 1, y)
        time.sleep(0.05)
        user32.SetCursorPos(x, y)
        send([mouse_event(MOUSE_MOVE)])
        time.sleep(0.12)
        return True

    def give_back(self):
        """Put the pointer back and ask for the window that was in front before."""
        cursor = wintypes.POINT()
        if not self.lost:
            user32.SetCursorPos(self.cursor_before.x, self.cursor_before.y)
            # Read at once: a person who is back at the mouse may move it a moment later.
            user32.GetCursorPos(ctypes.byref(cursor))
            if self.window_before and user32.IsWindow(self.window_before):
                user32.SetForegroundWindow(self.window_before)
        else:
            user32.GetCursorPos(ctypes.byref(cursor))
        time.sleep(0.4)
        return {
            "pointer": (cursor.x, cursor.y) == (self.cursor_before.x, self.cursor_before.y),
            "window": user32.GetForegroundWindow() == self.window_before,
        }

    def seconds_of_input(self):
        if not self.first_input:
            return 0.0
        return self.last_input - self.first_input


class Automation:
    """Windows UI Automation: what a screen reader sees of the browser's own buttons and menus."""

    EDIT, BUTTON, MENU_ITEM = 50004, 50000, 50011
    VALUE = 30045

    def __init__(self):
        import comtypes.client

        self.module = comtypes.client.GetModule("UIAutomationCore.dll")
        self.uia = comtypes.client.CreateObject(self.module.CUIAutomation, interface=self.module.IUIAutomation)

    def describe(self, element):
        rect = element.CurrentBoundingRectangle
        try:
            value = element.GetCurrentPropertyValue(self.VALUE)
        except Exception:
            value = None
        return {
            "name": element.CurrentName or "",
            "type": element.CurrentControlType,
            "pid": element.CurrentProcessId,
            "value": value if isinstance(value, str) else "",
            "rect": (rect.left, rect.top, rect.right, rect.bottom),
        }

    def focused(self):
        try:
            return self.describe(self.uia.GetFocusedElement())
        except Exception as error:
            return {"name": "", "type": 0, "pid": 0, "value": "", "rect": (0, 0, 0, 0), "error": str(error)[:200]}

    def find(self, windows, control_type):
        """Every control of one kind inside the given windows."""
        condition = self.uia.CreatePropertyCondition(30003, control_type)
        found = []
        for handle in windows:
            try:
                elements = self.uia.ElementFromHandle(handle).FindAll(4, condition)
                for index in range(elements.Length):
                    found.append(self.describe(elements.GetElement(index)))
            except Exception:
                continue
        return found


def centre(rect):
    return (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2


def grab_window(shots, name, handle):
    """A picture of the test window's rectangle on the screen, menus and bubbles included."""
    if not shots:
        return
    try:
        from PIL import ImageGrab

        Path(shots).mkdir(parents=True, exist_ok=True)
        ImageGrab.grab(bbox=window_rect(handle), all_screens=True).save(Path(shots, name))
    except Exception as error:
        print(f"      no picture {name}: {error}", flush=True)


def start_test_page():
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            body = TEST_PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            return

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/select.html"


# ---------------------------------------------------------------------------------------------
# --live: a gate that lets the Telisik site and its sources through and nothing else
# ---------------------------------------------------------------------------------------------

SEARCH_ENGINES = ("google.", "bing.", "duckduckgo.", "yahoo.")
RESULTS_JS = "document.querySelectorAll('#results .result').length"
LIVE_RESULT_QUERIES = (ADDRESS_BAR_QUERY, SELECTED_TEXT)  # the other test queries are not real questions


def site_hosts():
    """Hosts the Telisik page may talk to: its own, plus the connect-src list of index.html."""
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    policy = re.search(r"connect-src([^;\"]*)", page)
    hosts = [urlparse(HOME).hostname]
    for entry in policy.group(1).split() if policy else []:
        if entry.startswith("https://"):
            hosts.append(entry[len("https://"):].strip("/"))
    return hosts


def host_is_listed(host, listed):
    host = (host or "").lower()
    for entry in listed:
        if entry.startswith("*."):
            if host.endswith(entry[1:]):
                return True
        elif host == entry:
            return True
    return False


class Gate:
    """A proxy on this computer. It passes HTTPS to the listed hosts and answers 403 to everything else."""

    def __init__(self, upstream=None):
        self.listed = site_hosts()
        self.upstream = None
        if upstream:
            parsed = urlparse(upstream if "//" in upstream else "http://" + upstream)
            self.upstream = (parsed.hostname, parsed.port or 80)
        self.passed = {}
        self.refused = {}
        self.failed = {}
        self.lock = threading.Lock()
        gate = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                gate.serve(self)

        class Server(socketserver.ThreadingTCPServer):
            daemon_threads = True
            allow_reuse_address = False

        self.server = Server(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def count(self, table, host):
        with self.lock:
            table[host] = table.get(host, 0) + 1

    def reach(self, host, port):
        """A connection to host:port, through the upstream proxy when there is one."""
        if not self.upstream:
            return socket.create_connection((host, port), timeout=20)
        outward = socket.create_connection(self.upstream, timeout=20)
        outward.sendall(f"CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n".encode("ascii"))
        answer = b""
        while b"\r\n\r\n" not in answer and len(answer) < 16384:
            piece = outward.recv(4096)
            if not piece:
                break
            answer += piece
        status = answer.split(b"\r\n", 1)[0].split(b" ")
        if len(status) < 2 or status[1] != b"200":
            outward.close()
            raise OSError("the upstream proxy answered " + answer.split(b"\r\n", 1)[0].decode("latin-1", "replace")[:80])
        return outward

    def serve(self, handler):
        try:
            first = handler.rfile.readline(8192).decode("latin-1").strip()
            while handler.rfile.readline(8192) not in (b"\r\n", b"\n", b""):
                pass
            parts = first.split(" ")
            if len(parts) < 2:
                return
            method, target = parts[0].upper(), parts[1]
            if method == "CONNECT":
                host, _, port = target.rpartition(":")
                port = int(port or 443)
            else:
                parsed = urlparse(target)
                host, port = parsed.hostname or "", parsed.port or 80
            host = host.strip("[]").lower()
            if method != "CONNECT" or port != 443 or not host_is_listed(host, self.listed):
                self.count(self.refused, host)
                handler.wfile.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                return
            try:
                outward = self.reach(host, port)
            except OSError as error:
                self.count(self.failed, f"{host}: {str(error)[:80]}")
                handler.wfile.write(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                return
            self.count(self.passed, host)
            handler.wfile.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
            handler.wfile.flush()
            inward = handler.connection
            outward.settimeout(None)
            try:
                while True:
                    ready, _, _ = select.select([inward, outward], [], [], 120)
                    if not ready:
                        break
                    for side in ready:
                        data = side.recv(65536)
                        if not data:
                            return
                        (outward if side is inward else inward).sendall(data)
            finally:
                outward.close()
        except (OSError, ValueError):
            return

    def report(self, checks):
        """Put what passed and what was refused into the printed facts."""
        with self.lock:
            passed, refused, failed = dict(self.passed), dict(self.refused), dict(self.failed)
        RESULT["live"] = True
        RESULT["gate_let_through"] = sorted(passed)
        RESULT["gate_refused"] = sorted(refused)
        RESULT["gate_could_not_reach"] = sorted(failed)
        checks.note(f"the gate let through: {sorted(passed)}")
        if refused:
            checks.note(f"the gate refused what the browser itself asked for: {sorted(refused)}")
        if failed:
            checks.note(f"the gate could not reach: {sorted(failed)}")
        engines = [host for host in passed if any(name in host for name in SEARCH_ENGINES)]
        checks.check("nothing got through the gate to Google, Bing, DuckDuckGo or Yahoo", not engines, engines)

    def close(self):
        self.server.shutdown()
        self.server.server_close()


# ---------------------------------------------------------------------------------------------
# Chrome, Edge and Chromium
# ---------------------------------------------------------------------------------------------

CHANNELS = {"chrome": ("chrome", "Chrome"), "edge": ("msedge", "Edge"), "chromium": ("chromium", "Chromium")}
RECT_JS = """
() => {
  const box = document.querySelector('#target').getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}
"""
BOX_VALUE_JS = "document.querySelector('#q') ? document.querySelector('#q').value : 'no #q'"
BUBBLE_HAS_KEYBOARD_JS = "document.hasFocus() && !!document.activeElement && document.activeElement.id === 'q'"


def run_chromium_family(args, checks, desk):
    from playwright.sync_api import sync_playwright

    channel, label = CHANNELS[args.browser]
    profile = tempfile.mkdtemp(prefix="telisik-ext-")
    marker = Path(profile).name
    server, test_page_url = start_test_page()
    automation = Automation()
    refused_urls = []
    asked_urls = []
    gate = Gate(args.proxy) if args.live else None
    patience = 2.5 if args.live else 1.0

    def answer(route):
        url = route.request.url
        if url.startswith(test_page_url.rsplit("/", 1)[0]):
            route.continue_()
            return
        if not url.startswith(HOME):
            refused_urls.append(url)
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
            switches = [
                f"--proxy-server=http://127.0.0.1:{gate.port if gate else shared.DEAD_PROXY_PORT}",
                "--window-position=60,40",
                "--window-size=1180,820",
                "--lang=en-US",
            ]
            if args.browser == "chromium":
                context = playwright.chromium.launch_persistent_context(
                    profile,
                    channel=channel,
                    headless=False,
                    no_viewport=True,
                    args=switches + [f"--disable-extensions-except={EXTENSION}", f"--load-extension={EXTENSION}"],
                )
            else:
                context = playwright.chromium.launch_persistent_context(
                    profile,
                    channel=channel,
                    headless=False,
                    no_viewport=True,
                    args=switches + ["--enable-unsafe-extension-debugging"],
                    ignore_default_args=["--disable-extensions"],
                )
            context.set_default_timeout(8000)
            print(f"browser: {label} {context.browser.version}", flush=True)
            if gate:
                # Live: nothing is answered from the folder. The pages' requests are only written down.
                context.on("request", lambda request: asked_urls.append(request.url))
            else:
                context.route(lambda url: url.startswith("http"), answer)
            session = context.browser.new_browser_cdp_session()
            first = context.pages[0] if context.pages else context.new_page()

            def wait_for(probe, seconds=8.0):
                """Like wait_until, but Playwright keeps reading the browser's messages while it waits."""
                deadline = time.time() + seconds
                result = probe()
                while not result and time.time() < deadline:
                    first.wait_for_timeout(150)
                    result = probe()
                return result

            def targets():
                return session.send("Target.getTargets")["targetInfos"]

            def tabs():
                return {target["targetId"]: target["url"] for target in targets() if target["type"] == "page"}

            def opened_since(before, address):
                return [key for key, url in tabs().items() if key not in before and url == address]

            def new_addresses(before):
                return sorted(url for key, url in tabs().items() if key not in before)

            def popup_open():
                return [target for target in targets() if target["url"].endswith("/popup.html")]

            def site_page(address):
                for page in context.pages:
                    if page.url == address:
                        return page
                return None

            def site_shows(address, query):
                """What the Telisik page behind that address has in its own search box."""
                page = wait_for(lambda: site_page(address), 5)
                if not page:
                    return "no page with that address"
                try:
                    started = time.time()
                    wait_for(lambda: page.evaluate(BOX_VALUE_JS) == query, 20 * patience)
                    took = time.time() - started
                    if took > 4:
                        checks.note(f"that page needed {took:.0f} s in this test before its box showed the query")
                    return page.evaluate(BOX_VALUE_JS)
                except Exception as error:
                    return f"{type(error).__name__}: {str(error)[:120]}"

            def live_results(address, query):
                """Live only: the real page behind that address lists results from the real sources."""
                if not gate or query not in LIVE_RESULT_QUERIES:
                    return
                page = site_page(address)
                count, started = 0, time.time()
                try:
                    if page:
                        wait_for(lambda: page.evaluate(RESULTS_JS) >= 1, 40)
                        count = page.evaluate(RESULTS_JS)
                except Exception as error:
                    checks.note(f"reading the live page failed: {type(error).__name__}: {str(error)[:120]}")
                RESULT.setdefault("live_results", {})[query] = {"results": count, "seconds": round(time.time() - started, 1)}
                checks.check(f"the live Telisik page lists results for \u201c{query}\u201d", count >= 1, f"{count} results")

            def settle_tab(address, query):
                """Let the Telisik tab that just opened finish loading, so its loading cannot disturb the next step."""
                page = wait_for(lambda: site_page(address), 5)
                if not page:
                    return
                try:
                    page.wait_for_load_state("load", timeout=20000)
                    wait_for(lambda: page.evaluate(BOX_VALUE_JS) == query, 20)
                except Exception as error:
                    checks.note(f"waiting for the tab of \u201c{query}\u201d: {type(error).__name__}: {str(error)[:120]}")

            def bubble_page():
                for page in context.pages:
                    if page.url.endswith("/popup.html"):
                        return page
                return None

            def bubble_reads(script):
                """Ask the bubble's own page something. None when the browser does not let the test see the bubble."""
                page = bubble_page()
                if not page:
                    return None
                try:
                    return page.evaluate(script)
                except Exception:
                    return None

            def search_in_bubble(query, before):
                """Real typing and Enter in the open bubble. Waits for the bubble's box to hold the keyboard first."""
                has_keyboard = wait_for(lambda: bubble_reads(BUBBLE_HAS_KEYBOARD_JS), 5)
                if has_keyboard is None:
                    first.wait_for_timeout(1000)
                elif not has_keyboard:
                    checks.note(f"the bubble's box did not hold the keyboard within 5 s, before typing \u201c{query}\u201d")
                desk.type_text(query)
                typed = bubble_reads(BOX_VALUE_JS)
                if typed is not None and typed != query:
                    checks.note(f"after the first typing the bubble's box held {typed!r}, not {query!r}; typed once more")
                    RESULT.setdefault("bubble_typed_twice", []).append(query)
                    wait_for(lambda: bubble_reads(BUBBLE_HAS_KEYBOARD_JS), 5)
                    desk.chord("ctrl", "a")
                    desk.type_text(query)
                desk.chord("enter")
                return wait_for(lambda: opened_since(before, search_url(query)), 8 * patience)

            extension_id = ""
            if args.browser != "chromium":
                settings = context.new_page()
                settings.goto("chrome://extensions/")
                settings.evaluate(shared.DEVELOPER_MODE_JS)
                extension_id = session.send("Extensions.loadUnpacked", {"path": str(EXTENSION)})["id"]
                settings.close()

            def worker():
                for candidate in context.service_workers:
                    if candidate.url.startswith("chrome-extension://") and candidate.url.endswith("/background.js"):
                        return candidate
                return None

            background = wait_for(worker, 10)
            if not checks.check("the extension is loaded and its background worker runs", background is not None, "no service worker"):
                return
            extension_id = extension_id or background.url.split("/")[2]
            origin = f"chrome-extension://{extension_id}"

            # A fresh Edge profile is busy for a while when the network answers; the page itself is local.
            first.goto(test_page_url, wait_until="domcontentloaded", timeout=int(8000 * patience * 2))
            processes = session.send("SystemInfo.getProcessInfo")["processInfo"]
            desk.pid = next(process["id"] for process in processes if process["type"] == "browser")
            mains = [handle for handle in top_windows(desk.pid) if window_class(handle).startswith("Chrome_WidgetWin") and window_title(handle)]
            if not checks.check("the test browser has a window on the screen", bool(mains), "no visible window"):
                return
            desk.main_window = mains[0]

            def page_point(x, y):
                """Screen position, in real pixels, of a point given in CSS pixels of the visible page."""
                ratio = first.evaluate("window.devicePixelRatio")
                areas = child_windows(desk.main_window, "Chrome_RenderWidgetHostHWND")
                shown = [handle for handle in areas if user32.IsWindowVisible(handle)] or areas
                corner = window_rect(shown[0])[:2] if shown else window_rect(desk.main_window)[:2]
                return corner[0] + x * ratio, corner[1] + y * ratio

            def aim(x, y):
                """Screen point for a CSS point of the test page, corrected by where the page saw the pointer."""
                ratio = first.evaluate("window.devicePixelRatio")
                point = page_point(x, y)
                for _ in range(3):
                    first.evaluate("window.pointerSeen = null")
                    if not desk.move(point, "the test page"):
                        break
                    seen = wait_for(lambda: first.evaluate("window.pointerSeen"), 1.5)
                    if not seen:
                        checks.note("the test page did not see the pointer; the first guess is used")
                        break
                    off = (x - seen["x"], y - seen["y"])
                    if abs(off[0]) <= 2 and abs(off[1]) <= 2:
                        break
                    checks.note(f"the first guess was off by {off[0]:.0f},{off[1]:.0f} page pixels; corrected")
                    point = (point[0] + off[0] * ratio, point[1] + off[1] * ratio)
                return point

            def browser_windows():
                return top_windows(desk.pid)

            if not wait_for_idle(args.idle, args.idle_wait):
                checks.check("the computer is idle enough to borrow the keyboard", False, "it stayed in use; nothing was sent")
                return
            in_front = desk.bring_to_front() or desk.click_to_front(page_point(*BLANK_SPOT))
            if not checks.check("the test window is in front and gets the keyboard", in_front, "Windows did not give it the keyboard"):
                return
            grab_window(args.shots, f"{args.browser}-real-start.png", desk.main_window)

            # --- Ctrl+T -----------------------------------------------------------------------
            new_tab_address = f"{origin}/newtab.html"

            def buttons_with(word):
                return [item for item in automation.find(browser_windows(), Automation.BUTTON) if word in item["name"]]

            def press_ctrl_t():
                """Real Ctrl+T; returns the page that opened if it is the extension's new tab page."""
                known = list(context.pages)
                before = dict(tabs())
                desk.chord("ctrl", "t")
                wait_for(lambda: len(tabs()) > len(before), 8)
                fresh = wait_for(lambda: [page for page in context.pages if page not in known and page.url == new_tab_address], 6)
                if fresh:
                    return fresh[0], new_addresses(before)
                # The browser can go on naming the tab by its own new-tab address although the extension's page
                # is the one on the screen (seen once with Chrome 157 on the live site). The keys are not pressed
                # again; the page that opened is asked for its own address instead, and the detour is written down.
                reported = []
                for page in [page for page in context.pages if page not in known]:
                    try:
                        own_address = page.evaluate("location.href")
                    except Exception as error:
                        own_address = f"{type(error).__name__}: {str(error)[:80]}"
                    reported.append({"the browser names it": page.url, "the page says": own_address})
                    if own_address == new_tab_address:
                        checks.note(
                            f"the browser named the new tab {page.url!r}; the page in it, asked directly, "
                            f"is the extension's new tab page ({own_address})"
                        )
                        RESULT.setdefault("new_tab_named_differently", []).append(page.url)
                        return page, new_addresses(before)
                return None, {"tabs": new_addresses(before), "pages": reported}

            new_page, seen = press_ctrl_t()
            checks.check("real Ctrl+T opens the extension's new tab page", new_page is not None, seen)
            time.sleep(0.8)
            keep = [item for item in buttons_with("Keep") if item["name"] in ("Keep it", "Keep changes")]
            grab_window(args.shots, f"{args.browser}-real-newtab-first.png", desk.main_window)
            RESULT["browser_asks_to_keep_new_tab"] = bool(keep)
            if keep:
                checks.note(f"{label} asks whether to change the new tab page back; a new user has to choose {keep[0]['name']!r} once")
                desk.click(centre(keep[0]["rect"]), f"the {keep[0]['name']} button")
                gone = wait_for(lambda: not [item for item in buttons_with("Keep") if item["name"] == keep[0]["name"]], 4)
                checks.check(f"a real click on {keep[0]['name']} closes the browser's question", gone, "the question is still open")
                new_page, seen = press_ctrl_t()
                checks.check("after that, real Ctrl+T still opens the extension's new tab page", new_page is not None, seen)
                time.sleep(0.6)
            # Edge warns about every extension that is loaded from a folder; that bubble takes the keyboard.
            later = [item for item in buttons_with("Not now") if item["name"] == "Not now"]
            RESULT["browser_warns_about_developer_mode"] = bool(later)
            if later:
                checks.note(
                    f"{label} shows 'Turn off extensions in developer mode' because the extension is loaded from a folder; "
                    "its first button would switch Telisik off, so a user has to choose 'Not now'"
                )
                desk.click(centre(later[0]["rect"]), "the Not now button")
                gone = wait_for(lambda: not [item for item in buttons_with("Not now") if item["name"] == "Not now"], 4)
                checks.check("a real click on Not now closes the developer-mode warning", gone, "the warning is still open")
                new_page, seen = press_ctrl_t()
                checks.check("after that warning, real Ctrl+T still opens the extension's new tab page", new_page is not None, seen)
                time.sleep(0.6)
            focus = automation.focused()
            desk.type_text(STRAY_TEXT)
            time.sleep(0.4)
            after = automation.focused()
            in_box = new_page.evaluate(BOX_VALUE_JS) if new_page else ""
            bars = [item for item in automation.find(browser_windows(), Automation.EDIT) if STRAY_TEXT in item["value"]]
            if in_box == STRAY_TEXT:
                landed = "the Telisik search box"
            elif after["type"] == Automation.EDIT and STRAY_TEXT in after["value"]:
                landed = f"the browser's own address bar ({after['name']})"
            elif bars:
                landed = f"the browser's own address bar ({bars[0]['name']})"
            else:
                landed = f"somewhere else (focused: {after['name']!r}, value {after['value']!r})"
            checks.note(f"after Ctrl+T the keyboard is in {focus['name']!r}; typing right away lands in {landed}")
            RESULT["after_new_tab_typing_lands_in"] = landed
            grab_window(args.shots, f"{args.browser}-real-newtab.png", desk.main_window)
            desk.chord("ctrl", "a")
            desk.chord("delete")
            if new_page:
                box = new_page.evaluate("(() => { const b = document.querySelector('#q').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()")
                desk.click(page_point(box[0], box[1]), "the Telisik search box")
                desk.type_text(NEW_TAB_QUERY)
                typed = wait_for(lambda: new_page.evaluate(BOX_VALUE_JS) == NEW_TAB_QUERY, 3)
                checks.check("a real click in the Telisik box, then typing, puts the text in that box", typed, new_page.evaluate(BOX_VALUE_JS))
                if typed:
                    desk.chord("enter")
                    arrived = wait_for(lambda: search_url(NEW_TAB_QUERY) in tabs().values(), 8 * patience)
                    checks.check("real Enter in that box opens Telisik with the query", arrived, sorted(tabs().values()))
                    shown = site_shows(search_url(NEW_TAB_QUERY), NEW_TAB_QUERY)
                    checks.check("the Telisik page behind it shows that query in its search box", shown == NEW_TAB_QUERY, shown)

            # --- "tk" in the address bar --------------------------------------------------------
            def keyword_attempt(separator):
                desk.chord("ctrl", "l")
                desk.type_text("tk")
                if separator == "space":
                    desk.type_text(" ")
                else:
                    desk.chord("tab")
                time.sleep(0.4)
                desk.type_text(ADDRESS_BAR_QUERY)
                time.sleep(0.6)
                return automation.focused()

            def goes_to_telisik(bar):
                return bar["pid"] == desk.pid and bar["type"] == Automation.EDIT and bar["value"] == ADDRESS_BAR_QUERY

            separator = "space"
            bar = keyword_attempt(separator)
            if not goes_to_telisik(bar) and not desk.lost:
                checks.note(f"tk + space did not switch the address bar to Telisik (it shows {bar['value']!r}); trying tk + Tab")
                desk.chord("escape")
                desk.chord("escape")
                separator = "Tab"
                bar = keyword_attempt(separator)
            in_keyword_mode = goes_to_telisik(bar)
            RESULT["keyword_separator"] = separator if in_keyword_mode else "none"
            grab_window(args.shots, f"{args.browser}-real-address-bar.png", desk.main_window)
            checks.check(
                f"real typing of tk, {separator} and the query puts the address bar in Telisik mode",
                in_keyword_mode,
                f"address bar {bar['name']!r} shows {bar['value']!r}",
            )
            if in_keyword_mode:
                desk.chord("enter")
                arrived = wait_for(lambda: search_url(ADDRESS_BAR_QUERY) in tabs().values(), 8 * patience)
                checks.check("real Enter in the address bar opens Telisik with the query", arrived, sorted(tabs().values()))
                shown = site_shows(search_url(ADDRESS_BAR_QUERY), ADDRESS_BAR_QUERY)
                checks.check("the Telisik page behind it shows that query in its search box", shown == ADDRESS_BAR_QUERY, shown)
                live_results(search_url(ADDRESS_BAR_QUERY), ADDRESS_BAR_QUERY)
                grab_window(args.shots, f"{args.browser}-real-address-bar-result.png", desk.main_window)
            else:
                desk.chord("escape")
                desk.chord("escape")
                checks.note("Enter was not pressed, so nothing was sent to a search engine")

            # --- select text, right-click, pick the Telisik entry ---------------------------------
            desk.chord("ctrl", "1")
            wait_for(lambda: first.evaluate("document.visibilityState") == "visible", 4)
            box = first.evaluate(RECT_JS)
            spot = aim(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            desk.click(spot, "the test paragraph", times=3)
            selected = wait_for(lambda: first.evaluate("getSelection().toString().trim()") == SELECTED_TEXT, 3)
            checks.check("a real triple-click selects the test sentence", selected, first.evaluate("getSelection().toString()"))
            desk.click(spot, "the selected sentence", button="right")

            def menu_entries():
                return [item for item in automation.find(browser_windows(), Automation.MENU_ITEM) if "Telisik" in item["name"]]

            entries = wait_for(menu_entries, 5) or []
            grab_window(args.shots, f"{args.browser}-real-menu.png", desk.main_window)
            names = [item["name"] for item in entries]
            checks.check(f"the real right-click menu has the entry {MENU_LABEL}", MENU_LABEL in names, names or "no entry with Telisik in its name")
            if entries:
                before = dict(tabs())
                entry = next((item for item in entries if item["name"] == MENU_LABEL), entries[0])
                desk.click(centre(entry["rect"]), "the Telisik menu entry")
                opened = wait_for(lambda: opened_since(before, search_url(SELECTED_TEXT)), 8 * patience)
                checks.check("a real click on that entry opens Telisik with the selected text", bool(opened), new_addresses(before))
                shown = site_shows(search_url(SELECTED_TEXT), SELECTED_TEXT)
                checks.check("the Telisik page behind it shows the selected text in its search box", shown == SELECTED_TEXT, shown)
                live_results(search_url(SELECTED_TEXT), SELECTED_TEXT)
                if gate:
                    grab_window(args.shots, f"{args.browser}-real-menu-result.png", desk.main_window)
            else:
                desk.chord("escape")

            # --- Alt+Shift+K ----------------------------------------------------------------------
            desk.chord("alt", "shift", "k")
            bubble = wait_for(popup_open, 6)
            grab_window(args.shots, f"{args.browser}-real-shortcut-popup.png", desk.main_window)
            checks.check("real Alt+Shift+K opens the Telisik bubble", bool(bubble), "no popup.html appeared")
            if bubble:
                before = dict(tabs())
                opened = search_in_bubble(POPUP_QUERY, before)
                checks.check("real typing and Enter in the bubble opens Telisik with the query", bool(opened), new_addresses(before))
                closed = wait_for(lambda: not popup_open(), 4)
                checks.check("the bubble closes after the search", closed, "popup.html is still open")
                settle_tab(search_url(POPUP_QUERY), POPUP_QUERY)
            else:
                desk.chord("escape")

            # --- the toolbar, with the mouse ------------------------------------------------------
            puzzle = [item for item in buttons_with("Extensions") if item["name"] == "Extensions"]
            checks.check("the toolbar has the browser's Extensions button", bool(puzzle), [item["name"] for item in buttons_with("xtension")])
            clicked_entry = False
            if puzzle:
                desk.click(centre(puzzle[0]["rect"]), "the Extensions button")

                def telisik_entries():
                    return [item for item in buttons_with("Telisik") if item["rect"][2] - item["rect"][0] > 60]

                entries = wait_for(telisik_entries, 5) or []
                grab_window(args.shots, f"{args.browser}-real-extensions-menu.png", desk.main_window)
                names = [(item["name"], item["rect"]) for item in buttons_with("Telisik")]
                checks.check("the Extensions menu lists Telisik", bool(entries), names or "no button with Telisik in its name")
                if entries:
                    RESULT["toolbar_entry"] = entries[0]["name"]
                    clicked_entry = desk.click(centre(entries[0]["rect"]), f"the entry {entries[0]['name']!r}")
            if clicked_entry:
                bubble = wait_for(popup_open, 6)
                grab_window(args.shots, f"{args.browser}-real-toolbar-popup.png", desk.main_window)
                checks.check("a real click on Telisik in the toolbar opens the bubble", bool(bubble), "no popup.html appeared")
                if bubble:
                    before = dict(tabs())
                    opened = search_in_bubble(TOOLBAR_QUERY, before)
                    checks.check("typing and Enter in that bubble opens Telisik with the query", bool(opened), new_addresses(before))
            else:
                desk.chord("escape")

            web_urls = [url for url in asked_urls if url.startswith("http") and urlparse(url).hostname != "127.0.0.1"]
            hosts = sorted(set(urlparse(url).hostname or "" for url in (web_urls if gate else refused_urls)))
            RESULT["hosts_the_pages_asked_for"] = hosts
            engines = [host for host in hosts if any(name in host for name in SEARCH_ENGINES)]
            checks.check("no page in the test asked Google, Bing, DuckDuckGo or Yahoo for anything", not engines, engines)
            if gate:
                unlisted = [host for host in hosts if not host_is_listed(host, gate.listed)]
                checks.check(
                    "every host the pages asked for is the Telisik site or on its own list of sources",
                    bool(hosts) and not unlisted,
                    unlisted or "the pages asked for nothing",
                )
                gate.report(checks)
            grab_window(args.shots, f"{args.browser}-real-end.png", desk.main_window)
            context.close()
    finally:
        server.shutdown()
        if gate:
            gate.close()
        shared.stop_marked_processes(marker)
        shared.remove_folder(profile)


# ---------------------------------------------------------------------------------------------
# Firefox
# ---------------------------------------------------------------------------------------------

FIREFOX_SCREEN_JS = """
const win = Services.wm.getMostRecentWindow("navigator:browser");
const doc = win.document;
// Middle of a piece of Firefox's own interface, in real screen pixels.
const middle = (node) => {
  const box = node.getBoundingClientRect();
  const rect = win.windowUtils.toScreenRect(box.x, box.y, box.width, box.height);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
};
"""

FIREFOX_WINDOW_JS = FIREFOX_SCREEN_JS + """
win.moveTo(60, 40);
win.resizeTo(1180, 820);
return { pid: Services.appinfo.processID, title: doc.title };
"""

FIREFOX_PAGE_CORNER_JS = FIREFOX_SCREEN_JS + """
const box = win.gBrowser.selectedBrowser.getBoundingClientRect();
const rect = win.windowUtils.toScreenRect(box.x, box.y, box.width, box.height);
return { x: rect.x, y: rect.y, ratio: win.devicePixelRatio };
"""

FIREFOX_STATE_JS = FIREFOX_SCREEN_JS + """
const active = doc.activeElement;
const note = doc.getElementById("extension-new-tab-notification");
const panel = note ? note.parentNode : null;
let keep = null;
if (note && panel && panel.state === "open" && note.button && !note.button.hidden) {
  keep = { label: note.button.label || note.button.getAttribute("label"), at: middle(note.button) };
}
const views = Array.from(doc.querySelectorAll("browser[webextension-view-type=popup]"));
const shownViews = views.filter((view) => { const holder = view.closest("panel"); return holder && holder.state === "open"; });
const focused = Services.focus.focusedElement;
let keyboardIn = "nothing";
if (focused) {
  if (focused.getAttribute && focused.getAttribute("webextension-view-type") === "popup") {
    keyboardIn = "bubble";
  } else if (focused === win.gBrowser.selectedBrowser) {
    keyboardIn = "page";
  } else {
    keyboardIn = focused.id || focused.localName;
  }
}
return {
  keyboardIn,
  loading: win.gBrowser.selectedBrowser.webProgress.isLoadingDocument,
  bubbleAt: shownViews.length ? middle(shownViews[0]) : null,
  urls: Array.from(win.gBrowser.tabs, (tab) => tab.linkedBrowser.currentURI.spec),
  selected: win.gBrowser.tabContainer.selectedIndex,
  barFocused: win.gURLBar.focused,
  barValue: win.gURLBar.value,
  active: active ? (active.id || active.localName) : "",
  keep,
  bubbles: shownViews.map((view) => (view.currentURI ? view.currentURI.spec : "")),
  openPanels: Array.from(doc.querySelectorAll("panel, menupopup")).filter((item) => item.state === "open").map((item) => item.id),
};
"""

FIREFOX_BAR_JS = """
const win = Services.wm.getMostRecentWindow("navigator:browser");
const bar = win.gURLBar;
let first = null;
try {
  const result = bar.view.getResultAtIndex(0);
  if (result) {
    first = {
      provider: result.providerName,
      heuristic: !!result.heuristic,
      keyword: (result.payload && result.payload.keyword) || "",
      content: (result.payload && result.payload.content) || "",
      engine: (result.payload && result.payload.engine) || "",
    };
  }
} catch (error) {
  first = { provider: "error: " + error, heuristic: false, keyword: "", content: "", engine: "" };
}
return { value: bar.value, focused: bar.focused, open: bar.view.isOpen, first };
"""

FIREFOX_MENU_JS = FIREFOX_SCREEN_JS + """
const menu = doc.getElementById("contentAreaContextMenu");
const shown = Array.from(menu.querySelectorAll("menuitem, menu")).filter((item) => !item.hidden && item.getBoundingClientRect().height > 0);
const outer = menu.state === "open" ? menu.getOuterScreenRect() : null;
return {
  state: menu.state,
  ratio: win.devicePixelRatio,
  outer: outer ? { x: outer.x, y: outer.y, width: outer.width, height: outer.height } : null,
  searching: shown.map((item) => item.label || "").filter((label) => label.startsWith("Search")),
  telisik: shown.filter((item) => (item.label || "").includes("Telisik")).map((item) => ({ label: item.label, at: middle(item) })),
};
"""

FIREFOX_TOOLBAR_JS = FIREFOX_SCREEN_JS + """
const button = doc.getElementById("unified-extensions-button");
const panel = doc.getElementById("unified-extensions-panel");
const item = doc.querySelector("#unified-extensions-panel [data-extensionid='" + arguments[0] + "'] .unified-extensions-item-action-button");
const inBar = doc.querySelector("#nav-bar [data-extensionid='" + arguments[0] + "']");
const seen = (node) => node && !node.hidden && node.getBoundingClientRect().width > 0;
return {
  button: seen(button) ? { label: button.getAttribute("label") || button.getAttribute("tooltiptext") || "", at: middle(button) } : null,
  panel: panel ? panel.state : "none",
  entry: seen(item) && panel && panel.state === "open" ? { label: item.getAttribute("label") || "", text: item.textContent.trim().slice(0, 120), at: middle(item) } : null,
  pinned: seen(inBar),
};
"""

FIREFOX_SITE_JS = """
const box = document.querySelector('#q');
return { href: location.href, value: box ? box.value : null, results: document.querySelectorAll('#results .result').length };
"""

FIREFOX_BOX_JS = """
const box = document.querySelector('#q');
if (!box) {
  return null;
}
const rect = box.getBoundingClientRect();
return { value: box.value, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, focused: document.activeElement === box };
"""

def run_firefox(args, checks, desk):
    import pack_extension

    binary = shared.find_firefox(args.firefox_binary)
    if not binary:
        checks.check("Firefox is on this computer", False, "not found; pass --firefox-binary PATH")
        return
    profile = tempfile.mkdtemp(prefix="telisik-fx-")
    marker = Path(profile).name
    build = tempfile.mkdtemp(prefix="telisik-fx-build-")
    folder = pack_extension.build(build)
    server, test_page_url = start_test_page()
    gate = Gate(args.proxy) if args.live else None
    patience = 2.5 if args.live else 1.0
    proxy_port = gate.port if gate else shared.DEAD_PROXY_PORT
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    preferences = {
        "marionette.port": port,
        "network.proxy.type": 1,
        "network.proxy.http": "127.0.0.1",
        "network.proxy.http_port": proxy_port,
        "network.proxy.ssl": "127.0.0.1",
        "network.proxy.ssl_port": proxy_port,
        # Only the test page on this computer may be reached; everything else meets the dead proxy
        # (or, with --live, the gate that passes the Telisik site and its sources only).
        "network.proxy.no_proxies_on": "127.0.0.1",
        "browser.shell.checkDefaultBrowser": False,
        "datareporting.policy.dataSubmissionEnabled": False,
        "datareporting.policy.dataSubmissionPolicyBypassNotification": True,
        "app.update.enabled": False,
        "browser.aboutwelcome.enabled": False,
        "browser.startup.homepage_override.mstone": "ignore",
        "browser.startup.homepage": "about:blank",
        "browser.tabs.warnOnClose": False,
        "browser.warnOnQuit": False,
        # Nothing can leave anyway (dead proxy, or the gate); this also keeps the address bar from trying.
        "browser.search.suggest.enabled": False,
        "browser.urlbar.suggest.searches": False,
    }
    Path(profile, "user.js").write_text(
        "\n".join(f"user_pref({json.dumps(name)}, {json.dumps(value)});" for name, value in preferences.items()),
        encoding="utf-8",
    )
    process = subprocess.Popen(
        [binary, "-marionette", "-no-remote", "-remote-allow-system-access", "-profile", profile],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        env=shared.firefox_environment(),
    )
    try:
        client = shared.Marionette(port)
        session = client.send("WebDriver:NewSession", {"capabilities": {"alwaysMatch": {"acceptInsecureCerts": False}}})
        version = session.get("capabilities", {}).get("browserVersion", "?")
        print(f"browser: Firefox {version}", flush=True)
        client.send("WebDriver:SetTimeouts", {"script": 20000, "pageLoad": 15000, "implicit": 0})
        # Remote control switches Firefox's focus handling to a test mode in which it only pretends that
        # its window is in front. Here the window really is in front and the keys are real, so that mode
        # is switched off again; with it on, real keys did not reach a bubble that had just opened.
        RESULT["focus_test_mode_was_on"] = bool(client.browser_script(
            "const was = Services.prefs.getBoolPref('focusmanager.testmode', false);"
            "Services.prefs.setBoolPref('focusmanager.testmode', false);"
            "return was;"
        ))
        installed = client.send("Addon:Install", {"path": str(folder), "temporary": True})
        if not checks.check("Firefox installs the extension and its background script runs", installed == shared.GECKO_ID, installed):
            return
        policy = client.browser_script(shared.FIREFOX_POLICY_JS, [shared.GECKO_ID])
        if not checks.check("Firefox lists the extension as active", policy.get("found"), policy):
            return
        origin = f"moz-extension://{policy['host']}"
        new_tab_address = f"{origin}/newtab.html"
        if not gate:
            checks.note(
                "Firefox has no way for this test to answer the Telisik site from the folder, so the tabs show "
                "Firefox's 'proxy refused' page; only the address each tab was sent to is checked here"
            )

        placed = client.browser_script(FIREFOX_WINDOW_JS)
        desk.pid = placed["pid"]
        client.send("WebDriver:Navigate", {"url": test_page_url})
        test_handle = client.send("WebDriver:GetWindowHandle")

        def main_windows():
            return [handle for handle in top_windows(desk.pid) if window_class(handle) == "MozillaWindowClass" and window_title(handle)]

        mains = wait_until(main_windows, 10)
        if not checks.check("the test browser has a window on the screen", bool(mains), "no visible window"):
            return
        desk.main_window = mains[0]

        def state():
            return client.browser_script(FIREFOX_STATE_JS)

        def selected_url():
            now = state()
            return now["urls"][now["selected"]]

        def handles():
            return client.send("WebDriver:GetWindowHandles")

        def test_page(script, arguments=()):
            """Run in the test page (the robot's own tab, wherever it is in the tab strip)."""
            return client.send("WebDriver:ExecuteScript", {"script": script, "args": list(arguments)})

        def other_tab(handle, script, arguments=()):
            """Read a page in another tab without bringing that tab to the front."""
            client.send("WebDriver:SwitchToWindow", {"handle": handle, "focus": False})
            try:
                return client.send("WebDriver:ExecuteScript", {"script": script, "args": list(arguments)})
            except RuntimeError as error:
                return {"error": str(error)[:160]}
            finally:
                client.send("WebDriver:SwitchToWindow", {"handle": test_handle, "focus": False})

        def site_tab(query):
            """Live only: what the Telisik tab that holds this query shows."""
            for handle in handles():
                if handle == test_handle:
                    continue
                seen = other_tab(handle, FIREFOX_SITE_JS)
                if seen and "error" not in seen and str(seen.get("href", "")).startswith(HOME) and seen.get("value") == query:
                    return seen
            return None

        def live_site(query):
            """Live only: the real page behind the address shows the query and, for a real question, results."""
            if not gate:
                return
            started = time.time()
            seen = wait_until(lambda: site_tab(query), 50, 0.5)
            checks.check(
                f"the live Telisik page behind it shows \u201c{query}\u201d in its search box",
                bool(seen),
                "no Telisik tab shows that query",
            )
            if not seen or query not in LIVE_RESULT_QUERIES:
                return
            listed = wait_until(lambda: (site_tab(query) or {}).get("results", 0), 40, 0.5) or 0
            RESULT.setdefault("live_results", {})[query] = {"results": listed, "seconds": round(time.time() - started, 1)}
            checks.check(f"the live Telisik page lists results for \u201c{query}\u201d", listed >= 1, f"{listed} results")

        offset = [0.0, 0.0]

        def page_point(x, y):
            """Screen position, in real pixels, of a point given in CSS pixels of the visible page."""
            corner = client.browser_script(FIREFOX_PAGE_CORNER_JS)
            return corner["x"] + x * corner["ratio"] + offset[0], corner["y"] + y * corner["ratio"] + offset[1]

        def seen_pointer():
            seen = test_page("return document.documentElement.dataset.pointer || '';")
            if not seen:
                return None
            x, y = seen.split(",")
            return {"x": float(x), "y": float(y)}

        def aim(x, y):
            """Screen point for a CSS point of the test page, corrected by where the page saw the pointer."""
            ratio = client.browser_script(FIREFOX_PAGE_CORNER_JS)["ratio"]
            point = page_point(x, y)
            for _ in range(3):
                test_page("delete document.documentElement.dataset.pointer;")
                if not desk.move(point, "the test page"):
                    break
                seen = wait_until(seen_pointer, 1.5, 0.1)
                if not seen:
                    checks.note("the test page did not see the pointer; the first guess is used")
                    break
                off = (x - seen["x"], y - seen["y"])
                if abs(off[0]) <= 2 and abs(off[1]) <= 2:
                    break
                checks.note(f"the first guess was off by {off[0]:.0f},{off[1]:.0f} page pixels; corrected")
                offset[0] += off[0] * ratio
                offset[1] += off[1] * ratio
                point = (point[0] + off[0] * ratio, point[1] + off[1] * ratio)
            return point

        if not wait_for_idle(args.idle, args.idle_wait):
            checks.check("the computer is idle enough to borrow the keyboard", False, "it stayed in use; nothing was sent")
            return
        in_front = desk.bring_to_front() or desk.click_to_front(page_point(*BLANK_SPOT))
        if not checks.check("the test window is in front and gets the keyboard", in_front, "Windows did not give it the keyboard"):
            return
        aim(*BLANK_SPOT)
        grab_window(args.shots, "firefox-real-start.png", desk.main_window)

        # --- Ctrl+T -----------------------------------------------------------------------
        def press_ctrl_t():
            """Real Ctrl+T; says whether the tab that opened in front is the extension's new tab page."""
            known = set(handles())
            before = state()
            desk.chord("ctrl", "t")

            def arrived():
                now = state()
                return len(now["urls"]) == len(before["urls"]) + 1 and now["urls"][now["selected"]] == new_tab_address

            ok = bool(wait_until(arrived, 8))
            fresh = [handle for handle in handles() if handle not in known]
            return ok, (fresh[0] if fresh else None), state()["urls"]

        opened, new_handle, seen = press_ctrl_t()
        checks.check("real Ctrl+T opens the extension's new tab page", opened, seen)
        keep = wait_until(lambda: state()["keep"], 2.5)
        grab_window(args.shots, "firefox-real-newtab-first.png", desk.main_window)
        RESULT["browser_asks_to_keep_new_tab"] = bool(keep)
        if keep:
            checks.note(f"Firefox asks whether to keep the new tab page; a new user has to choose {keep['label']!r} once")
            desk.click((keep["at"]["x"], keep["at"]["y"]), f"the {keep['label']} button")
            gone = wait_until(lambda: not state()["keep"], 4)
            checks.check(f"a real click on {keep['label']} closes the browser's question", gone, state()["openPanels"])
            opened, new_handle, seen = press_ctrl_t()
            checks.check("after that, real Ctrl+T still opens the extension's new tab page", opened, seen)
            time.sleep(0.6)

        def box_of(handle):
            found = other_tab(handle, FIREFOX_BOX_JS) if handle else None
            return found if found and "error" not in found else None

        before_typing = state()
        desk.type_text(STRAY_TEXT)
        time.sleep(0.4)
        after_typing = state()
        box = box_of(new_handle)
        if box and box["value"] == STRAY_TEXT:
            landed = "the Telisik search box"
        elif STRAY_TEXT in after_typing["barValue"]:
            landed = "the browser's own address bar"
        else:
            landed = f"somewhere else (focused: {after_typing['active']!r}, address bar {after_typing['barValue']!r})"
        focus_name = "the address bar" if before_typing["barFocused"] else repr(before_typing["active"])
        checks.note(f"after Ctrl+T the keyboard is in {focus_name}; typing right away lands in {landed}")
        RESULT["after_new_tab_typing_lands_in"] = landed
        grab_window(args.shots, "firefox-real-newtab.png", desk.main_window)
        desk.chord("ctrl", "a")
        desk.chord("delete")
        box = box_of(new_handle)
        if box:
            desk.click(page_point(box["x"], box["y"]), "the Telisik search box")
            desk.type_text(NEW_TAB_QUERY)
            typed = wait_until(lambda: (box_of(new_handle) or {}).get("value") == NEW_TAB_QUERY, 3)
            checks.check("a real click in the Telisik box, then typing, puts the text in that box", typed, box_of(new_handle))
            if typed:
                desk.chord("enter")
                arrived = wait_until(lambda: selected_url() == search_url(NEW_TAB_QUERY), 10 * patience)
                checks.check("real Enter in that box sends the tab to Telisik with the query", arrived, state()["urls"])
                live_site(NEW_TAB_QUERY)
        else:
            checks.check("a real click in the Telisik box, then typing, puts the text in that box", False, "the new tab page has no search box to read")

        # --- "tk" in the address bar, from a fresh new tab -----------------------------------
        opened, new_handle, seen = press_ctrl_t()
        if not opened:
            checks.note(f"Ctrl+T before the address-bar check did not open the new tab page: {seen}")
        desk.chord("ctrl", "l")
        desk.type_text("tk")
        desk.type_text(" ")
        time.sleep(0.3)
        desk.type_text(ADDRESS_BAR_QUERY)

        def bar_goes_to_telisik():
            bar = client.browser_script(FIREFOX_BAR_JS)
            first = bar["first"] or {}
            wanted = f"tk {ADDRESS_BAR_QUERY}"
            ok = bar["focused"] and bar["value"] == wanted and first.get("provider") == "UrlbarProviderOmnibox"
            return bar if ok and first.get("keyword") == "tk" and first.get("content") == wanted else None

        bar = wait_until(bar_goes_to_telisik, 4)
        RESULT["keyword_separator"] = "space" if bar else "none"
        grab_window(args.shots, "firefox-real-address-bar.png", desk.main_window)
        checks.check(
            "real typing of tk, space and the query makes Telisik the first choice of the address bar",
            bool(bar),
            client.browser_script(FIREFOX_BAR_JS),
        )
        if bar:
            desk.chord("enter")
            arrived = wait_until(lambda: selected_url() == search_url(ADDRESS_BAR_QUERY), 10 * patience)
            checks.check("real Enter in the address bar sends the tab to Telisik with the query", arrived, state()["urls"])
            live_site(ADDRESS_BAR_QUERY)
            grab_window(args.shots, "firefox-real-address-bar-result.png", desk.main_window)
        else:
            desk.chord("escape")
            desk.chord("escape")
            checks.note("Enter was not pressed, so nothing was sent to a search engine")

        # --- select text, right-click, pick the Telisik entry ---------------------------------
        desk.chord("ctrl", "1")
        wait_until(lambda: test_page("return document.visibilityState;") == "visible", 4)
        rect = test_page(
            "const box = document.querySelector('#target').getBoundingClientRect();"
            "return { x: box.left, y: box.top, width: box.width, height: box.height };"
        )
        spot = aim(rect["x"] + rect["width"] / 2, rect["y"] + rect["height"] / 2)
        desk.click(spot, "the test paragraph", times=3)
        selected = wait_until(lambda: test_page("return getSelection().toString().trim();") == SELECTED_TEXT, 3)
        checks.check("a real triple-click selects the test sentence", selected, test_page("return getSelection().toString();"))
        desk.click(spot, "the selected sentence", button="right")

        def menu_with_telisik():
            menu = client.browser_script(FIREFOX_MENU_JS)
            return menu if menu["state"] == "open" and menu["telisik"] else None

        menu = wait_until(menu_with_telisik, 5) or client.browser_script(FIREFOX_MENU_JS)
        grab_window(args.shots, "firefox-real-menu.png", desk.main_window)
        labels = [item["label"] for item in menu["telisik"]]
        checks.check(f"the real right-click menu has the entry {MENU_LABEL}", MENU_LABEL in labels, labels or f"menu is {menu['state']}, no entry with Telisik in its name")
        others = [label for label in menu["searching"] if "Telisik" not in label]
        if others:
            checks.note(f"Firefox's own menu also offers: {others}")
        RESULT["other_search_entries_in_menu"] = others
        entry = next((item for item in menu["telisik"] if item["label"] == MENU_LABEL), None)
        if entry and menu["outer"]:
            outer, ratio, at = menu["outer"], menu["ratio"], entry["at"]
            inside = any(
                outer["x"] * scale - 4 <= at["x"] <= (outer["x"] + outer["width"]) * scale + 4
                and outer["y"] * scale - 4 <= at["y"] <= (outer["y"] + outer["height"]) * scale + 4
                for scale in (1, ratio)
            )
            if not inside:
                checks.note(f"the entry's position {at} is not inside the menu {outer}; not clicked")
                entry = None
        if entry:
            before = state()
            desk.click((entry["at"]["x"], entry["at"]["y"]), "the Telisik menu entry")
            arrived = wait_until(lambda: search_url(SELECTED_TEXT) in state()["urls"], 10 * patience)
            now = state()
            checks.check(
                "a real click on that entry opens Telisik with the selected text in a new tab",
                bool(arrived) and len(now["urls"]) == len(before["urls"]) + 1,
                now["urls"],
            )
            live_site(SELECTED_TEXT)
            if gate:
                grab_window(args.shots, "firefox-real-menu-result.png", desk.main_window)
        else:
            desk.chord("escape")

        # --- Alt+Shift+K ----------------------------------------------------------------------
        def bubble_open():
            return [url for url in state()["bubbles"] if url.endswith("/popup.html")]

        def settle():
            """Wait until the tab in front has stopped loading; a page that arrives late can take the keyboard."""
            wait_until(lambda: not state()["loading"], 8)
            time.sleep(0.6)

        def close_bubble():
            if bubble_open():
                desk.chord("escape")
                wait_until(lambda: not bubble_open(), 3)

        def search_in_bubble(query, picture):
            """Type in the open bubble and press Enter. Says whether Telisik opened and where the keyboard was."""
            wait_until(lambda: state()["keyboardIn"] == "bubble", 3)
            keyboard_in = state()["keyboardIn"]
            desk.type_text(query)
            grab_window(args.shots, picture, desk.main_window)
            desk.chord("enter")
            arrived = bool(wait_until(lambda: search_url(query) in state()["urls"], 10 * patience))
            after_click = False
            if not arrived and bubble_open():
                # Second way, only to learn what a person would have to do: click in the box, then type.
                spot = state()["bubbleAt"]
                if spot and desk.click((spot["x"], spot["y"]), "the search box of the bubble"):
                    desk.chord("ctrl", "a")
                    desk.type_text(query)
                    desk.chord("enter")
                    after_click = bool(wait_until(lambda: search_url(query) in state()["urls"], 10 * patience))
            return arrived, keyboard_in, after_click

        settle()
        desk.chord("alt", "shift", "k")
        bubble = wait_until(bubble_open, 6)
        grab_window(args.shots, "firefox-real-shortcut-popup.png", desk.main_window)
        checks.check("real Alt+Shift+K opens the Telisik bubble", bool(bubble), state()["openPanels"])
        if bubble:
            arrived, keyboard_in, after_click = search_in_bubble(POPUP_QUERY, "firefox-real-shortcut-typed.png")
            RESULT["keyboard_after_shortcut"] = keyboard_in
            checks.check(
                "real typing and Enter in the bubble, without a click, opens Telisik with the query",
                arrived,
                f"the keyboard was in: {keyboard_in}; after a click in the box it worked: {after_click}; tabs: {state()['urls']}",
            )
            checks.check(
                "at the latest after one real click in the box, typing and Enter opens Telisik (shortcut bubble)",
                arrived or after_click,
                f"without a click: {arrived}; after a click: {after_click}",
            )
            closed = wait_until(lambda: not bubble_open(), 4)
            checks.check("the bubble closes after the search", closed, state()["openPanels"])
        close_bubble()

        # --- the toolbar, with the mouse ------------------------------------------------------
        def toolbar():
            return client.browser_script(FIREFOX_TOOLBAR_JS, [shared.GECKO_ID])

        bar_now = toolbar()
        checks.check("the toolbar has the browser's Extensions button", bool(bar_now["button"]), bar_now)
        RESULT["pinned_to_toolbar"] = bool(bar_now["pinned"])
        clicked_entry = False
        if bar_now["button"]:
            settle()
            desk.click((bar_now["button"]["at"]["x"], bar_now["button"]["at"]["y"]), "the Extensions button")
            listed = wait_until(lambda: toolbar()["entry"], 5)
            grab_window(args.shots, "firefox-real-extensions-menu.png", desk.main_window)
            checks.check("the Extensions menu lists Telisik", bool(listed), toolbar())
            if listed:
                RESULT["toolbar_entry"] = listed["label"] or listed["text"]
                clicked_entry = desk.click((listed["at"]["x"], listed["at"]["y"]), f"the entry {RESULT['toolbar_entry']!r}")
        if clicked_entry:
            bubble = wait_until(bubble_open, 6)
            grab_window(args.shots, "firefox-real-toolbar-popup.png", desk.main_window)
            checks.check("a real click on Telisik in the toolbar opens the bubble", bool(bubble), state()["openPanels"])
            if bubble:
                arrived, keyboard_in, after_click = search_in_bubble(TOOLBAR_QUERY, "firefox-real-toolbar-typed.png")
                RESULT["keyboard_after_toolbar_click"] = keyboard_in
                checks.check(
                    "typing and Enter in that bubble, without a further click, opens Telisik with the query",
                    arrived,
                    f"the keyboard was in: {keyboard_in}; after a click in the box it worked: {after_click}; tabs: {state()['urls']}",
                )
                checks.check(
                    "at the latest after one real click in the box, typing and Enter opens Telisik (toolbar bubble)",
                    arrived or after_click,
                    f"without a click: {arrived}; after a click: {after_click}",
                )
            close_bubble()
        else:
            desk.chord("escape")

        final = state()
        hosts = sorted(set(urlparse(url).hostname or "" for url in final["urls"]))
        RESULT["hosts_the_tabs_were_sent_to"] = hosts
        engines = [host for host in hosts if any(name in host for name in SEARCH_ENGINES)]
        checks.check("no tab in the test was sent to Google, Bing, DuckDuckGo or Yahoo", not engines, final["urls"])
        if gate:
            gate.report(checks)
        policy = client.browser_script(shared.FIREFOX_POLICY_JS, [shared.GECKO_ID])
        checks.check("after all of that Firefox still reports no warning and no error", policy.get("found") and not policy["warnings"] and not policy["errors"], policy)
        grab_window(args.shots, "firefox-real-end.png", desk.main_window)
    finally:
        server.shutdown()
        if gate:
            gate.close()
        for pid in {process.pid, desk.pid}:
            if pid:
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, timeout=40)
        shared.stop_marked_processes(marker)
        shared.remove_folder(profile)
        shared.remove_folder(build)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--browser", choices=["chrome", "edge", "chromium", "firefox"], default="chrome")
    parser.add_argument("--firefox-binary", default=None)
    parser.add_argument("--shots", default=None)
    parser.add_argument("--idle", type=float, default=6.0, help="start only after this many seconds without keyboard or mouse")
    parser.add_argument("--idle-wait", type=float, default=600.0, help="how long to wait for that quiet moment")
    parser.add_argument("--seconds", type=int, default=110, help="give up this long after the quiet moment")
    parser.add_argument("--live", action="store_true", help="let the real Telisik site and its real sources answer (through a gate that refuses every other host)")
    parser.add_argument("--proxy", default=None, help="with --live: the proxy this network needs, for example http://proxy:80")
    args = parser.parse_args()
    if args.proxy and not args.live:
        parser.error("--proxy only has a meaning together with --live")
    if args.live and args.seconds == 110:
        args.seconds = 240  # the real sources need time to answer
    if os.name != "nt":
        print("This check presses real keys through the Windows API; it runs on Windows only.")
        sys.exit(2)
    try:
        user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        pass
    checks = shared.Checks()
    if args.live:
        print("mode: live. The real site and its sources answer; a gate on this computer refuses every other host.", flush=True)
    if not user32.GetForegroundWindow():
        print("FAIL  no window is in front: the screen is locked or there is no desktop. Nothing was sent.")
        sys.exit(1)
    print(f"waiting for {args.idle:.0f} s without keyboard or mouse (at most {args.idle_wait:.0f} s)", flush=True)
    if not wait_for_idle(args.idle, args.idle_wait):
        print("the computer stayed in use; no browser was started and nothing was sent", flush=True)
        sys.exit(4)
    desk = Desk(checks)

    def give_up():
        print(f"FAIL  the run did not finish within {args.seconds} s", flush=True)
        for prefix in ("telisik-ext-", "telisik-fx-"):
            for folder in Path(tempfile.gettempdir()).glob(prefix + "*"):
                if folder.stat().st_mtime >= started:
                    shared.stop_marked_processes(folder.name)
                    shared.remove_folder(folder)
        desk.give_back()
        os._exit(3)

    started = time.time() - 1
    watchdog = threading.Timer(args.seconds + args.idle_wait, give_up)
    watchdog.daemon = True
    watchdog.start()
    try:
        if args.browser == "firefox":
            run_firefox(args, checks, desk)
        else:
            run_chromium_family(args, checks, desk)
    except Exception as error:
        checks.check("the run reached its end", False, f"{type(error).__name__}: {str(error)[:600]}")
    watchdog.cancel()
    given_back = desk.give_back()
    checks.check("no key press and no click was held back by the focus guard", not desk.refused, desk.refused[:6])
    checks.note(f"real keys and mouse were used for {desk.seconds_of_input():.0f} s")
    checks.note(f"pointer back where it was: {given_back['pointer']}; the earlier window is in front again: {given_back['window']}")
    RESULT["seconds_of_input"] = round(desk.seconds_of_input(), 1)
    RESULT["given_back"] = given_back
    print("facts: " + json.dumps(RESULT, ensure_ascii=False), flush=True)
    print(f"{checks.passed}/{checks.total} checks passed", flush=True)
    sys.stdout.flush()
    os._exit(0 if checks.passed == checks.total and checks.total > 0 else 1)


if __name__ == "__main__":
    main()
