import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Lazy script loads (hls.js) and provider iframes are asserted, not executed.
    environmentOptions: { happyDOM: { settings: { handleDisabledFileLoadingAsSuccess: true, disableIframePageLoading: true } } },
  },
});
