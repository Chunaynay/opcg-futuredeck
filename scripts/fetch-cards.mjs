#!/usr/bin/env node
// OPCG 未來牌組構築器 — 三源卡片資料抓取與合併
//
//   簡中官網  onepiece-cardgame.cn   → webadmin.windoent.com 隱藏 API（JSON）
//   繁中官網  asia-tc.onepiece-cardgame.com/cardlist/?series=ID（伺服器渲染 HTML）
//   日版官網  www.onepiece-cardgame.com/cardlist/?series=ID（同一套模板）
//
// 合併規則（使用者 2026-10-03 決定）：簡中優先；簡中沒有的卡號補繁中、再補日文。
// 補進來的卡一律轉成簡中 API 的 raw 欄位格式（cardType 领袖／cardColor 红 …），構築器的 norm() 不用改。
// 每筆多一個 lang 欄位（cn／tw／jp）標示文字來源；簡中卡另帶 cardNameTw／cardNameJp 當搜尋別名。
//
// 用法：node scripts/fetch-cards.mjs [--out site/cards.json] [--prev site/cards.json]
//                                   [--summary site/last-run.json] [--only cn,tw,jp] [--series-limit N]
// 任一來源失敗（連不上、數量異常）→ 沿用 --prev 裡該來源的舊資料，絕不輸出殘缺檔。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true'] : []).filter(Boolean));
const OUT = args.out || 'site/cards.json';
const PREV = args.prev || OUT;
const SUMMARY = args.summary || 'site/last-run.json';
const ONLY = new Set((args.only || 'cn,tw,jp').split(',').map(s => s.trim()).filter(Boolean));
const SERIES_LIMIT = args['series-limit'] ? parseInt(args['series-limit'], 10) : Infinity;
const LOG = (...m) => console.error(new Date().toISOString().slice(11, 19), ...m);

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SRC = {
  cn: { base: 'https://webadmin.windoent.com/front/op-public/', site: 'https://www.onepiece-cardgame.cn/', label: '簡中官網' },
  tw: { site: 'https://asia-tc.onepiece-cardgame.com/', label: '繁中官網' },
  jp: { site: 'https://www.onepiece-cardgame.com/', label: '日版官網' },
};

/* ---------- 共用：fetch with retry ---------- */
async function get(url, { json = false, headers = {}, tries = 4, timeout = 30000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9,ja;q=0.8,en;q=0.7', ...headers }, signal: ac.signal, redirect: 'follow' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return json ? await r.json() : await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise(res => setTimeout(res, 800 * (i + 1) + Math.random() * 400));
    } finally { clearTimeout(t); }
  }
  throw new Error(`${url} → ${lastErr && lastErr.message}`);
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* ---------- 簡中：windoent API ---------- */
const CN_KEEP = ['id', 'cardNumber', 'cardName', 'cardType', 'cardRarity', 'cardOfferType', 'cardLife', 'cardAttribute', 'cardColor', 'cardPower', 'cardAttack', 'cardFeatures', 'cardTextDesc', 'cardTrigger', 'subscript', 'mixedColor', 'cardImg', 'displayId', 'cardCartograph'];
async function fetchCN(prevById) {
  const H = { referer: SRC.cn.site, origin: SRC.cn.site.replace(/\/$/, ''), accept: 'application/json, text/plain, */*' };
  const listUrl = p => `${SRC.cn.base}cardList/cardlist/weblist?cardOfferType=&cardColor=&cardType=&cardCartograph=&subscript=&limit=1000&page=${p}`;
  const first = await get(listUrl(1), { json: true, headers: H });
  if (!first || first.code !== 0 || !first.page) throw new Error('weblist 回傳格式不符');
  const totalPage = first.page.totalPage || 1, total = first.page.totalCount || 0;
  let list = [...first.page.list];
  for (let p = 2; p <= totalPage; p++) { const j = await get(listUrl(p), { json: true, headers: H }); list.push(...(j.page?.list || [])); }
  LOG(`CN 清單 ${list.length}/${total} 筆（${totalPage} 頁）`);
  let fail = 0, reused = 0;
  const cards = await pool(list, 12, async (it, k) => {
    if (k && k % 500 === 0) LOG(`CN 詳情 ${k}/${list.length}`);
    try {
      const j = await get(`${SRC.cn.base}cardList/cardlist/webInfo/${it.id}`, { json: true, headers: H, tries: 3, timeout: 20000 });
      if (!j || j.code !== 0 || !j.info) throw new Error('webInfo 格式不符');
      const o = {}; for (const k2 of CN_KEEP) if (j.info[k2] !== undefined) o[k2] = j.info[k2];
      if (!o.cardImg) o.cardImg = it.cardImg; if (!o.cardOfferType) o.cardOfferType = it.cardOfferType;
      return o;
    } catch (e) {
      const old = prevById.get(it.id); if (old) { reused++; return old; }
      fail++; return null;
    }
  });
  const ok = cards.filter(Boolean);
  if (ok.length < total * 0.97) throw new Error(`CN 詳情只拿到 ${ok.length}/${total}（失敗 ${fail}）`);
  ok.sort((a, b) => (a.displayId || 0) - (b.displayId || 0));
  return { cards: ok, note: `詳情失敗 ${fail}、沿用舊資料 ${reused}` };
}

/* ---------- 繁中／日版：HTML 解析 ---------- */
const decode = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
const text = h => decode(String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t　]+/g, ' ').replace(/ *\n */g, '\n').trim();
// 從 html 的 from 位置起，找 <div class="cls"> 並回傳其 innerHTML（計算巢狀 div）
function divByClass(html, cls, from = 0) {
  const re = new RegExp(`<div[^>]*class="${cls}"[^>]*>`, 'g'); re.lastIndex = from;
  const m = re.exec(html); if (!m) return null;
  let i = re.lastIndex, depth = 1;
  const tag = /<\/?div\b[^>]*>/g; tag.lastIndex = i;
  let t;
  while ((t = tag.exec(html))) { if (t[0][1] === '/') { if (--depth === 0) return html.slice(i, t.index); } else depth++; }
  return html.slice(i);
}
const field = (block, cls) => { const h = divByClass(block, cls); if (h == null) return null; return text(h.replace(/<h3>[\s\S]*?<\/h3>/, '').replace(/<div class="getInfoBtnCol">[\s\S]*$/, '').replace(/<button[\s\S]*?<\/button>/g, '').replace(/<a [\s\S]*?<\/a>/g, '')); };
function parseSeriesOptions(html) {
  const sel = html.match(/<select[^>]*id="series"[^>]*>([\s\S]*?)<\/select>/i);
  if (!sel) throw new Error('找不到 <select id="series">');
  const out = [];
  // 官網的 option 文字裡有被跳脫的 &lt;br class="spInline"&gt;，decode 後再去掉一次
  for (const m of sel[1].matchAll(/<option[^>]*value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)) out.push({ id: m[1], name: text(m[2]).replace(/<br[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() });
  if (!out.length) throw new Error('系列清單為空');
  return out;
}
function parseCardBlocks(html, origin) {
  const out = [];
  for (const m of html.matchAll(/<dl class="modalCol"[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/dl>/g)) {
    const id = m[1], b = m[2];
    const info = (divByClass(b, 'infoCol') || '').split('|').map(text);
    const img = b.match(/data-src="([^"]+)"/) || b.match(/<img[^>]*src="([^"]*cardlist\/card[^"]+)"/);
    const attrImgs = [...(divByClass(b, 'attribute') || '').matchAll(/alt="([^"]*)"/g)].map(x => x[1]);
    out.push({
      id, cardNumber: id.split('_')[0], name: text(divByClass(b, 'cardName') || ''),
      rarity: info[1] || '', typeEn: info[2] || '',
      img: img ? new URL(img[1].replace(/\?.*$/, ''), origin + 'cardlist/').href : '',
      costOrLife: field(b, 'cost'), attrs: attrImgs, power: field(b, 'power'), counter: field(b, 'counter'),
      color: field(b, 'color'), block: field(b, 'block'), feature: field(b, 'feature'), text: field(b, 'text'),
      trigger: field(b, 'trigger'), getInfo: (field(b, 'getInfo') || '').split('\n')[0].trim(),
    });
  }
  return out;
}
async function fetchSite(key) {
  const origin = SRC[key].site;
  const index = await get(origin + 'cardlist/');
  const series = parseSeriesOptions(index).slice(0, SERIES_LIMIT);
  LOG(`${key.toUpperCase()} 系列 ${series.length} 個`);
  const rows = [], seen = new Set(); let failed = 0, dup = 0;
  for (const s of series) {
    try {
      const html = await get(`${origin}cardlist/?series=${s.id}`);
      const cards = parseCardBlocks(html, origin);
      if (!cards.length) throw new Error('頁面裡沒有卡片（結構改了？）');
      for (const c of cards) { if (seen.has(c.id)) { dup++; continue; } seen.add(c.id); c.seriesId = s.id; c.seriesName = s.name; rows.push(c); } // 同一印刷會出現在多個系列頁（再版），只留第一次
    } catch (e) { failed++; LOG(`${key} 系列 ${s.id} ${s.name} 失敗：${e.message}`); }
    await new Promise(r => setTimeout(r, 150));
  }
  if (failed > series.length * 0.1) throw new Error(`${key} 有 ${failed}/${series.length} 個系列抓不到`);
  if (!rows.length) throw new Error(`${key} 沒抓到任何卡`);
  return { rows, note: `${series.length} 系列、失敗 ${failed}、重複印刷 ${dup}` };
}

/* ---------- 轉成簡中 raw 格式 ---------- */
const TYPE_MAP = { LEADER: '领袖', CHARACTER: '角色', EVENT: '事件', STAGE: '舞台' };
const COLOR_CH = { '紅': '红', '綠': '绿', '藍': '蓝', '紫': '紫', '黑': '黑', '黃': '黄', '赤': '红', '緑': '绿', '青': '蓝', '黒': '黑', '黄': '黄', '红': '红', '绿': '绿', '蓝': '蓝' };
const ATTR_CH = { '打': '打', '斬': '斩', '斩': '斩', '射': '射', '特': '特', '知': '知', '智': '知' };
const dash = v => (v == null || v === '' || v === '-' || v === '—' || v === 'ー') ? '-' : v;
function toRaw(c, lang, idx) {
  const colors = [...new Set([...(c.color || '')].map(ch => COLOR_CH[ch]).filter(Boolean))];
  const attrs = [...new Set(c.attrs.flatMap(a => a.split(/[\/／]/)).map(a => ATTR_CH[a.trim()]).filter(Boolean))];
  const blk = (c.block || '').trim(); const blkN = /^\d+$/.test(blk) ? +blk : 0;
  const rar = (c.rarity || '').replace(/卡|カード/g, '').trim().toUpperCase();
  return {
    id: 9000000 + idx, displayId: 1000000 + idx,
    cardNumber: c.cardNumber, cardName: c.name,
    cardType: TYPE_MAP[c.typeEn.toUpperCase()] || c.typeEn,
    cardRarity: rar, cardOfferType: c.getInfo || c.seriesName || '',
    cardLife: dash(c.costOrLife), cardAttribute: attrs.length ? attrs : ['-'],
    cardColor: colors.join('/'), mixedColor: colors.length > 1 ? 1 : 0,
    cardPower: dash(c.power), cardAttack: dash(c.counter),
    cardFeatures: (c.feature || '').replace(/\n/g, '/'),
    cardTextDesc: c.text || '',
    cardTrigger: (c.trigger || '').replace(/^\s*【(触发|觸發器?|トリガー)】\s*/, ''),
    subscript: blkN, cardImg: c.img, cardCartograph: '',
    lang,
  };
}

/* ---------- 主流程 ---------- */
let prev = null;
try { if (existsSync(PREV)) prev = JSON.parse(readFileSync(PREV, 'utf8')); } catch (e) { LOG('讀取舊 cards.json 失敗：', e.message); }
const prevCards = prev ? (prev.cards || []) : [];
const prevLang = c => c.lang || 'cn'; // 舊版單源檔沒有 lang，全部視為簡中
const prevByLang = { cn: prevCards.filter(c => prevLang(c) === 'cn'), tw: prevCards.filter(c => prevLang(c) === 'tw'), jp: prevCards.filter(c => prevLang(c) === 'jp') };
const prevSrc = prev?.sources || {};
const prevById = new Map(prevByLang.cn.map(c => [c.id, c]));
const now = new Date().toISOString();
const sources = {};

// 1) 簡中
let cn = [];
if (ONLY.has('cn')) {
  try { const r = await fetchCN(prevById); cn = r.cards; sources.cn = { status: 'ok', count: cn.length, fetchedAt: now, note: r.note }; }
  catch (e) { LOG('CN 失敗：', e.message); cn = prevByLang.cn; sources.cn = { status: cn.length ? 'reused' : 'failed', count: cn.length, fetchedAt: prevSrc.cn?.fetchedAt || prev?.fetchedAt || null, error: e.message }; }
} else { cn = prevByLang.cn; sources.cn = { status: 'skipped', count: cn.length, fetchedAt: prevSrc.cn?.fetchedAt || prev?.fetchedAt || null }; }
cn = cn.map(c => ({ ...c, lang: 'cn' }));
const cnNos = new Set(cn.map(c => c.cardNumber));

// 2) 繁中、3) 日版：抓原始列，失敗就沿用舊的補卡（舊補卡已是 raw 格式，只能原樣沿用）
async function site(key) {
  if (!ONLY.has(key)) return { rows: null, status: 'skipped' };
  try { const r = await fetchSite(key); return { rows: r.rows, status: 'ok', note: r.note }; }
  catch (e) { LOG(`${key} 失敗：`, e.message); return { rows: null, status: 'failed', error: e.message }; }
}
const [tw, jp] = [await site('tw'), await site('jp')];

// 別名表（卡號 → 名稱）
const twName = new Map(), jpName = new Map();
if (tw.rows) for (const c of tw.rows) if (!twName.has(c.cardNumber) && c.name) twName.set(c.cardNumber, c.name);
if (jp.rows) for (const c of jp.rows) if (!jpName.has(c.cardNumber) && c.name) jpName.set(c.cardNumber, c.name);
// 舊檔的別名在來源抓不到時沿用
if (!tw.rows) for (const c of prevCards) if (c.cardNameTw) twName.set(c.cardNumber, c.cardNameTw);
if (!jp.rows) for (const c of prevCards) if (c.cardNameJp) jpName.set(c.cardNumber, c.cardNameJp);

let idx = 0;
const twFill = tw.rows ? tw.rows.filter(c => !cnNos.has(c.cardNumber)).map(c => toRaw(c, 'tw', idx++)) : prevByLang.tw.filter(c => !cnNos.has(c.cardNumber));
const twNos = new Set(twFill.map(c => c.cardNumber));
const jpFill = jp.rows ? jp.rows.filter(c => !cnNos.has(c.cardNumber) && !twNos.has(c.cardNumber)).map(c => toRaw(c, 'jp', idx++)) : prevByLang.jp.filter(c => !cnNos.has(c.cardNumber) && !twNos.has(c.cardNumber));
sources.tw = { status: tw.status, count: tw.rows ? tw.rows.length : null, fill: twFill.length, fetchedAt: tw.rows ? now : (prevSrc.tw?.fetchedAt || null), note: tw.note, error: tw.error };
sources.jp = { status: jp.status, count: jp.rows ? jp.rows.length : null, fill: jpFill.length, fetchedAt: jp.rows ? now : (prevSrc.jp?.fetchedAt || null), note: jp.note, error: jp.error };

for (const c of cn) { const a = twName.get(c.cardNumber), b = jpName.get(c.cardNumber); if (a) c.cardNameTw = a; else delete c.cardNameTw; if (b) c.cardNameJp = b; else delete c.cardNameJp; }
for (const c of twFill) { const b = jpName.get(c.cardNumber); if (b) c.cardNameJp = b; }
const cards = [...cn, ...twFill.sort((a, b) => a.cardNumber.localeCompare(b.cardNumber)), ...jpFill.sort((a, b) => a.cardNumber.localeCompare(b.cardNumber))];

// 全部來源都失敗且沒有舊檔 → 不要輸出
if (!cards.length) { LOG('沒有任何卡片資料，放棄輸出'); process.exit(2); }
if (prevCards.length && cards.length < prevCards.length * 0.9) { LOG(`卡片數 ${cards.length} 比舊檔 ${prevCards.length} 少超過 10%，放棄輸出`); process.exit(3); }

// 統計與差異
const nos = new Set(cards.map(c => c.cardNumber)), prevNos = new Set(prevCards.map(c => c.cardNumber));
const newNos = [...nos].filter(n => !prevNos.has(n)).sort();
const goneNos = [...prevNos].filter(n => !nos.has(n)).sort();
const setOf = arr => { const m = new Map(); for (const c of arr) { if (!m.has(c.cardOfferType)) m.set(c.cardOfferType, 0); m.set(c.cardOfferType, m.get(c.cardOfferType) + 1); } return m; };
const newSets = [...setOf(cards.filter(c => newNos.includes(c.cardNumber)))].map(([k, v]) => `${k}（${v}）`);
const langOfNo = arr => { const m = new Map(); for (const c of arr) if (!m.has(c.cardNumber)) m.set(c.cardNumber, c.lang || 'cn'); return m; };
const L0 = langOfNo(prevCards), L1 = langOfNo(cards);
const upgraded = [...L1].filter(([n, l]) => L0.has(n) && L0.get(n) !== l && l === 'cn').length; // 原本補卡、現在簡中已收錄
const byLang = { cn: new Set(cn.map(c => c.cardNumber)).size, tw: twNos.size, jp: new Set(jpFill.map(c => c.cardNumber)).size };
const stamp = now.slice(0, 10);
const srcLine = ['cn', 'tw', 'jp'].map(k => `${k.toUpperCase()} ${sources[k].status}${sources[k].count != null ? ' ' + sources[k].count : ''}`).join(' / ');
const commitMessage = `cards ${stamp}：${nos.size} 張（簡中 ${byLang.cn}、補繁中 ${byLang.tw}、補日文 ${byLang.jp}）${newNos.length ? `，新增 ${newNos.length} 張` : '，無新卡'}${newSets.length ? '：' + newSets.slice(0, 4).join('、') : ''} [${srcLine}]`;

const out = { source: 'merged', fetchedAt: now, count: cards.length, sources, stats: { cardNumbers: nos.size, byLang, newCards: newNos.length, newSets, upgradedToCn: upgraded, removed: goneNos.length }, cards };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const summary = { ranAt: now, ok: true, changed: JSON.stringify(prevCards) !== JSON.stringify(cards), sources, stats: out.stats, newCards: newNos.slice(0, 300), removedCards: goneNos.slice(0, 100), commitMessage };
mkdirSync(dirname(SUMMARY), { recursive: true });
writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));

const md = [`### 卡片資料更新 ${stamp}`, '', `| 來源 | 狀態 | 筆數 | 說明 |`, `|---|---|---|---|`,
  ...['cn', 'tw', 'jp'].map(k => `| ${SRC[k].label} | ${sources[k].status} | ${sources[k].count ?? '-'}${sources[k].fill != null ? `（補 ${sources[k].fill}）` : ''} | ${sources[k].note || sources[k].error || ''} |`),
  '', `- 合併後 ${nos.size} 張卡（${cards.length} 個印刷）：簡中 ${byLang.cn}、補繁中 ${byLang.tw}、補日文 ${byLang.jp}`,
  `- 新增 ${newNos.length} 張${newSets.length ? '：' + newSets.join('、') : ''}`, `- 原本靠補卡、現在簡中已收錄：${upgraded} 張；移除：${goneNos.length} 張`].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', { flag: 'a' });
LOG('完成：', commitMessage);
