import { defineConfig } from '@playwright/test';
const baseURL = `http://127.0.0.1:${process.env.AVA_PREVIEW_PORT ?? 5173}`;

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: 'npm run dev:preview',
    // Browser regression tests must not use a developer's real model or credentials.
    env: {
      HOST: '127.0.0.1',
      AVA_API_KEY: '',
      AVA_MODEL: '',
      AVA_BASE_URL: '',
      PLUGIN_ACCESS_TOKEN: '',
    },
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
