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
