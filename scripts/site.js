(() => {
  const root = document.documentElement;
  const storageKey = 'site-theme';
  const validThemes = new Set(['light', 'dark']);

  const getStoredTheme = () => {
    try {
      const theme = window.localStorage.getItem(storageKey);
      return validThemes.has(theme) ? theme : null;
    } catch {
      return null;
    }
  };

  const getPreferredTheme = () => {
    const stored = getStoredTheme();
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };

  const updateThemeColor = (theme) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#fffafa' : '#070708');
  };

  const updateThemeToggle = (button, theme) => {
    if (!button) return;
    const label = button.querySelector('.theme-toggle-text');
    const isLight = theme === 'light';
    button.setAttribute('aria-pressed', String(isLight));
    button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
    if (label) label.textContent = isLight ? 'Light' : 'Dark';
  };

  const setTheme = (theme, shouldStore = true) => {
    const nextTheme = validThemes.has(theme) ? theme : 'dark';
    root.dataset.theme = nextTheme;
    updateThemeColor(nextTheme);

    if (shouldStore) {
      try {
        window.localStorage.setItem(storageKey, nextTheme);
      } catch {
        // The theme still works for this page even when storage is unavailable.
      }
    }

    updateThemeToggle(document.getElementById('themeToggle'), nextTheme);
  };

  if (!validThemes.has(root.dataset.theme)) {
    root.dataset.theme = getPreferredTheme();
  }
  updateThemeColor(root.dataset.theme);

  const init = () => {
    const navToggle = document.getElementById('navToggle');
    const navLinks = document.getElementById('navLinks');
    const themeToggle = document.getElementById('themeToggle');

    if (navToggle && navLinks) {
      navToggle.addEventListener('click', () => {
        const isOpen = navLinks.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', String(isOpen));
      });
    }

    updateThemeToggle(themeToggle, root.dataset.theme);

    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
