// Runs before the first paint so a saved light or dark choice never flashes the other theme.
(function applySavedTheme() {
  var theme = "auto";
  try {
    // "sumber.settings.v1" is the key from before the rename; app.js moves it on first load.
    var saved = JSON.parse(
      localStorage.getItem("telisik.settings.v1") || localStorage.getItem("sumber.settings.v1") || "{}"
    );
    if (saved && (saved.theme === "light" || saved.theme === "dark")) {
      theme = saved.theme;
    }
  } catch (error) {
    theme = "auto";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
