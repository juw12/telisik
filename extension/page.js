// The search box of the new tab page and of the toolbar popup.

import { searchUrl } from "./url.js";

const form = document.getElementById("search-form");
const input = document.getElementById("q");
const isPopup = document.body.dataset.surface === "popup";

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = searchUrl(input.value);
  if (isPopup) {
    const api = globalThis.browser ?? globalThis.chrome;
    api.tabs.create({ url });
    window.close();
    return;
  }
  location.assign(url);
});

input.focus();

// Firefox shows the caret in the bubble but often keeps the keyboard in the browser window until one click
// (measured with real keys in Firefox 150.0.2; Mozilla bugs 1512917 and 1918031). A page cannot take the
// keyboard by itself, so the bubble says what to do. The address is the test because Chrome now has
// `browser` as well.
if (isPopup && location.protocol === "moz-extension:") {
  document.getElementById("firefox-hint").hidden = false;
}
