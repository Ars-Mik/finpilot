// Apply the saved appearance before the application stylesheet is painted.
(() => {
  let theme;
  try {
    const saved = localStorage.getItem('finpilot.theme');
    if (saved === 'light' || saved === 'dark') theme = saved;
  } catch {
    // A private browsing context can restrict storage access.
  }
  theme ??= matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#101923' : '#f5f7fa';
})();
