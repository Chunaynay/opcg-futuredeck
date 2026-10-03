// 用法：cd 到有 jsdom 的目錄後  node scripts/smoke_test.js [html路徑]   （預設讀 assets/opcg-deck-builder.html）
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','assets','opcg-deck-builder.html'),'utf8');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.IntersectionObserver=class{observe(){}};w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};}});
const w=dom.window;
w.addEventListener('error',e=>console.log('ERR',e.message));
setTimeout(()=>{
 const mk=(no,name,type,color,life,pw,atk,txt)=>({id:1,cardNumber:no,cardName:name,cardType:type,cardRarity:'C',cardOfferType:'S',cardLife:life,cardAttribute:['特'],cardColor:color,cardPower:pw,cardAttack:atk,cardFeatures:'A/B',cardTextDesc:txt,cardTrigger:'',subscript:5,mixedColor:0,cardImg:'x.png',displayId:1,cardCartograph:''});
 const cards=[mk('OP01-001','L1','领袖','黄/绿','5','5000','-',''),mk('OP01-002','C1','角色','黄','3','4000','反击+1000','【阻挡者】'),mk('OP01-002','C1','角色','黄','3','4000','反击+1000','【阻挡者】'),mk('OP01-003','C2','角色','黑','3','4000','-','x'),mk('OP01-004','E1','事件','绿','1','-','-','y')];
 w.RAW={fetchedAt:'2026-10-01',cards};
 try{
  w.eval(`RAW=${JSON.stringify(w.RAW)};buildIndex();applyFilters();renderDeck();`);
  console.log('status:',w.document.querySelector('#dbStatus').textContent);
  console.log('tiles:',w.document.querySelectorAll('.tile').length);
  w.eval(`setLeader('OP01-001');addCard('OP01-002');addCard('OP01-002');addCard('OP01-002');addCard('OP01-002');addCard('OP01-002');addCard('OP01-004');`);
  console.log('count:',w.document.querySelector('#mainCount').textContent);
  console.log('issues:',w.document.querySelector('#issues').textContent);
  console.log('tiles after legal filter:',w.document.querySelectorAll('.tile').length);
  console.log(w.eval('deckToText()'));
  w.eval(`deck=textToDeck("領袖 OP01-001\\n4x OP01-002\\nOP01-003 x2");afterChange();`);
  console.log('issues2:',w.document.querySelector('#issues').textContent);
  w.eval(`openCard('OP01-002')`);console.log('dlg:',w.document.querySelector('#cdTitle').textContent, w.document.querySelector('#cdN').textContent);
  console.log('stats:',w.document.querySelector('#stats').textContent.slice(0,120));
  console.log('t2s:',w.eval(`t2s('克洛克達爾 羅賓')`));
 }catch(e){console.log('EXC',e.stack)}
 process.exit(0);
},300);
