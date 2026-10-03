// v3.7 煙霧測試：合併資料（lang／alt／sources）、搜尋別名、來源標示、卡圖候選
// 用法：先用 mock-fetch 產出合併 cards.json，再  node scripts/test/smoke_v37.js site/index.html <merged cards.json>
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const merged=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://example.test/',beforeParse(w){w.IntersectionObserver=class{observe(){}};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.fetch=async()=>({ok:false,status:404,headers:{get(){return null}}});}});
const w=dom.window;let fails=0;
const ok=(cond,msg)=>{console.log((cond?'PASS ':'FAIL ')+msg);if(!cond)fails++;};
w.addEventListener('error',e=>{console.log('ERR',e.message);fails++;});
setTimeout(()=>{
 try{
  w.eval(`RAW={fetchedAt:${JSON.stringify(merged.fetchedAt)},source:'bundled',cards:${JSON.stringify(merged.cards)},sources:${JSON.stringify(merged.sources)},stats:${JSON.stringify(merged.stats)}};buildIndex();applyFilters();renderDeck();`);
  const st=w.document.querySelector('#dbStatus').textContent;console.log('status:',st);
  ok(/補繁中 4/.test(st)&&/補日文 2/.test(st),'dbStatus 顯示補卡數');
  ok(/自動更新/.test(w.document.querySelector('#dataDate').textContent),'dataDate 顯示「自動更新」');
  ok(/簡中 正常/.test(w.eval('sourcesText()')),'sourcesText 有來源摘要');
  // 搜尋別名：日文名找到繁中補卡、繁中名找到簡中卡
  w.eval(`$('#leaderFirst').checked=false;F.q='ニューゲート';applyFilters();`);ok(w.eval('view.map(c=>c.no).includes("OP17-001")'),'日文別名搜到 OP17-001（繁中補卡）');
  w.eval(`F.q='薩波';applyFilters();`);ok(w.eval('view.map(c=>c.no).includes("OP13-004")'),'繁中別名搜到 OP13-004（簡中卡）');
  w.eval(`F.q='日版のみ';applyFilters();`);ok(w.eval('view.length===1&&view[0].lang==="jp"'),'日文卡名搜到日版補卡');
  w.eval(`F.q='';applyFilters();`);
  // 卡片格標示
  const tileJp=[...w.document.querySelectorAll('.tile')].find(t=>t.dataset.no==='OP18-002');
  ok(tileJp&&tileJp.querySelector('.lang')&&tileJp.querySelector('.lang').textContent==='日','日版補卡的卡片格有「日」標');
  const tileCn=[...w.document.querySelectorAll('.tile')].find(t=>t.dataset.no==='OP13-004');
  ok(tileCn&&!tileCn.querySelector('.lang'),'簡中卡沒有語言標');
  // 卡圖候選
  w.eval('PROXY_OK=true');
  const twC=w.eval(`imgCands(BYNO.get('OP18-001'),'','thumb').map(x=>x.tag+':'+x.url)`);console.log('tw cands',twC);
  ok(twC[0]==='tw:/twimg/OP18-001.png'&&twC[1]==='jp:/jpimg/OP18-001.png','繁中補卡：代理 tw→jp');
  const cnC=w.eval(`imgCands(BYNO.get('OP13-004'),'','canvas').map(x=>x.tag)`);console.log('cn cands',cnC);
  ok(cnC.join()==='tw,jp,cnp,cn','簡中卡：tw→jp→cnp→cn');
  w.eval('PROXY_OK=false');
  ok(w.eval(`imgCands(BYNO.get('OP18-002'),'','canvas').length`)===0,'沒代理時日版補卡不進 canvas');
  ok(w.eval(`imgCands(BYNO.get('OP18-002'),'','thumb')[0].url`)==='https://www.onepiece-cardgame.com/images/cardlist/card/OP18-002.png','沒代理時日版補卡直連官網');
  w.eval(`noteMiss('jp','OP18-002')`);ok(w.eval(`imgCands(BYNO.get('OP18-002'),'','thumb').map(x=>x.tag).join()`)==='tw','jp 404 後只剩 tw 備援');
  // 卡片視窗來源行
  w.eval(`openCard('OP18-002')`);ok(/資料來源：日版官網/.test(w.document.querySelector('#cdBody').textContent),'卡片視窗顯示日版來源');
  w.eval(`openCard('OP13-004')`);const body=w.document.querySelector('#cdBody').textContent;ok(/資料來源：簡中官網/.test(body)&&/其他語言卡名：薩波/.test(body),'簡中卡顯示其他語言卡名');
  // 合法性：日版補卡加入牌組照常
  w.eval(`setLeader('OP18-001');addCard('OP18-002');`);ok(w.eval('deck.main["OP18-002"]===1'),'補卡可加入牌組');
  // 舊格式（無 lang）仍相容
  w.eval(`RAW={fetchedAt:'2026-10-01',source:'manual',cards:RAW.cards.map(c=>{const o={...c};delete o.lang;delete o.cardNameTw;delete o.cardNameJp;return o;})};buildIndex();applyFilters();`);
  ok(!/補/.test(w.document.querySelector('#dbStatus').textContent)&&!w.document.querySelector('.tile .lang'),'舊版單源 JSON：無補卡標示');
 }catch(e){console.log('EXC',e.stack);fails++;}
 console.log(fails?`\n${fails} 項失敗`:'\n全部通過');process.exit(fails?1:0);
},300);
