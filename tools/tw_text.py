"""自訂卡文字 → 繁中官方用語（與 tools/custom-editor.html v1.5 的 s2t／featTw／nameTw 同一套規則）"""
import json,re,os
from opencc import OpenCC
_cc=OpenCC('s2tw')
HERE=os.path.dirname(os.path.abspath(__file__))
D=json.load(open(os.path.join(HERE,'cards.json'),encoding='utf-8'))
TW=D['tw'];TWF=D['twFeats'];TWA=D['twFeatAlias']
_src=open(os.path.join(HERE,'custom-editor.html'),encoding='utf-8').read()
TAG=json.loads(re.search(r'const TAG_TW=(\{.*?\});',_src).group(1))
TERM=json.loads(re.search(r'const TERM_TW=(\[.*?\]);',_src).group(1))
JPV={'団':'團','獣':'獸','学':'學','気':'氣','黒':'黑','戦':'戰','国':'國','悪':'惡','竜':'龍','桜':'櫻','鉄':'鐵','伝':'傳','発':'發','変':'變','剣':'劍','歯':'齒','蔵':'藏','処':'處','仏':'佛','楽':'樂','実':'實','広':'廣','辺':'邊','売':'賣','読':'讀','斉':'齊','沢':'澤','円':'圓','両':'兩','単':'單','対':'對','帰':'歸','関':'關','険':'險','験':'驗','猟':'獵','覇':'霸'}
PH=[('海盗团','海賊團'),('海盗','海賊'),('胡子','鬍子'),('红发','紅髮'),('一伙','一行人'),('王国','王國'),('骑士团','騎士團')]
def base(f):
    f=re.sub(r'[Ａ-Ｚａ-ｚ０-９]',lambda m:chr(ord(m.group(0))-0xFEE0),str(f)).replace('　',' ')
    return re.sub(r'\s+',' ',''.join(JPV.get(c,c) for c in f)).strip()
def s2t(s,terms=True):
    s=str(s or '')
    for a,b in PH:s=s.replace(a,b)
    s=_cc.convert(s).replace('回閤','回合').replace('特徴','特徵')
    s=re.sub(r'[Ａ-Ｚａ-ｚ０-９]',lambda m:chr(ord(m.group(0))-0xFEE0),s).replace('咚！！','咚‼').replace('咚!!','咚‼')
    s=re.sub(r'【[^】]{1,12}】',lambda m:TAG.get(m.group(0),TAG.get(m.group(0).replace(' ',''),m.group(0))),s)
    if terms:
        for a,b in TERM:s=re.sub(a,b,s)
    return s
def featTw(f):
    f=str(f or '').strip()
    if not f:return ''
    b=base(f);m=TWF.get(f) or TWF.get(b) or TWA.get(f) or TWA.get(b)
    if m:return base(TWA.get(m,m))
    t=base(s2t(b,False));return base(TWA.get(t,t))
def featsTw(s):
    out=[]
    for f in re.split(r'[/／,，]',str(s or '')):
        t=featTw(f)
        if t and t not in out:out.append(t)
    return '/'.join(out)
_alt=lambda n:re.sub(r'[（(](異圖卡|异画|异图卡|異畫)[)）]','',n).strip()
normName=lambda n:re.sub(r'\s*[·．•・]\s*','・',str(n or '').strip())
NAME={}
for c in D['cards']:
    if not c.get('cardName'):continue
    w=TW.get(c['cardNumber']);tn=(w and w.get('n')) or c.get('cardNameTw')
    if tn:
        tn=_alt(tn);cn=_alt(c['cardName'])
        for k in (normName(cn),normName(s2t(cn,False))):
            if k not in NAME or len(tn)<len(NAME[k]):NAME[k]=tn
TWNAMES={_alt(v.get('n','')) for v in TW.values()}|{_alt(c['cardNameTw']) for c in D['cards'] if c.get('cardNameTw')}
TWN={normName(n):n for n in TWNAMES if n}
def nameTw(n):
    n=str(n or '').strip()
    k=normName(n)
    r=NAME.get(k) or NAME.get(normName(s2t(k,False)))
    if r:return r
    t=s2t(n,False);return TWN.get(normName(t),t)
def fixNames(s):
    s=re.sub(r'「([^」]+)」',lambda m:'「'+(NAME.get(normName(m.group(1))) or NAME.get(normName(s2t(m.group(1),False))) or m.group(1))+'」',s)
    return re.sub(r'[《<]([^》>]+)[》>]',lambda m:'《'+(featTw(m.group(1)) or m.group(1))+'》',s)
def textTw(s):return fixNames(s2t(s))
