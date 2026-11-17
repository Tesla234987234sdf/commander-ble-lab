/* Translate presentation only. Commands, input values and downloaded data stay intact. */
(() => {
  'use strict';
  const catalogue=window.CommanderTranslations;
  const normalize=s=>s.replace(/\s+/gu,' ').trim();
  const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const exact=new Map(), fragments=new Map();
  for(const row of catalogue.entries){
    for(const text of row)if(text)exact.set(normalize(text),row);
    if(row[0].length>=4 && (row[0]!==row[1]||row[0]!==row[2]))fragments.set(normalize(row[0]),row);
  }
  for(const row of catalogue.fragments)fragments.set(row[0],row);
  // One pass prevents translated words from being translated a second time.
  const keys=[...fragments.keys()].sort((a,b)=>b.length-a.length);
  const fragmentRE=new RegExp(keys.map(escape).join('|'),'gu');
  const word=char=>!!char&&/[\p{L}\p{N}_]/u.test(char);
  let language='de';
  try{const saved=localStorage.getItem('commanderLanguage');if(saved==='de'||saved==='en')language=saved;}catch{}
  const originalText=new WeakMap(),originalAttrs=new WeakMap();
  const skip='script,style,code,pre,[translate="no"],a[download],#deviceHost,#fwBuild,#pmName';
  function translate(text){
    const source=String(text),clean=normalize(source),index=language==='de'?1:2;
    if(!clean)return source;
    const row=exact.get(clean);
    const output=row?row[index]:clean.replace(fragmentRE,(match,offset,whole)=>{
      if(word(match[0])&&word(whole[offset-1])||word(match.at(-1))&&word(whole[offset+match.length]))return match;
      return fragments.get(match)[index];
    });
    return source.match(/^\s*/u)[0]+output+source.match(/\s*$/u)[0];
  }
  function textNode(node){
    if(!node.parentElement||node.parentElement.closest(skip))return;
    const last=originalText.get(node),current=node.nodeValue;
    const source=last&&current===last.output?last.source:current;
    const output=translate(source);
    originalText.set(node,{source,output});
    if(output!==current)node.nodeValue=output;
  }
  function attributes(el){
    if(el.closest(skip))return;
    let record=originalAttrs.get(el);if(!record){record={};originalAttrs.set(el,record);}
    for(const name of ['title','placeholder','aria-label']){
      if(!el.hasAttribute(name))continue;
      const current=el.getAttribute(name),last=record[name];
      const source=last&&current===last.output?last.source:current,output=translate(source);
      record[name]={source,output};if(current!==output)el.setAttribute(name,output);
    }
  }
  function scan(root){
    if(root.nodeType===Node.TEXT_NODE){textNode(root);return;}
    if(root.nodeType!==Node.ELEMENT_NODE)return;
    attributes(root);
    const walk=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
    while(walk.nextNode()){if(walk.currentNode.nodeType===Node.TEXT_NODE)textNode(walk.currentNode);else attributes(walk.currentNode);}
  }
  const observer=new MutationObserver(changes=>{
    for(const change of changes){
      if(change.type==='characterData')textNode(change.target);
      else if(change.type==='attributes')attributes(change.target);
      else for(const node of change.addedNodes)scan(node);
    }
  });
  function setLanguage(next){
    if(next!=='de'&&next!=='en')return;
    language=next;document.documentElement.lang=next;
    document.getElementById('languageSelect').value=next;
    try{localStorage.setItem('commanderLanguage',next);}catch{}
    scan(document.body);
    document.dispatchEvent(new CustomEvent('commander:language',{detail:{language:next}}));
  }
  // Dialogs are not DOM nodes. Translate them before handing them to the browser.
  for(const name of ['alert','confirm','prompt']){
    const native=window[name].bind(window);
    window[name]=(message,...args)=>native(translate(message),...args);
  }
  window.CommanderI18n={translate,setLanguage,get language(){return language;}};
  setLanguage(language);
  document.getElementById('languageSelect').addEventListener('change',event=>setLanguage(event.target.value));
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']});
})();
