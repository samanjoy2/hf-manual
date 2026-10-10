// Run before styles paint so a saved light/system preference never flashes dark.
(() => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  let theme = "dark";
  try {
    const saved = localStorage.getItem("hf-access-desk:theme");
    if (["dark", "light", "system"].includes(saved)) theme = saved;
  } catch { /* Dark is the default when local preferences cannot be read. */ }
  function paint() {
    const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]').content = resolved === "dark" ? "#11151c" : "#ffffff";
  }
  function setTheme(value) {
    theme = ["dark", "light", "system"].includes(value) ? value : "dark";
    try { localStorage.setItem("hf-access-desk:theme", theme); } catch { /* Storage is optional. */ }
    paint();
  }
  media.addEventListener("change", () => { if (theme === "system") paint(); });
  window.hfAppearance = Object.freeze({ setTheme, getTheme: () => theme });
  paint();
})();
