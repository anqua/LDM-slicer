// Read a design token from css/theme.css, e.g. cssVar('accent') -> '#00ff00'.
export const cssVar = name =>
  getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
