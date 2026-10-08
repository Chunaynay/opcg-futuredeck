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
// v4.0：頂層另有 tw（卡號 → 繁中卡名／效果／觸發／特徵）、twSets、twFeats，構築器以繁中顯示；site/terms.json 為用語比對報告。
//
// 用法：node scripts/fetch-cards.mjs [--out site/cards.json] [--prev site/cards.json]
//                                   [--summary site/last-run.json] [--only cn,tw,jp] [--series-limit N]
//       node scripts/fetch-cards.mjs --only none --summary /tmp/x.json   ← 不抓官網，只用現有 cards.json 重算特徵對照（改了 feat-alias.json 或 custom.json 之後）
// 任一來源失敗（連不上、數量異常）→ 沿用 --prev 裡該來源的舊資料，絕不輸出殘缺檔。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

if (ONLY.has('none') && prev?.sources) Object.assign(sources, prev.sources); // --only none＝只重算對照，資料與來源狀態沿用上次
for (const c of cn) { const a = twName.get(c.cardNumber), b = jpName.get(c.cardNumber); if (a) c.cardNameTw = a; else delete c.cardNameTw; if (b) c.cardNameJp = b; else delete c.cardNameJp; }
for (const c of twFill) { const b = jpName.get(c.cardNumber); if (b) c.cardNameJp = b; }

// 簡中 API 偶有效果文缺漏（例 EB02-030、EB01-021、EB01-040 的 cardTextDesc 是「-」）→ 依卡號先用同號其他簡中印刷、再繁中、再日版的效果文補上（後兩者標 textLang）
const blankT = v => !v || /^[-—ー\s]*$/.test(String(v));
const cnText = new Map(), twText = new Map(), jpText = new Map();
for (const c of cn) if (!c.textLang && !blankT(c.cardTextDesc) && !cnText.has(c.cardNumber)) cnText.set(c.cardNumber, c);
if (tw.rows) for (const c of tw.rows) if (!twText.has(c.cardNumber) && !blankT(c.text)) twText.set(c.cardNumber, c);
if (jp.rows) for (const c of jp.rows) if (!jpText.has(c.cardNumber) && !blankT(c.text)) jpText.set(c.cardNumber, c);
const prevTextById = new Map(prevCards.filter(c => c.textLang).map(c => [c.id, c]));
const textFilled = [];
for (const c of cn) {
  if (!c.textLang && !blankT(c.cardTextDesc)) continue;
  const sib = cnText.get(c.cardNumber); // 同卡號其他簡中印刷（異圖）有效果文 → 直接沿用
  if (sib) { c.cardTextDesc = sib.cardTextDesc; if (blankT(c.cardTrigger) && !blankT(sib.cardTrigger)) c.cardTrigger = sib.cardTrigger; delete c.textLang; textFilled.push(c.cardNumber); continue; }
  const r = twText.get(c.cardNumber) || jpText.get(c.cardNumber);
  if (r) {
    c.cardTextDesc = r.text; c.textLang = twText.has(c.cardNumber) ? 'tw' : 'jp';
    const trg = (r.trigger || '').replace(/^\s*【(触发|觸發器?|トリガー)】\s*/, '');
    if (blankT(c.cardTrigger) && trg) c.cardTrigger = trg;
    textFilled.push(c.cardNumber);
  } else if (!c.textLang) {
    const p = prevTextById.get(c.id);
    if (p) { c.cardTextDesc = p.cardTextDesc; c.cardTrigger = p.cardTrigger; c.textLang = p.textLang; textFilled.push(c.cardNumber); }
  }
}
if (textFilled.length) LOG(`簡中缺效果文、補上 ${new Set(textFilled).size} 張：${[...new Set(textFilled)].join('、')}`);

// v4.0 繁中全文（使用者 2026-10-05 決定：卡片文字一律以繁中官方規格顯示，卡圖以簡中為主；繁中官網沒有的卡保留簡中原文）
// 輸出 out.tw：卡號 → {n 卡名, t 效果, g 觸發（去掉【觸發器】前綴）, f 特徵（/ 分隔）}，只收簡中卡（補卡本身就是繁中／日文）。
// 另以「簡中＋繁中都有」的卡自動比對出 系列名、特徵、【】關鍵字 對照 → out.twSets、out.twFeats、site/terms.json（供人工確認用語）。
const TRIG_RE = /^\s*【(触发|觸發器?|トリガー)】\s*/;
const vote = (m, a, b) => { if (!a || !b) return; let x = m.get(a); if (!x) m.set(a, x = new Map()); x.set(b, (x.get(b) || 0) + 1); };
const topOf = m => { const out = {}, rows = []; for (const [a, x] of m) { const arr = [...x].sort((p, q) => q[1] - p[1]); const tot = arr.reduce((s, v) => s + v[1], 0); out[a] = arr[0][0]; rows.push({ sc: a, tw: arr[0][0], n: arr[0][1], total: tot, share: +(arr[0][1] / tot).toFixed(3), alts: arr.slice(1, 4).map(([k, v]) => `${k}×${v}`) }); } rows.sort((p, q) => q.total - p.total); return { map: out, rows }; };
const TWX = {}; let twSets = {}, twFeats = {}, terms = null;
if (tw.rows) {
  const best = new Map();
  for (const c of tw.rows) { // 同卡號多個印刷：取效果文最長的那筆（再版頁偶有佔位文字）
    const sc = (blankT(c.text) || c.text === '重複印刷' ? 0 : c.text.length) * 2 + (c.id.includes('_') ? 0 : 1);
    const cur = best.get(c.cardNumber); if (!cur || sc > cur.sc) best.set(c.cardNumber, { sc, c });
  }
  const setV = new Map(), kwV = new Map();
  const cnFirst = new Map(), cnSets = new Map();
  for (const c of cn) { if (!cnFirst.has(c.cardNumber)) cnFirst.set(c.cardNumber, c); let s = cnSets.get(c.cardNumber); if (!s) cnSets.set(c.cardNumber, s = new Set()); if (c.cardOfferType) s.add(c.cardOfferType); }
  const twSetsByNo = new Map(); for (const c of tw.rows) { let s = twSetsByNo.get(c.cardNumber); if (!s) twSetsByNo.set(c.cardNumber, s = new Set()); const nm = c.getInfo || c.seriesName; if (nm) s.add(nm); }
  for (const [no, { c }] of best) {
    if (!cnNos.has(no)) continue;
    const o = {}; if (c.name) o.n = c.name;
    if (!blankT(c.text) && c.text !== '重複印刷') o.t = c.text;
    const g = (c.trigger || '').replace(TRIG_RE, '').trim(); if (g) o.g = g;
    if (c.feature) o.f = c.feature.replace(/\n/g, '/');
    TWX[no] = o;
    const s = cnFirst.get(no);
    // 【】關鍵字：依出現順序配對（數量相同才比）
    if (o.t != null && s.textLang == null) {
      const ka = ((s.cardTextDesc || '') + (s.cardTrigger ? '【触发】' + s.cardTrigger : '')).match(/【[^】]+】/g) || [];
      const kb = ((o.t || '') + (o.g ? '【觸發器】' + o.g : '')).match(/【[^】]+】/g) || [];
      if (ka.length && ka.length === kb.length) ka.forEach((x, i) => vote(kwV, x, kb[i]));
    }
    // 系列名：兩邊都只有一個系列的卡號才配對
    const sa = cnSets.get(no), sb = twSetsByNo.get(no);
    // 系列名：兩邊都只有一個系列的卡號才配對；有【代號】的必須代號相同（避免把再版系列配錯）
    // v4.1：簡中代號多一個 C（OPC-13／EBC-02／STC-13／PRBC-01），繁中是 OP-13／EB-02／ST-13／PRB-01 → 比對前去掉
    const code = x => ((String(x).match(/【([^】]+)】/) || [])[1] || '').toUpperCase().replace(/^([A-Z]+?)C(?=[-\d])/, '$1').replace(/[-\s]/g, '');
    if (sa && sb && sa.size === 1 && sb.size === 1) { const a = [...sa][0], b = [...sb][0]; if (code(a) === code(b)) vote(setV, a, b); }
  }
  const S = topOf(setV), K = topOf(kwV);
  twSets = {}; for (const r of S.rows) if (/【[^】]+】/.test(r.sc) || (r.n >= 2 && r.share >= 0.8)) twSets[r.sc] = r.tw; // 無代號的系列要 2 張以上且 8 成一致才收
  terms = { generatedAt: now, note: '由簡中＋繁中官網同卡號自動比對產生；share＜0.95 的列為 conflicts，需人工確認', keywords: K.rows, sets: S.rows,
    conflicts: K.rows.filter(r => r.share < 0.95 && r.total >= 3).map(r => `${r.sc} → ${r.tw}（${Math.round(r.share * 100)}%；另有 ${r.alts.join('、')}）`) };
} else if (prev && prev.tw) { Object.assign(TWX, prev.tw); twSets = prev.twSets || {}; terms = prev.terms || null; }
for (const no of Object.keys(TWX)) if (!cnNos.has(no)) delete TWX[no];

/* ---------- v4.1 特徵統合（簡中、繁中、日文 → 一份統一的繁中特徵） ----------
 * 目標：網站上每個特徵只出現一種寫法，而且是繁中官方寫法。
 * 1. 繁中官網本身的寫法先正規化 canonTw()：全形英數→半形、日文漢字變體（団→團、獣→獸、学→學…）、
 *    「原／元◯◯」→「前◯◯」（官網舊彈用「原」、新彈用「前」）、再套 scripts/feat-alias.json 的人工對照。
 * 2. 簡中特徵 → 繁中：以同卡號的簡中／繁中特徵配對投票（數量相同依位置；數量不同時先扣掉已知配對再對剩下的），取票數最高者。
 * 3. 沒有任何繁中對應的簡中特徵（簡中獨有宣傳卡、custom.json 的未發售卡）：先查人工對照，再用簡→繁字表＋詞彙規則
 *    （海盗团→海賊團、胡子→鬍子…）轉字形；轉出來若剛好是已知的繁中特徵就併入。
 * 產出：out.twFeats（簡中原文 → 統一繁中，涵蓋 cards.json 與 custom.json 出現的所有簡中特徵）、
 *      out.twFeatAlias（繁中官網異體寫法／日文 → 統一繁中，網站執行期用它正規化繁中卡的特徵）、terms.json 的 features 區。
 * 不重抓官網也能重算：node scripts/fetch-cards.mjs --only none（用現有 cards.json 的 tw 區）。
 */
const S2T_PAIRS = '万萬与與业業丛叢东東丝絲丢丟两兩严嚴丧喪个個临臨为為丽麗么麼义義乌烏乐樂乔喬乡鄉乱亂于於云雲亚亞亲親亿億仅僅仆僕从從仑侖仪儀们們优優伙夥会會传傳伤傷伦倫伪偽体體余餘儿兒兰蘭关關兹茲兽獸内內冈岡册冊军軍冲衝决決冻凍准準减減几幾凤鳳凭憑凯凱凶兇击擊则則刚剛创創别別剑劍剧劇动動势勢区區医醫华華单單卖賣卢盧卫衛厅廳历歷压壓厮廝参參双雙发發变變台臺叶葉号號吗嗎吨噸听聽启啟啧嘖啮齧啰囉喷噴团團园園国國图圖圆圓圣聖场場坏壞块塊坚堅坠墜垫墊墙牆壮壯声聲处處备備复復够夠头頭夹夾奋奮奖獎奥奧妇婦妈媽娅婭学學宝寶实實审審宫宮宾賓对對寻尋寿壽将將尔爾尘塵属屬岁歲岚嵐岛島师師带帶帮幫并並广廣库庫应應庞龐废廢开開异異弃棄张張弯彎弹彈强強当當彻徹征徵怀懷态態总總恋戀恒恆恶惡恼惱悬懸惯慣戏戲战戰户戶扑撲护護报報拟擬拥擁择擇挡擋挥揮换換据據摆擺摇搖敌敵数數斗鬥斩斬断斷无無时時术術机機杀殺杂雜权權条條来來杰傑极極枪槍标標树樹栗慄样樣档檔梦夢槛檻横橫樱櫻欢歡欧歐残殘毁毀毕畢气氣汉漢汤湯没沒泪淚泷瀧泼潑泽澤洁潔浅淺浆漿涡渦润潤温溫游遊滚滾潜潛灭滅灵靈灾災点點炽熾烟煙烦煩烧燒烩燴烬燼热熱爱愛爷爺状狀独獨狮獅狱獄猎獵猫貓猬蝟玛瑪环環现現琼瓊电電画畫瘾癮盖蓋盗盜着著砾礫确確礼禮禄祿离離种種称稱稣穌竞競笼籠简簡篮籃类類粮糧红紅约約级級纪紀纯純纲綱纳納纸紙纽紐线線练練组組终終绊絆经經结結绘繪给給绝絕绞絞继繼续續绳繩维維绵綿绿綠缓緩缘緣缝縫缪繆网網罗羅羁羈联聯肤膚胆膽胜勝胶膠脉脈脏臟脑腦脚腳脸臉舰艦节節苍蒼范範药藥莱萊莲蓮获獲营營萨薩葱蔥蓝藍虏虜虫蟲虽雖蛮蠻蝉蟬补補袭襲装裝见見规規视視觉覺触觸计計认認让讓训訓记記讲講许許证證诃訶试試诗詩诚誠诛誅话話诞誕诡詭该該语語说說请請诸諸诺諾谁誰调調谎謊谢謝谬謬谱譜贝貝负負败敗货貨贯貫费費贼賊贾賈赋賦赖賴赛賽赞贊赢贏赶趕跃躍践踐车車转轉轮輪轰轟轻輕辈輩输輸边邊达達过過运運还還这這进進远遠违違连連迹跡适適选選逊遜递遞遗遺酱醬释釋钟鍾钢鋼钩鉤钳鉗钻鑽铁鐵铠鎧铺鋪锈鏽锤錘锦錦镇鎮镝鏑镰鐮长長门門闪閃闲閒间間闷悶闻聞队隊阳陽阴陰阶階陨隕险險随隨隐隱雾霧静靜顶頂项項顺順须須顿頓预預领領颊頰频頻颓頹颜顏风風飞飛饭飯饶饒饼餅马馬骑騎鱼魚鱿魷鲁魯鲛鮫鲨鯊鳄鱷鳞鱗鸟鳥鸡雞鸣鳴鸦鴉鸭鴨鹅鵝鹏鵬鹤鶴鹰鷹麦麥黄黃鼹鼴齐齊齿齒龙龍';
const S2T = new Map(); for (let i = 0; i < S2T_PAIRS.length; i += 2) S2T.set(S2T_PAIRS[i], S2T_PAIRS[i + 1]);
const S2T_PHRASES = [['海盗团', '海賊團'], ['海盗', '海賊'], ['胡子', '鬍子'], ['红发', '紅髮'], ['一伙', '一行人'], ['王国', '王國'], ['骑士团', '騎士團']];
const s2tFeat = s => { let t = s; for (const [a, b] of S2T_PHRASES) t = t.split(a).join(b); return [...t].map(ch => S2T.get(ch) || ch).join(''); };
// 繁中官網的字形異體（日文漢字）→ 台灣寫法；全形英數 → 半形
const JPV = { '団': '團', '獣': '獸', '学': '學', '気': '氣', '黒': '黑', '戦': '戰', '国': '國', '悪': '惡', '竜': '龍', '桜': '櫻', '鉄': '鐵', '伝': '傳', '発': '發', '変': '變', '剣': '劍', '歯': '齒', '蔵': '藏', '処': '處', '仏': '佛', '楽': '樂', '実': '實', '広': '廣', '辺': '邊', '売': '賣', '読': '讀', '斉': '齊', '沢': '澤', '円': '圓', '両': '兩', '単': '單', '対': '對', '帰': '歸', '関': '關', '険': '險', '験': '驗', '駅': '驛', '猟': '獵', '覇': '霸', '島': '島' };
const JPV_RE = new RegExp('[' + Object.keys(JPV).join('') + ']', 'g');
const fwHalf = s => s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)).replace(/　/g, ' ');
const splitFeat = s => String(s || '').split(/[\/／,，\n]/).map(x => x.trim()).filter(Boolean);
let ALIAS = {};
try { const p = join(dirname(new URL(import.meta.url).pathname), 'feat-alias.json'); if (existsSync(p)) ALIAS = JSON.parse(readFileSync(p, 'utf8')).alias || {}; } catch (e) { LOG('feat-alias.json 讀取失敗：', e.message); }
const baseTw = f => fwHalf(f).replace(JPV_RE, ch => JPV[ch]).replace(/\s+/g, ' ').trim();
// 第一輪：收集繁中官網所有特徵（正規化字形後）的出現次數，用來決定「原／元」→「前」與別名
const twCount = new Map();
for (const no of Object.keys(TWX)) for (const f of splitFeat(TWX[no].f)) { const b = baseTw(f); twCount.set(b, (twCount.get(b) || 0) + 1); }
const twSet = new Set(twCount.keys());
const canonCache = new Map();
function canonTw(f) {
  if (canonCache.has(f)) return canonCache.get(f);
  let t = baseTw(f);
  if (ALIAS[t]) t = baseTw(ALIAS[t]);
  else if (ALIAS[f]) t = baseTw(ALIAS[f]);
  const m = t.match(/^[原元](.+)$/);
  if (m && (twSet.has('前' + m[1]) || ALIAS['前' + m[1]])) t = '前' + m[1];
  if (ALIAS[t]) t = baseTw(ALIAS[t]);
  canonCache.set(f, t); return t;
}
// 第二輪：簡中 ↔ 繁中 投票（同卡號）
const featV = new Map(), cnFeatCount = new Map();
const cnFirstF = new Map(); for (const c of cn) if (!cnFirstF.has(c.cardNumber)) cnFirstF.set(c.cardNumber, c);
for (const c of cn) for (const f of splitFeat(c.cardFeatures)) cnFeatCount.set(f, (cnFeatCount.get(f) || 0) + 1);
const pending = [];
for (const [no, w] of Object.entries(TWX)) {
  const s = cnFirstF.get(no); if (!s || !w.f) continue;
  const fa = splitFeat(s.cardFeatures), fb = splitFeat(w.f).map(canonTw);
  if (!fa.length || !fb.length) continue;
  if (fa.length === fb.length) fa.forEach((x, i) => vote(featV, x, fb[i])); else pending.push([no, fa, fb]);
}
const top = m => { const arr = [...m].sort((p, q) => q[1] - p[1]); return arr.length ? arr[0][0] : null; };
for (let round = 0; round < 2; round++) for (const [, fa, fb] of pending) { // 數量不同：扣掉已確定的配對，剩下一對一才投
  const ra = [], rb = fb.slice();
  for (const x of fa) { const t = featV.has(x) ? top(featV.get(x)) : null; const k = t != null ? rb.indexOf(t) : -1; if (k >= 0) rb.splice(k, 1); else ra.push(x); }
  if (ra.length === 1 && rb.length === 1) vote(featV, ra[0], rb[0]);
}
twFeats = {}; const featRows = [], featFallback = [], featConflicts = [];
const allCnFeats = new Set([...cnFeatCount.keys()]);
let customFeatSrc = []; try { const cp = join(dirname(OUT), 'custom.json'); if (existsSync(cp)) customFeatSrc = JSON.parse(readFileSync(cp, 'utf8')).cards || []; } catch (e) { LOG('custom.json 讀取失敗（特徵統合略過自訂卡）：', e.message); }
for (const c of customFeatSrc) if (c.textLang !== 'tw') for (const f of splitFeat(c.cardFeatures)) allCnFeats.add(f);
for (const f of allCnFeats) {
  const x = featV.get(f); let tw, how;
  if (x) { const arr = [...x].sort((p, q) => q[1] - p[1]); const tot = arr.reduce((s, v) => s + v[1], 0); tw = arr[0][0]; how = 'vote';
    featRows.push({ cn: f, tw, n: arr[0][1], total: tot, share: +(arr[0][1] / tot).toFixed(3), alts: arr.slice(1, 4).map(([k, v]) => `${k}×${v}`) });
    if (arr[0][1] / tot < 0.8 && tot >= 3) featConflicts.push(`${f} → ${tw}（${Math.round(arr[0][1] / tot * 100)}%；另有 ${arr.slice(1, 4).map(([k, v]) => `${k}×${v}`).join('、')}）`);
  } else if (ALIAS[f]) { tw = canonTw(ALIAS[f]); how = 'alias'; }
  else if (twSet.has(baseTw(f))) { tw = canonTw(f); how = 'same'; } // 簡中已是繁中官網用的寫法（W7、CP0、SMILE…）
  else { tw = canonTw(s2tFeat(f)); how = twSet.has(tw) ? 's2t→既有' : 's2t'; featFallback.push({ cn: f, tw, how, n: cnFeatCount.get(f) || 0 }); }
  if (tw && tw !== f) twFeats[f] = tw;
}
// 繁中官網異體寫法／日文 → 統一名稱（網站用來正規化繁中卡與補卡的特徵）
let twFeatAlias = {};
for (const no of Object.keys(TWX)) for (const f of splitFeat(TWX[no].f)) { const t = canonTw(f); if (t !== f) twFeatAlias[f] = t; }
for (const [a, b] of Object.entries(ALIAS)) { const t = canonTw(b); if (t !== a && !allCnFeats.has(a)) twFeatAlias[a] = t; }
const canonSet = new Set([...twSet].map(canonTw).concat(Object.values(twFeats)));
const featVariants = Object.entries(twFeatAlias).filter(([a]) => twCount.has(baseTw(a)) || twCount.has(a)).map(([a, b]) => `${a} → ${b}`);
if (!terms) { // 這次沒抓繁中官網：沿用上次 terms.json 的關鍵字／系列比對，只重算特徵區
  try { const tp = join(dirname(OUT), 'terms.json'); if (existsSync(tp)) { const t0 = JSON.parse(readFileSync(tp, 'utf8')); terms = { generatedAt: t0.generatedAt, note: t0.note, keywords: t0.keywords || [], sets: t0.sets || [], conflicts: (t0.conflicts || []).filter(s => !/^\[特徵\]/.test(s)) }; } } catch (e) { /* 沒有就算了 */ }
  if (!terms) terms = { generatedAt: now, keywords: [], sets: [], conflicts: [] };
}
Object.assign(terms, { featuresGeneratedAt: now, features: featRows.sort((p, q) => q.total - p.total), featureFallback: featFallback, featureVariants: featVariants, featureConflicts: featConflicts, featureCount: canonSet.size });
terms.conflicts = [...(terms.conflicts || []), ...featConflicts.map(s => '[特徵] ' + s)];
LOG(`繁中全文 ${Object.keys(TWX).length} 張、系列對照 ${Object.keys(twSets).length}、特徵對照 ${Object.keys(twFeats).length}（投票 ${featRows.length}、字形轉換 ${featFallback.length}）、統一後特徵 ${canonSet.size} 種、繁中異體 ${featVariants.length}、特徵待確認 ${featConflicts.length}`);
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

const out = { source: 'merged', fetchedAt: now, count: cards.length, sources, stats: { cardNumbers: nos.size, byLang, newCards: newNos.length, newSets, upgradedToCn: upgraded, removed: goneNos.length, textFilled: [...new Set(textFilled)], twText: Object.keys(TWX).length, termConflicts: terms ? terms.conflicts.length : null, features: { unified: canonSet.size, mapped: Object.keys(twFeats).length, fallback: featFallback.length, variants: featVariants.length, conflicts: featConflicts.length } }, cards, tw: TWX, twSets, twFeats, twFeatAlias };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const summary = { ranAt: now, ok: true, changed: JSON.stringify(prevCards) !== JSON.stringify(cards) || JSON.stringify(prev?.tw || {}) !== JSON.stringify(TWX) || JSON.stringify(prev?.twFeats || {}) !== JSON.stringify(twFeats) || JSON.stringify(prev?.twFeatAlias || {}) !== JSON.stringify(twFeatAlias), sources, stats: out.stats, newCards: newNos.slice(0, 300), removedCards: goneNos.slice(0, 100), commitMessage };
if (terms) writeFileSync(join(dirname(OUT), 'terms.json'), JSON.stringify(terms, null, 1));
mkdirSync(dirname(SUMMARY), { recursive: true });
writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));

const md = [`### 卡片資料更新 ${stamp}`, '', `| 來源 | 狀態 | 筆數 | 說明 |`, `|---|---|---|---|`,
  ...['cn', 'tw', 'jp'].map(k => `| ${SRC[k].label} | ${sources[k].status} | ${sources[k].count ?? '-'}${sources[k].fill != null ? `（補 ${sources[k].fill}）` : ''} | ${sources[k].note || sources[k].error || ''} |`),
  '', `- 合併後 ${nos.size} 張卡（${cards.length} 個印刷）：簡中 ${byLang.cn}、補繁中 ${byLang.tw}、補日文 ${byLang.jp}`,
  `- 新增 ${newNos.length} 張${newSets.length ? '：' + newSets.join('、') : ''}`, `- 原本靠補卡、現在簡中已收錄：${upgraded} 張；移除：${goneNos.length} 張`].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', { flag: 'a' });
LOG('完成：', commitMessage);
