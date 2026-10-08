// v4.0 煙霧測試：繁中文字（tw／twSets／twFeats）、「簡」「日」標、簡中卡圖優先、搜尋（繁／簡／日）、卡片視窗來源行、舊資料相容
// 用法：node --import ./scripts/test/mock-fetch.mjs scripts/fetch-cards.mjs --out /tmp/m.json --prev scripts/test/fixtures/prev_cards.json --summary /tmp/l.json
//       node scripts/test/smoke_v40_text.js site/index.html /tmp/m.json      （需要 jsdom）
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const merged=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.test/',beforeParse(w){w.IntersectionObserver=class{observe(){}};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=async()=>({ok:false,status:404,headers:{get(){return null}}});}});
const w=dom.window;let fails=0;
const ok=(cond,msg)=>{console.log((cond?'PASS ':'FAIL ')+msg);if(!cond)fails++;};
w.addEventListener('error',e=>{console.log('ERR',e.message);fails++;});
setTimeout(()=>{
 try{
  ok(/^v4\.[1-9]/.test(w.eval('APP_VERSION')),'版號 v4.1+');
  // 模擬自動比對結果：系列名與特徵對照
  merged.twSets=Object.assign({'补充包 继承的意志【OPC-13】':'補充包 繼承的意志【OP-13】'},merged.twSets);
  merged.twFeats=Object.assign({},merged.twFeats,{'草帽一伙':'草帽海賊團'}); // 測試用：故意覆蓋成另一個名稱，確認篩選走 twFeats
  // EB04-061 沒有繁中 → 保留簡中原文；給它一個特徵測試篩選對照
  merged.cards.forEach(c=>{if(c.cardNumber==='EB04-061')c.cardFeatures='草帽一伙';});
  w.eval(`RAW=${JSON.stringify({fetchedAt:merged.fetchedAt,source:'bundled',cards:merged.cards,sources:merged.sources,stats:merged.stats,tw:merged.tw,twSets:merged.twSets,twFeats:merged.twFeats})};buildIndex();$('#leaderFirst').checked=false;applyFilters();renderDeck();`);
  const st=w.document.querySelector('#dbStatus').textContent;console.log('status:',st);
  ok(/簡中原文 1/.test(st)&&/日文原文 2/.test(st),'dbStatus 顯示簡中原文／日文原文張數');
  const sab=w.eval(`(()=>{const c=BYNO.get('OP13-004');return {n:c.name,t:c.text,tl:c.tl,f:c.feats.join('/'),set:c.set,cn:c.cn&&c.cn.name,alt:c.alt}})()`);console.log('OP13-004',JSON.stringify(sab));
  ok(sab.n==='薩波'&&sab.tl==='tw'&&/生命值卡/.test(sab.t),'有繁中的簡中卡：卡名、效果改繁中');
  ok(sab.f==='多雷斯羅薩/革命軍','特徵改繁中');
  ok(sab.set==='補充包 繼承的意志【OP-13】','系列名經 twSets 改繁中');
  ok(sab.cn==='萨波'&&sab.alt.includes('萨波')&&!sab.alt.includes('薩波'),'簡中卡名留在 cn 與別名，不重複');
  const lf=w.eval(`(()=>{const c=BYNO.get('EB04-061');return {n:c.name,tl:c.tl,f:c.feats.join(),fk:c.fk.join()}})()`);
  ok(lf.n==='蒙奇·D·路飞'&&lf.tl==='cn','沒有繁中的卡保留簡中原文');
  ok(lf.f==='草帽海賊團'&&lf.fk==='草帽海賊團','簡中原文卡：特徵顯示與篩選都用統一後的繁中（v4.1）');
  ok(w.eval(`[...$('#fFeat').options].some(o=>o.value==='草帽海賊團')&&![...$('#fFeat').options].some(o=>o.value==='草帽一伙')`),'特徵選單只列繁中');
  w.eval(`F.feat='草帽海賊團';applyFilters();`);ok(w.eval('view.some(c=>c.no==="EB04-061")'),'繁中特徵篩得到簡中原文卡');w.eval(`F.feat='';applyFilters();`);
  // 標記
  const tile=no=>[...w.document.querySelectorAll('.tile')].find(t=>t.dataset.no===no);
  ok(tile('EB04-061')&&tile('EB04-061').querySelector('.lang')?.textContent==='簡','簡中原文卡有「簡」標');
  ok(tile('OP13-004')&&!tile('OP13-004').querySelector('.lang'),'繁中文字卡沒有標');
  ok(tile('OP17-001')&&!tile('OP17-001').querySelector('.lang'),'繁中補卡沒有標');
  ok(tile('OP18-002')&&tile('OP18-002').querySelector('.lang')?.textContent==='日','日版補卡有「日」標');
  // 搜尋：繁、簡、日
  const q=s=>{w.eval(`F.q=${JSON.stringify(s)};applyFilters();`);return w.eval('view.map(c=>c.no)');};
  ok(q('薩波').includes('OP13-004'),'繁中卡名搜得到');
  ok(q('萨波').includes('OP13-004'),'簡中卡名搜得到');
  ok(q('生命值卡').includes('OP13-004'),'繁中效果文搜得到');
  ok(q('ニューゲート').includes('OP17-001'),'日文別名搜得到');
  q('');
  // 卡圖：簡中優先
  w.eval('PROXY_OK=true');
  ok(w.eval(`imgCands(BYNO.get('OP13-004'),'','thumb').map(x=>x.tag).join()`)==='cnp,cn,tw,jp','簡中卡：cnp→cn→tw→jp');
  ok(w.eval(`imgCands(BYNO.get('OP18-001'),'','thumb').map(x=>x.tag).join()`)==='tw,jp','繁中補卡：tw→jp');
  w.eval('PROXY_OK=false');
  ok(w.eval(`imgCands(BYNO.get('OP13-004'),'','canvas').map(x=>x.tag).join()`)==='cn','沒代理時 canvas 只用簡中 CDN');
  // 卡片視窗
  w.eval(`openCard('OP13-004')`);let b=w.document.querySelector('#cdBody');
  ok(/文字：繁中官網/.test(b.textContent)&&/卡圖：簡中官網/.test(b.textContent),'卡片視窗：文字繁中、卡圖簡中');
  ok(!!b.querySelector('details.cnOrig')&&/萨波/.test(b.querySelector('details.cnOrig').textContent),'卡片視窗有「簡中原文」');
  w.eval(`openCard('EB04-061')`);b=w.document.querySelector('#cdBody');
  ok(/繁中官網尚未收錄，顯示簡中原文/.test(b.textContent)&&!b.querySelector('details.cnOrig'),'簡中原文卡說明來源、沒有重複的原文區');
  w.eval(`openCard('OP17-019')`);ok(/【觸發器】自己的領航卡/.test(w.document.querySelector('#cdBody').textContent),'繁中觸發標籤【觸發器】且不重複前綴');
  // 牌表文字用繁中卡名
  w.eval(`setLeader('OP18-001');addCard('OP13-004');`);ok(/OP13-004 薩波/.test(w.eval('deckToText()')),'牌表文字用繁中卡名');
  // 舊資料（沒有 tw）：全部當簡中原文，不會壞
  w.eval(`RAW={fetchedAt:'2026-10-01',source:'manual',cards:RAW.cards};buildIndex();applyFilters();`);
  ok(w.eval(`BYNO.get('OP13-004').name`)==='萨波'&&w.eval(`BYNO.get('OP13-004').tl`)==='cn','沒有繁中資料時退回簡中');
 }catch(e){console.log('EXC',e.stack);fails++;}
 console.log(fails?`\n${fails} 項失敗`:'\n全部通過');process.exit(fails?1:0);
},300);
