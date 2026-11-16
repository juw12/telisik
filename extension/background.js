// Address-bar keyword and right-click search. Makes no network request of its own: it only opens tabs.

import { searchUrl } from "./url.js";

const api = globalThis.browser ?? globalThis.chrome;
const MENU_ID = "telisik-search-selection";

function openFromAddressBar(text, disposition) {
  const url = searchUrl(text);
  if (disposition === "newForegroundTab") {
    return api.tabs.create({ url });
  }
  if (disposition === "newBackgroundTab") {
    return api.tabs.create({ url, active: false });
  }
  return api.tabs.update({ url });
}

function openFromMenu(info, tab) {
  if (info.menuItemId !== MENU_ID) {
    return undefined;
  }
  const target = { url: searchUrl(info.selectionText) };
  if (tab && Number.isInteger(tab.index)) {
    target.index = tab.index + 1;
  }
  return api.tabs.create(target);
}

function addMenu() {
  api.contextMenus.removeAll(() => {
    api.contextMenus.create({
      id: MENU_ID,
      title: "Search Telisik for \u201c%s\u201d",
      contexts: ["selection"],
    });
  });
}

// Listeners are added on every start of the worker; the menu itself is stored by the browser.
api.runtime.onInstalled.addListener(addMenu);
api.contextMenus.onClicked.addListener(openFromMenu);
api.omnibox.onInputEntered.addListener(openFromAddressBar);
api.omnibox.onInputStarted.addListener(() => {
  api.omnibox.setDefaultSuggestion({ description: "Search Telisik for %s" });
});

// tools/extension_e2e.py calls these in the real browser, with the real tabs API.
globalThis.telisikHandlers = Object.freeze({ openFromAddressBar, openFromMenu, MENU_ID });
