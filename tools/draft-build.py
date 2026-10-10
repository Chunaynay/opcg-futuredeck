#!/usr/bin/env python3
"""把 read.jsonl（Claude 讀圖結果，繁中）＋ crop2/（裁好的卡圖）整理成編輯器要的 _inbox/drafts.json 與 _inbox/_drafts/*.jpg
v2（2026-10-09）：文字直接寫繁中官方用語＋textLang:'tw'，不再轉簡中；特徵用 cards.json 的統一繁中；不乾淨的卡圖給原圖讓編輯器旋轉裁切。
用法：python3 draft-build.py  （工作目錄要有 cards.json、custom.json、custom-editor.html、read.jsonl、crop2/）"""
import json, re, os, shutil, datetime, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tw_text import s2t, textTw, featTw, featsTw, nameTw, TWN, normName
cards = json.load(open('cards.json', encoding='utf-8'))['cards']
custom = json.load(open('custom.json', encoding='utf-8'))['cards']
OFF = {c['cardNumber'] for c in cards}
HAVE = {c['cardNumber'] for c in custom}
d = json.load(open('cards.json', encoding='utf-8'))
FEATS = set(d['twFeats'].values()) | set(d['twFeatAlias'].values()) | {featTw(f) for v in d['tw'].values() for f in re.split(r'[/／,，\n]', v.get('f') or '') if f.strip()}
FEATS |= {f for c in custom for f in (c.get('cardFeatures') or '').split('/') if f}
COLOR = {'紅': '红', '綠': '绿', '藍': '蓝', '紫': '紫', '黑': '黑', '黃': '黄', '红': '红', '绿': '绿', '蓝': '蓝', '黄': '黄'}
TYPE = {'領袖': '领袖', '角色': '角色', '事件': '事件', '舞台': '舞台', '领袖': '领袖'}
ATTR = {'打': '打', '斬': '斩', '射': '射', '特': '特', '智': '智', '斩': '斩', '知': '智'}
CROPLOG = json.load(open('crop2/_log.json', encoding='utf-8')) if os.path.exists('crop2/_log.json') else {}

rows = [json.loads(l) for l in open('read.jsonl', encoding='utf-8') if l.strip()]
out, skipped, seen = [], [], set()
os.makedirs('_drafts', exist_ok=True)
for r in rows:
    no = r.get('no') or ''
    no = no if re.fullmatch(r'[A-Z]{1,6}\d{0,2}-\d{3}', no) else ''
    why = None
    if r.get('skip'): why = r.get('note', '略過')
    elif no and no in OFF: why = '官方已有'
    elif no and no in HAVE: why = '自訂卡已有'
    elif no and no in seen: why = '重複'
    if why: skipped.append(f"{r['f']} {r.get('no','')}：{why}"); continue
    if no: seen.add(no)
    feats = [featTw(f) for f in re.split(r'[/／,，]', r.get('feat') or '') if f.strip()]
    feats = [f for i, f in enumerate(feats) if f and f not in feats[:i]]
    rv = list(r.get('rv') or [])
    newf = [f for f in feats if f not in FEATS]
    if not no and 'cardNumber' not in rv: rv.append('cardNumber')
    typ = TYPE[r['type']]
    ctr = str(r.get('ctr') or '')
    code = (no or r['f'].split('_')[0].upper())
    m = re.match(r'^([A-Z]+)(\d+)', code); setcode = f"{m.group(1)}-{m.group(2)}"
    folder = r['f'].split('_')[0]
    SRC = {}
    if os.path.exists('new_list.json'):
        for fo, n, b in json.load(open('new_list.json', encoding='utf-8')): SRC[f'{fo}_{n}'] = f'{fo}/{b}'
    img = f"_drafts/{no or r['f']}.jpg"
    if os.path.exists(f"crop2/{r['f']}.jpg"): shutil.copy(f"crop2/{r['f']}.jpg", img)
    clean = CROPLOG.get(r['f'], {}).get('clean', True)
    note = (r.get('note') or '')
    if not clean:
        note += ('；' if note else '') + '卡圖偵測不到乾淨卡面，給的是原圖右半：按「調整卡圖」旋轉／放大到卡面再存'
        if 'cardImg' not in rv: rv.append('cardImg')
    if newf: note += ('；' if note else '') + '新特徵：' + '、'.join(newf)
    name = r['name'].strip()
    name = TWN.get(normName(name), name)
    text = textTw(r.get('text') or ''); trig = textTw(r.get('trig') or '')
    card = {
        'cardNumber': no, 'cardName': name, 'cardType': typ,
        'cardColor': '/'.join(COLOR[c] for c in r['color'].split('/')),
        'cardLife': str(r['cost']), 'cardPower': '-' if typ in ('事件', '舞台') else str(r['power']),
        'cardAttack': ('反击+' + ctr) if ctr in ('1000', '2000') else '-',
        'cardAttribute': [ATTR[a] for a in r.get('attr') or []],
        'cardFeatures': '/'.join(feats),
        'cardTextDesc': text, 'cardTrigger': trig,
        'cardRarity': r.get('rar') or '', 'cardOfferType': f'{setcode}【{setcode}】',
        'subscript': str(r.get('sub') or ''), 'mixedColor': 1 if '/' in r['color'] else 0, 'cardImg': '', 'textLang': 'tw',
        '_img': img, '_src': SRC.get(r['f'], f"{folder}/{r['f']}"), '_review': rv, '_note': note,
    }
    out.append(card)
out.sort(key=lambda c: c['cardNumber'] or '~')
skipped.sort()
now = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds')
json.dump({'_readme': 'Claude 讀 _inbox 情報圖產生的草稿（繁中官方用語，textLang:tw）。編輯器「匯入草稿」會把 cards 匯成未儲存的新卡；_review 的欄位顯示黃框、_img 是裁好的卡圖、底線欄位不會寫進 custom.json。',
           'createdAt': now, 'skipped': skipped, 'cards': out}, open('drafts.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(len(out), 'cards;', len(skipped), 'skipped')
for s in skipped: print('  -', s)
print('review:', sum(1 for c in out if c['_review']))
for c in out: print('  ', c['cardNumber'] or c['_src'], c['cardName'], c['_review'], c['_note'][:60])
