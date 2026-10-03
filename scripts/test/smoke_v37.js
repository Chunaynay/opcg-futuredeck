// v3.7 煙霧測試（自訂卡合併／文字卡面、PR卡歸類、選擇器、已套用篩選列、牌組縮圖／清單、☰ 選單、--topH／--deckW）
// 用法：npm i jsdom canvas 後  node scripts/test/smoke_v37.js site/index.html   （31 項全 PASS 才算過）
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2]||'site/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',beforeParse(w){
  w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  w.fetch=async(u)=>({ok:false,status:404,headers:{get(){return null}},json:async()=>({}),blob:async()=>null});
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
}});
const w=dom.window;let errs=0;
w.addEventListener('error',e=>{console.log('ERR',e.message);errs++;});
const ok=(name,cond)=>{console.log((cond?'PASS':'FAIL')+'  '+name);if(!cond)errs++;};
setTimeout(()=>{
 try{
  const mk=(no,name,type,color,life,pw,atk,txt,set,feat)=>({id:1,cardNumber:no,cardName:name,cardType:type,cardRarity:'C',cardOfferType:set||'补充包 测试【OP-01】',cardLife:life,cardAttribute:['特'],cardColor:color,cardPower:pw,cardAttack:atk,cardFeatures:feat||'A/B',cardTextDesc:txt,cardTrigger:'',subscript:5,mixedColor:0,cardImg:'https://source.windoent.com/OnePiecePc/Picture/x.png',displayId:1,cardCartograph:''});
  const cards=[
    mk('OP01-001','L1','领袖','黄/绿','5','5000','-',''),
    mk('OP01-002','C1','角色','黄','3','4000','反击+1000','【阻挡者】'),
    mk('OP01-002','C1','角色','黄','3','4000','反击+1000','【阻挡者】'),
    mk('OP01-003','C2','角色','黑','3','4000','-','x'),
    mk('OP01-004','E1','事件','绿','1','-','-','y'),
    mk('P-001','PR1','角色','黄','2','3000','1000','z','宣传卡','C'),
    mk('P-002','PR2','角色','绿','2','3000','1000','z','锦标赛2024','C'),
  ];
  w.eval(`RAW=${JSON.stringify({fetchedAt:'2026-10-01',cards})};BCUSTOM=${JSON.stringify({updatedAt:'2026-10-03',cards:[
    {cardNumber:'OP18-001',cardName:'自訂領袖',cardType:'领袖',cardColor:'黄',cardLife:'5',cardPower:'5000',cardAttack:'-',cardAttribute:['打'],cardFeatures:'草帽一伙',cardTextDesc:'測試效果',cardTrigger:'',cardRarity:'L',cardOfferType:'补充包 未来【OP-18】',subscript:'',mixedColor:0,cardImg:'custom/OP18-001.jpg'},
    {cardNumber:'OP18-002',cardName:'自訂角色',cardType:'角色',cardColor:'黄',cardLife:'4',cardPower:'6000',cardAttack:'反击+1000',cardAttribute:['斩'],cardFeatures:'草帽一伙',cardTextDesc:'【阻挡者】',cardTrigger:'',cardRarity:'',cardOfferType:'OP-18 預覽',subscript:'',mixedColor:0,cardImg:''}
  ]})};buildIndex();applyFilters();renderDeck();`);
  const d=w.document;
  console.log('status:',d.querySelector('#dbStatus').textContent);
  ok('BYNO 含自訂卡',w.eval(`BYNO.has('OP18-002')&&BYNO.get('OP18-002').custom===true`));
  ok('無圖自訂卡自動產生卡面',w.eval(`BYNO.get('OP18-002').img.startsWith('data:image/jpeg')`));
  ok('有圖自訂卡用相對路徑',w.eval(`BYNO.get('OP18-001').img==='custom/OP18-001.jpg'`));
  // 系列選單
  const setOpts=[...d.querySelectorAll('#fSet option')].map(o=>[o.value,o.textContent]);
  console.log('fSet options:',JSON.stringify(setOpts));
  ok('系列：有【】的各一項、無【】的合併成 PR卡',setOpts.some(o=>o[0]==='__PR__')&&!setOpts.some(o=>o[0]==='宣传卡')&&setOpts.some(o=>o[0]==='补充包 测试【OP-01】'));
  ok('系列：自訂卡的系列另列並標示',setOpts.some(o=>o[0]==='OP-18 預覽'&&o[1].includes('自訂卡')));
  // 先選領袖模式：沒領袖時只列領袖
  ok('先選領袖：只列領袖卡',w.eval(`view.every(c=>c.type==='领袖')&&view.length===2`));
  d.querySelector('#leaderFirst').checked=false;w.eval('applyFilters()');
  ok('關閉先選領袖後全部可見',w.eval('view.length')===8);
  // PR 篩選
  w.eval(`$('#fSet').value='__PR__';$('#fSet').dispatchEvent(new Event('change'));`);
  ok('PR卡篩選只剩無【】的官方卡',w.eval(`view.length===2&&view.every(c=>/^P-/.test(c.no))`));
  ok('選擇器按鈕顯示 PR卡',d.querySelector('.pick[data-pick=fSet]').classList.contains('on')&&d.querySelector('.pick[data-pick=fSet] .v').textContent.startsWith('PR卡'));
  ok('已套用篩選列顯示系列',d.querySelector('#activeF').textContent.includes('系列')&&d.querySelector('#activeF').textContent.includes('PR卡'));
  ok('手機篩選分頁數字',d.querySelector('#tabFilterBd').textContent==='1');
  // 用篩選列的 ✕ 清除
  d.querySelector('#activeF [data-clr=set]').click();
  ok('✕ 清除系列篩選',w.eval(`F.set===''&&view.length===8`)&&!d.querySelector('.pick[data-pick=fSet]').classList.contains('on')&&d.querySelector('#activeF').textContent==='');
  // 選擇器：開啟、搜尋、選取
  w.eval(`openPick('fFeat')`);
  ok('選擇器開啟並列出特徵',d.querySelector('#pickDlg').open&&d.querySelectorAll('#pkList button').length>=3);
  d.querySelector('#pkQ').value='草帽';w.eval('renderPickList()');
  const pkBtns=[...d.querySelectorAll('#pkList button[data-v]')];
  ok('搜尋後只剩「全部」＋草帽一伙',pkBtns.length===2&&pkBtns[1].dataset.v==='草帽一伙');
  pkBtns[1].click();
  ok('選到特徵後套用',w.eval(`F.feat==='草帽一伙'&&view.length===2`)&&d.querySelector('.pick[data-pick=fFeat] .v').textContent.startsWith('草帽一伙'));
  d.querySelector('.pick[data-pick=fFeat] .x').dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
  ok('選擇器 ✕ 清除',w.eval(`F.feat===''`));
  // 多個篩選 + 全部清除
  w.eval(`F.q='C';$('#q').value='C';$('#fTrigger').checked=false;document.querySelector('#fColor .chip[data-v="黄"]').click();applyFilters();`);
  ok('已套用篩選列有兩項與全部清除',d.querySelectorAll('#activeF .af').length===2&&!!d.querySelector('#activeF .afClear'));
  d.querySelector('#activeF .afClear').click();
  ok('全部清除',w.eval(`F.q===''&&F.colors.size===0`)&&d.querySelectorAll('#activeF .af').length===0&&d.querySelectorAll('.chip.on').length===0);
  // 牌組
  w.eval(`setLeader('OP01-001');addCard('OP01-002');addCard('OP01-002');addCard('OP01-002');addCard('OP01-002');addCard('OP01-002');addCard('OP01-004');addCard('OP18-002');`);
  console.log('count:',d.querySelector('#mainCount').textContent);
  ok('4 張上限',w.eval(`deck.main['OP01-002']===4`));
  ok('牌組縮圖模式',w.eval(`deckMode()==='thumbs'`)&&d.querySelectorAll('#dlist .dt').length===3&&d.querySelector('#dlist .dt[data-no="OP01-002"] .dn').textContent==='×4');
  ok('縮圖依類型分組',[...d.querySelectorAll('#dlist .dgroup span:first-child')].map(x=>x.textContent).join(',')==='角色,事件');
  ok('牌組分頁數字',d.querySelector('#tabDeckBd').textContent==='6');
  d.querySelector('#dlist .dt[data-no="OP01-004"] button[data-sub]').click();
  ok('縮圖 − 按鈕',w.eval(`!deck.main['OP01-004']`));
  d.querySelector('#dlMode').click();
  ok('切換清單模式',w.eval(`deckMode()==='list'`)&&d.querySelectorAll('#dlist .drow').length===2&&d.querySelector('#dlMode').textContent.includes('縮圖'));
  d.querySelector('#dlMode').click();
  ok('切回縮圖',w.eval(`deckMode()==='thumbs'`)&&d.querySelectorAll('#dlist .dt').length===2);
  console.log('issues:',d.querySelector('#issues').textContent);
  console.log(w.eval('deckToText()'));
  w.eval(`deck=textToDeck("領袖 OP01-001\\n4x OP01-002\\nOP01-003 x2\\n2x OP18-002");afterChange();`);
  console.log('issues2:',d.querySelector('#issues').textContent);
  w.eval(`openCard('OP18-002')`);
  ok('自訂卡視窗',d.querySelector('#cdTitle').textContent==='自訂角色'&&d.querySelector('#cdBody').textContent.includes('網站內建'));
  w.eval(`openCard('OP01-002')`);console.log('dlg:',d.querySelector('#cdTitle').textContent,d.querySelector('#cdN').textContent);
  console.log('stats:',d.querySelector('#stats').textContent.slice(0,120));
  // 手機選單
  d.querySelector('#btnMenu').click();
  ok('選單開啟含狀態',d.querySelector('#menuDlg').open&&d.querySelector('#menuStat').textContent.includes('主牌組'));
  let opened=false;d.querySelector('#btnDeckText').addEventListener('click',()=>opened=true);
  d.querySelector('#menuDlg [data-act=btnDeckText]').click();
  setTimeout(()=>{ok('選單項目轉發到原按鈕',opened&&!d.querySelector('#menuDlg').open);
    ok('t2s',w.eval(`t2s('克洛克達爾 羅賓')`)==='克洛克达尔 罗宾');
    ok('--topH 已設定',/px$/.test(d.documentElement.style.getPropertyValue('--topH')));
    ok('牌組寬度變數',/px$/.test(d.querySelector('.layout').style.getPropertyValue('--deckW')));
    console.log(errs?`\n${errs} 個問題`:'\n全部通過');process.exit(errs?1:0);},80);
 }catch(e){console.log('EXC',e.stack);process.exit(1);}
},400);
