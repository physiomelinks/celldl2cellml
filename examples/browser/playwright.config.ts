import { defineConfig, devices } from '@playwright/test'

const PORT = 4173

// Where Playwright's own Chromium can't be downloaded, point this at one that's installed
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

export default defineConfig({
  testDir: 'test',
  // Each browser runs every case; the cases share one page, so one worker per browser is enough
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 120_000,
  use: {
    baseURL: `http://localhost:${PORT}/`,
  },
  // The production build, as an application would serve it
  webServer: {
    command: `yarn build && yarn preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}) },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
