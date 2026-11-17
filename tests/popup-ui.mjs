// Executes our own production bundle in Happy DOM with mocked extension APIs.
// This verifies UI wiring, not Firefox layout or real browser permissions.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { languages, translate, getDirection } from '../lib/i18n.ts';
const project = JSON.parse(readFileSync('project.json', 'utf8'));
const openedTabs = [];
const target = process.argv[2] ?? 'firefox';
assert.ok(['firefox','chrome'].includes(target));
const directory = `.output/${target}-mv3`;
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`,'utf8'));
const permissionRequests = [];
const script = readFileSync(`${directory}/chunks/${readdirSync(`${directory}/chunks`).find(name => name.startsWith('popup-'))}`, 'utf8');
let scan = { id:'ui-test',tabId:1,pageUrl:'https://example.com/',phase:'done',total:4,skipped:0,truncated:false,started:0,message:'',highlighted:true,
  results:[
    {status:200,outcome:'ok',error:''},
    {status:404,outcome:'broken',error:'Not found'},
    {status:403,outcome:'restricted',error:'Access denied'},
    {status:null,outcome:'uncertain',error:'Needs browser check',reason:'needs-browser',mode:'deep'},
  ].map(result=>({ ...result, url:`https://example.com/${result.status ?? 'timeout'}`,finalUrl:`https://example.com/${result.status ?? 'timeout'}`,kind:result.status===404?'external':'internal',count:1,method:'HEAD',elapsed:10 })) };

let stored, copied = '';
const requests = [];
const wait = () => new Promise(resolve => setTimeout(resolve, 20));
async function openPopup() {
  const window = new Window({ url:`${target==='firefox'?'moz':'chrome'}-extension://test/popup.html`,settings:{enableJavaScriptEvaluation:true,suppressInsecureJavaScriptEnvironmentWarning:true} });
  const api = {
    runtime:{id:'test',getManifest:()=>manifest,sendMessage:async message=>{requests.push(message);if(message.type==='cancel')scan={...scan,phase:'cancelled'};if(message.type==='scan'){scan={...scan,mode:message.mode,scope:message.scope,results:scan.results.map(row=>({...row,mode:message.mode}))};}return {scan};}},
    i18n:{getUILanguage:()=> 'ru-RU'},
    tabs:{query:async()=>[{id:1,url:scan?.pageUrl??'https://example.com/'}],create:async options=>{openedTabs.push(options);return {id:2};}},
    storage:{local:{get:async()=>({locale:stored}),set:async value=>{stored=value.locale;}},onChanged:{addListener(){},removeListener(){}}},
    permissions:{request:async request=>{permissionRequests.push(request);return true;}},
  };
  if(target==='chrome')window.chrome=api;else window.browser=api;
  Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async text=>{copied=text;}}});
  window.document.body.innerHTML='<div id="app"></div>';
  window.eval(script);
  await wait();
  return window;
}
const window=await openPopup();
try {
  assert.equal(window.document.documentElement.lang,'ru','Detect the browser UI language');
  for(const {code} of languages) {
    const select=window.document.querySelector('select'); select.value=code;
    select.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
    assert.equal(window.document.documentElement.lang,code);
    assert.equal(stored,code,'Persist the preference');
    const support=window.document.querySelector('[data-project="support"]');
    const github=window.document.querySelector('[data-project="github"]');
    assert.equal(!!support,!!project.websiteUrl);
    assert.equal(!!github,!!project.githubUrl);
    if(support)assert.ok(support.textContent.includes(translate(code,'Support LinkGuard')));
    assert.equal(window.document.documentElement.dir,getDirection(code));
    for (const [outcome, label] of [['ok','Server responds'],['broken','Not working'],['restricted','Could not verify'],['uncertain','Could not verify']]) {
      assert.equal(window.document.querySelector(`[data-outcome="${outcome}"]`).textContent,translate(code,label));
    }
    assert.equal(window.document.querySelector('td a').getAttribute('dir'),'ltr','URLs keep their original direction');
    assert.equal(window.document.querySelector('.scan-button').textContent,translate(code,'Scan'));
    assert.equal(window.document.querySelector('.mode-select option[value=deep]').textContent,translate(code,'Deep scan'));
    assert.equal(window.document.querySelector('.browser-check').textContent,translate(code,'Check in browser'));
    const filters=window.document.querySelectorAll('.filter');
    filters[1].click();await wait();
    assert.equal(window.document.querySelectorAll('tbody tr').length,1,'Filtering remains independent of the display language');
    assert.equal(window.document.querySelector('.row-detail').textContent,translate(code,'Not found'));
    window.document.querySelector('.export-toolbar button').click();await wait();
    assert.ok(copied.includes(translate(code,'Not found')),'Clipboard uses the selected language');
    assert.ok(copied.includes('https://example.com/404'));
    assert.equal(window.document.querySelector('.notice').textContent,translate(code,'Copied results: {count}',{count:1}));
    filters[0].click();await wait();
    assert.equal(window.document.querySelectorAll('tbody tr').length,4);
    if(code==='en'||code==='ru'){
      mkdirSync('artifacts',{recursive:true});
      const css=readdirSync(`${directory}/assets`).filter(name=>name.endsWith('.css')).map(name=>readFileSync(`${directory}/assets/${name}`,'utf8')).join('\n');
      const icon=`data:image/png;base64,${readFileSync(`${directory}/icon/32.png`).toString('base64')}`;
      const body=window.document.body.innerHTML.replaceAll('/icon/32.png',icon);
      writeFileSync(`artifacts/popup-preview-${target}-${code}.html`,`<!doctype html><html lang="${code}"><head><meta charset="utf-8"><title>LinkGuard — static UI preview</title><style>${css}body{margin:24px auto}.preview-note{padding:8px;font:12px system-ui;color:var(--muted);border:1px solid var(--border)}</style></head><body><p class="preview-note">Static preview · sample results · controls are inactive</p>${body}</body></html>`);
    }
    console.log(`PASS ${code}: language, direction, all link outcomes, filtering and copy`);
  }
  const filters=window.document.querySelectorAll('.filter');
  filters[2].click();await wait();
  assert.equal(window.document.querySelectorAll('tbody tr').length,2,'Unverified includes restricted and uncertain');
  const search=window.document.querySelector('input[type=search]');
  const beforeSearch=requests.length;
  search.value='403';search.dispatchEvent(new window.Event('input',{bubbles:true}));await wait();
  assert.equal(window.document.querySelectorAll('tbody tr').length,1);
  window.document.querySelector('.export-toolbar button').click();await wait();
  assert.ok(copied.includes('https://example.com/403'));
  assert.ok(!copied.includes('https://example.com/timeout'));
  assert.equal(requests.length,beforeSearch,'Search and export must not start network checks');
  search.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();
  assert.equal(search.value,'');
  filters[0].click();await wait();
  const kind=window.document.querySelector('.kind-select');
  kind.value='external';kind.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
  filters[1].click();await wait();
  assert.equal(window.document.querySelectorAll('tbody tr').length,1,'Broken external links can be isolated');
  kind.value='internal';kind.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
  assert.equal(window.document.querySelectorAll('tbody tr').length,0,'Kind and outcome filters compose');
  kind.value='all';kind.dispatchEvent(new window.Event('change',{bubbles:true}));filters[0].click();await wait();
  const projectLinks=[window.document.querySelector('[data-project=support]'),window.document.querySelector('[data-project=github]')];
  if(project.websiteUrl){projectLinks[0].click();await wait();assert.equal(openedTabs.at(-1).url,new URL('#support',project.websiteUrl).href);}
  if(project.githubUrl){projectLinks[1].click();await wait();assert.equal(openedTabs.at(-1).url,project.githubUrl);}
  window.document.querySelector('.browser-check').click(); await wait();
  assert.equal(requests.at(-1).type,'render');
  assert.equal(requests.at(-1).url,'https://example.com/timeout');
  const mode=window.document.querySelector('.mode-select');
  mode.value='deep';mode.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
  assert.ok(window.document.querySelector('.scan-hint'));
  window.document.querySelector('.start-scan').click(); await wait();
  assert.equal(requests.at(-1).mode,'deep');
  assert.equal(permissionRequests.at(-1).permissions?.includes('cookies')??false,target==='firefox');
  assert.equal(window.document.querySelector('[data-outcome=ok]').textContent,translate(window.document.documentElement.lang,'Working'));
  mode.value='quick';mode.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
  assert.equal(window.document.querySelector('.scan-hint'),null);
  window.document.querySelector('.start-scan').click(); await wait();
  assert.equal(requests.at(-1).mode,'quick');
  assert.equal(window.document.querySelector('[data-outcome=ok]').textContent,translate(window.document.documentElement.lang,'Server responds'));
  mode.value='site';mode.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
  window.document.querySelector('.start-scan').click();await wait();
  assert.equal(requests.at(-1).scope,'site');assert.equal(requests.at(-1).mode,'deep');
  const select=window.document.querySelector('select');select.value='tt-Latn';
  select.dispatchEvent(new window.Event('change',{bubbles:true}));await wait();
} finally { await window.happyDOM.abort(); }
const reopened=await openPopup();
try {
  assert.equal(reopened.document.documentElement.lang,'tt-Latn');
  assert.equal(reopened.document.querySelector('select').value,'tt-Latn');
  assert.equal(reopened.document.querySelector('.mode-select').value,'site','Restore the last scan mode');
  console.log(`PASS ${target}: saved Latin Tatar preference restored on reopening`);
} finally { await reopened.happyDOM.abort(); }

// Large scans must remain usable without rendering every result at once.
scan={...scan,scope:'page',mode:'quick',total:250,results:Array.from({length:250},(_,index)=>({
  ...scan.results[0],mode:'quick',url:`https://example.com/item/${index}`,finalUrl:`https://example.com/item/${index}`,
}))};
const large=await openPopup();
try {
  assert.equal(large.document.querySelectorAll('tbody tr').length,100);
  large.document.querySelector('.more').click();await wait();
  assert.equal(large.document.querySelectorAll('tbody tr').length,200);
  large.document.querySelector('.more').click();await wait();
  assert.equal(large.document.querySelectorAll('tbody tr').length,250);
  assert.equal(large.document.querySelector('.more'),null);
  large.navigator.clipboard.writeText=async()=>{throw new Error('Denied');};
  large.document.querySelector('.export-toolbar button').click();await wait();
  assert.equal(large.document.querySelector('[role="alert"]').textContent,translate(stored,'Clipboard unavailable. Use Export CSV instead.'));
  assert.equal(large.document.querySelectorAll('.export-toolbar button')[1].disabled,false);
  console.log('PASS: pagination for large scans and clipboard-denied recovery');
}finally{await large.happyDOM.abort();}

const hostileText='<img src=x onerror="window.injected=true">';
scan={...scan,total:1,results:[{...scan.results[0],outcome:'broken',status:404,error:hostileText}]};
const hostile=await openPopup();
try{
  assert.equal(hostile.document.querySelector('.row-detail').textContent,hostileText);
  assert.equal(hostile.document.querySelector('tbody img'),null);
  assert.equal(hostile.injected,undefined);
  console.log('PASS: untrusted result text is rendered as text, never HTML');
}finally{await hostile.happyDOM.abort();}

scan={...scan,phase:'scanning',mode:'deep',scope:'page'};
const active=await openPopup();
try{
  assert.equal(active.document.querySelector('.mode-select').disabled,true);
  assert.equal(active.document.querySelector('.start-scan'),null);
  active.document.querySelector('.stop-scan').click();await wait();
  assert.equal(requests.at(-1).type,'cancel');
  assert.ok(active.document.querySelector('.start-scan'));
  console.log('PASS: one stop action during a scan; mode cannot change mid-scan');
}finally{await active.happyDOM.abort();}

scan=undefined;
const fresh=await openPopup();
try{
  assert.equal(fresh.document.querySelector('.mode-select').value,'quick');
  assert.equal(fresh.document.querySelector('.start-scan').disabled,false);
  assert.equal(fresh.document.querySelector('table'),null);
  assert.equal(fresh.document.querySelector('.filters'),null);
  assert.equal(fresh.document.querySelector('.export-toolbar'),null);
  assert.equal(fresh.document.querySelector('input[type=search]'),null);
  assert.ok(fresh.document.querySelector('.empty').textContent);
  console.log('PASS: clean first-use state without empty table or inactive result actions');
}finally{await fresh.happyDOM.abort();}
