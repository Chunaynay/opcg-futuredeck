// 測試用：把 fetch 換成讀本機 fixtures（node --import ./scripts/test/mock-fetch.mjs scripts/fetch-cards.mjs ...）
// routes.json：{ "<url 前綴或完整 url>": "<fixture 檔>" }，另可用 FAIL_HOSTS=webadmin.windoent.com,asia-tc... 模擬來源掛掉
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const routes = JSON.parse(readFileSync(join(here, 'fixtures', 'routes.json'), 'utf8'));
const fail = new Set((process.env.FAIL_HOSTS || '').split(',').filter(Boolean));
globalThis.__fetchLog = [];
globalThis.fetch = async (url) => {
  url = String(url); globalThis.__fetchLog.push(url);
  const host = new URL(url).host;
  if (fail.has(host)) throw new Error(`mock: ${host} down`);
  const key = Object.keys(routes).find(k => url === k || url.startsWith(k));
  if (!key) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  let file = routes[key];
  if (file.includes('{id}')) file = file.replace('{id}', url.slice(key.length).replace(/[^\w-]/g, ''));
  try {
    const body = readFileSync(join(here, 'fixtures', file), 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  } catch (e) { return { ok: false, status: 404, text: async () => '', json: async () => ({}) }; }
};
