import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { createNativeServer } from '../apps/server/server.js';
import { nativeConfiguration } from '../packages/tavus/native-config.js';
import { fixturePiOptions, PiTutor } from '../packages/tutor/runtime.js';
import { writeOfflineReport } from '../packages/verification/reports.js';

if (process.argv.length !== 2) throw new Error('usage: probe:web (offline only)');
const runtime = await mkdtemp(join(tmpdir(), 'askkai-web-probe-'));
const token = 'synthetic-offline-browser-operator-0123456789';
const app = await createNativeServer({ operatorToken: token, modelMode: 'fixture', tutor: new PiTutor(fixturePiOptions()), runtimeDirectory: runtime,
  configuration: nativeConfiguration({ operatorToken: token, faceId: 'offline-face', publicUrl: 'https://offline.invalid' }) });
await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
const reportDir = resolve(process.env.ASKKAI_OFFLINE_REPORT_DIR ?? '.runtime'); await mkdir(reportDir, { recursive: true });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } }); const errors: string[] = []; let blockedExternalRequests = 0;
  page.on('pageerror', e => errors.push(e.name));
  await page.route('**/*', route => { if (route.request().url().startsWith(base + '/')) return route.continue(); blockedExternalRequests++; return route.abort(); });
  await page.goto(base);
  await page.locator('#access-code').fill(token); await page.locator('#login-form button').click();
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.locator('[data-profile="maya"]').click(); await page.locator('#chinese-only').check(); await page.locator('#save-allowed').check();
  await page.locator('#start').click(); await page.waitForFunction(() => !(document.querySelector('#text') as HTMLInputElement).disabled);
  await page.locator('#text').fill('我昨天去踢足球了。'); await page.locator('#text-form button').click();
  await page.waitForFunction(() => document.querySelector('#diagnostic-data')!.textContent!.includes('"inputCount": 1'));
  await page.locator('#end').click(); await page.locator('#summary-panel').waitFor({ state: 'visible' });
  await page.screenshot({ path: join(reportDir, 'web-probe-desktop.png'), fullPage: true });
  await page.locator('#continue').click(); await page.locator('#summary-panel').waitFor({ state: 'hidden' });
  await page.locator('#text').fill('我还想聊音乐。'); await page.locator('#text-form button').click();
  await page.waitForFunction(() => document.querySelector('#diagnostic-data')!.textContent!.includes('"inputCount": 2'));
  await page.locator('#end').click(); await page.locator('#confirm-end').waitFor({ state: 'visible' }); await page.locator('#confirm-end').click();
  await page.waitForFunction(() => document.querySelector('#connection-status')!.textContent!.includes('已结束'));
  await page.locator('#history').click(); await page.locator('.record').waitFor(); assert.equal(await page.locator('.record').count(), 1);
  assert.match(await page.locator('#summary-text').textContent() ?? '', /足球.*音乐/u);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(reportDir, 'web-probe-mobile.png'), fullPage: true });
  const layout = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll<HTMLElement>('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 12).map(e => ({ id: e.id, class: e.className, width: e.getBoundingClientRect().width })) }));
  assert.ok(layout.width <= layout.viewport, JSON.stringify(layout));
  assert.deepEqual(errors, []); assert.equal(blockedExternalRequests, 0);
  const report = { timestamp: new Date().toISOString(), kind: 'offline-browser-flow', status: 'passed',
    checks: ['login', 'profile-switch', 'prepare', 'text-input', 'planning', 'review-preview', 'resume', 'new-input', 'confirm-exit', 'save-receipt', 'record-readback', 'mobile-layout'],
    pageErrors: errors.length, records: 1, externalRequests: 0, tavusRequests: 0,
    real_supplier: 'not-run', real_media: 'not-run', teaching_quality: 'not-evaluated' };
  await writeOfflineReport('web-probe.json', report); console.log(JSON.stringify(report));
} finally { await browser?.close(); await app.close(); await rm(runtime, { recursive: true, force: true }); }
