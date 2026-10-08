// v4.1 特徵統一煙霧測試（真實資料）：node smoke_v41_feats.js ../../site/index.html ../../site/cards.json ../../site/custom.json
const {JSDOM}=require('jsdom');const fs=require('fs');
const html=fs.readFileSync(process.argv[2],'utf8');
const cards=fs.readFileSync(process.argv[3],'utf8'),custom=fs.readFileSync(process.argv[4],'utf8');
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
setTimeout(()=>{try{
  w.eval(`RAW=${cards};BCUSTOM=${custom};buildIndex();applyFilters();renderDeck();`);
  const d=w.document;
  const opts=[...d.querySelectorAll('#fFeat option')].slice(1).map(o=>[o.value,+o.dataset.n]);
  console.log('特徵數',opts.length);
  const S2T=w.eval('S2T_MAP');
  const simp=opts.filter(([f])=>[...f].some(ch=>S2T[ch]&&ch!=='杰'));
  ok('沒有簡體字特徵：'+simp.map(x=>x[0]).join('、'),simp.length===0);
  const jp=opts.filter(([f])=>/[ぁ-んァ-ン団獣学]/.test(f));
  ok('沒有日文特徵：'+jp.map(x=>x[0]).join('、'),jp.length===0);
  const fw=opts.filter(([f])=>/[Ａ-Ｚａ-ｚ０-９／]/.test(f));
  ok('沒有全形英數／斜線：'+fw.map(x=>x[0]).join('、'),fw.length===0);
  const pre=opts.filter(([f])=>/^[原元]/.test(f));
  ok('沒有「原／元」開頭（統一為「前」）：'+pre.map(x=>x[0]).join('、'),pre.length===0);
  for(const [no,exp] of [['EB02-030','阿拉巴斯坦王國/草帽一行人'],['OP08-017','磁鼓王國'],['P-110','艾爾帕布/四皇/草帽一行人'],['OP01-064','巴其海賊團'],['OP05-059','四皇/百獸海賊團'],['OP14-098','推進城/前B・W'],['OP06-040','魚人族/新魚人海賊團'],['OP09-094','桃鬍子海賊團/黑鬍子海賊團旗下'],['EB04-057','歐哈拉/科學家'],['OP17-079','艾爾帕布/四皇/草帽一行人'],['P-152','四皇/白鬍子海賊團'],['P-160','阿拉巴斯坦王國'],['OP13-079','？'],['OP03-002','ODYSSEY'],['OP16-063','上將/海軍'],['P-096','香波地群島']])
    {const got=w.eval(`BYNO.get('${no}').feats.join('/')`);ok(`${no} 特徵＝${exp}（得到 ${got}）`,got===exp);}
  // 自訂卡（簡中原文）
  const cu=w.eval(`[...BYNO.values()].filter(c=>c.custom).map(c=>c.no+':'+c.feats.join('/'))`);
  console.log('自訂卡特徵樣本',cu.slice(0,8).join('  '));
  const cuSimp=w.eval(`[...BYNO.values()].filter(c=>c.custom).flatMap(c=>c.feats).filter(f=>[...f].some(ch=>S2T_MAP[ch]&&ch!=='杰'))`);
  ok('自訂卡特徵無簡體：'+[...new Set(cuSimp)].join('、'),cuSimp.length===0);
  // 簡中原文仍可搜尋
  w.eval(`F.q='海盗团';$('#q').value='海盗团';applyFilters();`);ok('搜「海盗团」仍找得到（簡中原文）',w.eval('view.length')>100);
  w.eval(`F.q='海賊團';$('#q').value='海賊團';applyFilters();`);ok('搜「海賊團」找得到（繁中）',w.eval('view.length')>500);
  w.eval(`F.q='';$('#q').value='';applyFilters();`);
  // 篩選：特徵選單選「草帽一行人」應包含 P-110（簡中獨有）與自訂卡
  w.eval(`$('#leaderFirst').checked=false;$('#fFeat').value='草帽一行人';$('#fFeat').dispatchEvent(new Event('change'));`);
  const nos=w.eval(`view.map(c=>c.no)`);
  ok('篩「草帽一行人」含 P-110、EB02-030、P-154（日版）',nos.includes('P-110')&&nos.includes('EB02-030')&&nos.includes('P-154'));
  console.log('草帽一行人 張數',nos.length);
  w.eval(`openCard('OP09-094')`);
  ok('卡片視窗顯示繁中特徵＋簡中原文',d.querySelector('#cdBody').textContent.includes('黑鬍子海賊團旗下')&&d.querySelector('#cdBody').textContent.includes('簡中原文'));
  // 選擇器（附張數）
  w.eval(`openPick('fFeat')`);d.querySelector('#pkQ').value='海贼';w.eval('renderPickList()');
  console.log('選擇器搜「海贼」',d.querySelectorAll('#pkList button[data-v]').length-1,'項');
  console.log('全部特徵：\n'+opts.map(([f,n])=>f+'('+n+')').join('、'));
  console.log(errs?`\n${errs} 個問題`:'\n全部通過');process.exit(errs?1:0);
}catch(e){console.log('EXC',e.stack);process.exit(1);}},500);
