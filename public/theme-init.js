// Apply before first paint; the server's saved theme is authoritative after bootstrap.
(() => {
  try {
    const theme = localStorage.getItem('tt.theme');
    if (['obsidian', 'ocean', 'forest', 'amethyst', 'light'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch {}
})();
