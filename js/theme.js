// Runs before the first paint so a saved light or dark choice never flashes the other theme.
(function applySavedTheme() {
  var theme = "auto";
  try {
    var saved = JSON.parse(localStorage.getItem("sumber.settings.v1") || "{}");
    if (saved && (saved.theme === "light" || saved.theme === "dark")) {
      theme = saved.theme;
    }
  } catch (error) {
    theme = "auto";
  }
  document.documentElement.setAttribute("data-theme", theme);
})();
