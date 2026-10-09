import { boot } from './loader.ts';

declare global {
  interface Window {
    __instafeedBooted?: boolean;
  }
}

// The block and the embed may both include this script; boot exactly once per page.
if (!window.__instafeedBooted) {
  window.__instafeedBooted = true;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
}
