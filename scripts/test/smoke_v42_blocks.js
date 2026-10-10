// v4.2 煙霧測試：區塊圖示多選晶片（沒選＝全部；可選多顆；0／空＝「無」；✕／全部清除；buildIndex 重建保留已選）
// 用法：npm i jsdom 後  node scripts/test/smoke_v42_blocks.js site/index.html
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2]||'site/index.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',beforeParse(w){
  w.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'))};
  w.fetch=async()=>({ok:false,status:404,headers:{get(){return null}},json:async()=>({}),blob:async()=>null});
  w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
}});
const w=dom.window;let errs=0;
w.addEventListener('error',e=>{console.log('ERR',e.message);errs++;});
const ok=(name,cond)=>{console.log((cond?'PASS':'FAIL')+'  '+name);if(!cond)errs++;};
setTimeout(()=>{
 try{
  const mk=(no,name,sub)=>({id:1,cardNumber:no,cardName:name,cardType:'角色',cardRarity:'C',cardOfferType:'补充包 测试【OP-01】',cardLife:'3',cardAttribute:['打'],cardFeatures:'x',cardTextDesc:'',cardImg:'http://x/'+no+'.png',cardColor:'黄',cardPower:'4000',cardAttack:'1000',subscript:sub});
  const cards=[mk('OP01-001','A',1),mk('OP01-002','B',2),mk('OP01-003','C',3),mk('OP01-004','D',0),mk('OP01-005','E',null),mk('OP01-006','F','5')];
  w.eval(`RAW=${JSON.stringify({fetchedAt:'2026-10-01',cards})};BCUSTOM=null;$('#leaderFirst').checked=false;buildIndex();applyFilters();`);
  const d=w.document;
  const labels=[...d.querySelectorAll('#fBlock .chip')].map(b=>b.textContent);
  console.log('chips:',JSON.stringify(labels));
  ok('沒有舊的選擇器按鈕／hidden select',!d.querySelector('.pick[data-pick=fBlock]')&&!d.querySelector('select#fBlock'));
  ok('晶片：1 2 3 5 照數字排，「無」最後（0 與空都算無）',labels.join(',')==='1,2,3,5,無');
  ok('block 統一成字串',w.eval(`BYNO.get('OP01-006').block==='5'&&BYNO.get('OP01-004').block===''`));
  ok('沒選＝全部',w.eval('view.length')===6&&d.querySelector('#activeF').textContent==='');
  const chip=v=>[...d.querySelectorAll('#fBlock .chip')].find(b=>b.dataset.v===v);
  chip('2').click();chip('3').click();
  ok('選 2＋3 → 只剩 2、3 標',w.eval(`view.length===2&&view.every(c=>c.block==='2'||c.block==='3')`));
  ok('已套用篩選列顯示 區塊 2／3',d.querySelector('#activeF').textContent.includes('區塊')&&d.querySelector('#activeF .t').textContent==='2／3');
  chip('').click();
  ok('加選「無」→ 含 0／空的卡',w.eval('view.length')===4&&d.querySelector('#activeF .t').textContent==='2／3／無');
  chip('2').click();
  ok('再點一次 2 取消',w.eval('view.length')===3&&!chip('2').classList.contains('on'));
  // 資料重建時保留已選
  w.eval('buildIndex();applyFilters();');
  ok('buildIndex 重建後保留已選（3、無）且晶片仍亮',w.eval(`F.blocks.size===2&&view.length===3`)&&chip('3').classList.contains('on')&&chip('').classList.contains('on'));
  chip('5').click();
  ok('重建後點擊只觸發一次（監聽沒重複掛）',w.eval(`F.blocks.has('5')&&view.length===4`));
  d.querySelector('#activeF [data-clr=blocks]').click();
  ok('✕ 清除區塊篩選',w.eval(`F.blocks.size===0&&view.length===6`)&&!d.querySelectorAll('#fBlock .chip.on').length);
  chip('1').click();d.querySelector('#btnReset').click();
  ok('清除所有篩選也清區塊',w.eval(`F.blocks.size===0&&view.length===6`));
  // 卡片視窗標籤：0 不再顯示「區塊 0」
  ok('norm：subscript 0 → 不標區塊',w.eval(`BYNO.get('OP01-004').block===''`));
  ok('版號 v4.2',w.eval('APP_VERSION')==='v4.2');
 }catch(e){console.log('EXC',e.stack);errs++;}
 console.log(errs?errs+' 個問題':'全部通過');process.exit(errs?1:0);
},400);
