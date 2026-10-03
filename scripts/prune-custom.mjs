#!/usr/bin/env node
// 雙週更新後執行：官方資料（cards.json，含繁中／日版補卡）已收錄的卡號 → 從 custom.json 刪掉那張自訂卡與它的卡圖。
// 結果寫進 last-run.json 的 customRemoved，並把說明接在 commitMessage 後面。
// 用法：node scripts/prune-custom.mjs [--cards site/cards.json] [--custom site/custom.json] [--summary site/last-run.json] [--dry-run]
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null).filter(Boolean));
const CARDS = args.cards || 'site/cards.json', CUSTOM = args.custom || 'site/custom.json', SUMMARY = args.summary || 'site/last-run.json', DRY = !!args['dry-run'];
if (!existsSync(CUSTOM)) { console.log('沒有 custom.json，略過'); process.exit(0); }
const d = JSON.parse(readFileSync(CARDS, 'utf8'));
const off = new Set((Array.isArray(d) ? d : d.cards).map(r => r && r.cardNumber).filter(Boolean));
if (off.size < 1000) { console.log(`cards.json 只有 ${off.size} 個卡號，看起來不完整，不動自訂卡`); process.exit(0); }
const cj = JSON.parse(readFileSync(CUSTOM, 'utf8'));
const keep = [], gone = [];
for (const c of cj.cards || []) (off.has(c.cardNumber) ? gone : keep).push(c);
if (!gone.length) { console.log(`自訂卡 ${keep.length} 張，沒有和官方重複`); process.exit(0); }
const base = dirname(CUSTOM);
const stillUsed = new Set(keep.map(c => c.cardImg).filter(Boolean));
for (const c of gone) {
  console.log(`官方已收錄 ${c.cardNumber}「${c.cardName}」→ 刪除自訂卡${c.cardImg ? '與 ' + c.cardImg : ''}`);
  if (!DRY && c.cardImg && !stillUsed.has(c.cardImg) && /^custom\/[^/]+$/.test(c.cardImg)) { try { unlinkSync(join(base, c.cardImg)); } catch (e) {} }
}
const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00';
if (!DRY) writeFileSync(CUSTOM, JSON.stringify({ ...cj, updatedAt: stamp, cards: keep }, null, 1) + '\n');
const list = gone.map(c => c.cardNumber);
if (!DRY && existsSync(SUMMARY)) {
  const s = JSON.parse(readFileSync(SUMMARY, 'utf8'));
  s.customRemoved = list;
  s.commitMessage = `${s.commitMessage || 'cards'}；移除已正式收錄的自訂卡 ${list.length} 張（${list.slice(0, 8).join('、')}${list.length > 8 ? '…' : ''}）`;
  writeFileSync(SUMMARY, JSON.stringify(s, null, 2));
}
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `- 移除已正式收錄的自訂卡 ${list.length} 張：${list.join('、')}\n`, { flag: 'a' });
console.log(`完成：保留 ${keep.length} 張，移除 ${list.length} 張`);
