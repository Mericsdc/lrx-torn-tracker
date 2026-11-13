// Apply before first paint; the server's saved theme is authoritative after bootstrap.
(() => {
  try {
    const theme = localStorage.getItem('tt.theme');
    if (['obsidian', 'ocean', 'forest', 'amethyst', 'light'].includes(theme)) document.documentElement.dataset.theme = theme;
  } catch {}
  // Web fonts: the stylesheet above loads without blocking the page; use it once it is here.
  // (Done here, not in an inline onload attribute: the page's Content-Security-Policy allows no inline script.)
  const fonts = document.getElementById('web-fonts');
  if (fonts) {
    const show = () => { fonts.media = 'all'; };
    if (fonts.sheet) show(); else fonts.addEventListener('load', show, { once: true });
  }
})();
