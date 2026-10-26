/* Round-scoped usage ledger. All writes use existing local state / draft paths. */
(() => {
  'use strict';
  const rules=window.lampskeneQuestionRules;
  let currentRound=null,state={version:1,events:[]},serial=0;
  const round=()=>typeof activeRoundId!=='undefined'&&activeRoundId?String(activeRoundId):'local';
  const tell=()=>document.dispatchEvent(new CustomEvent('jetlag:questionusage'));
  function ensure(){const next=round();if(next===currentRound)return;currentRound=next;try{state=rules.cleanState(JSON.parse(localStorage.getItem('lampskene_question_usage_v1:'+next)||'null'));}catch(_){state=rules.cleanState(null);}}
  function persist(){try{localStorage.setItem('lampskene_question_usage_v1:'+currentRound,JSON.stringify(state));}catch(_){}tell();}
  const uid=()=>typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+(++serial).toString(36)+'-'+Math.random().toString(36).slice(2,10);
  function captureLocked(){
    ensure();if(typeof activeRoundId!=='undefined'&&activeRoundId&&typeof _sessionRoundId!=='undefined'&&_sessionRoundId!==activeRoundId)return;
    let changed=false;const all=[...(typeof questions!=='undefined'?questions:[]),...(typeof _archivedQuestions!=='undefined'?_archivedQuestions:[])];
    for(const q of all){
      if(!q.locked)continue;const key=rules.keyFor(q,state);if(!key)continue;
      if(!q.questionUsageToken)q.questionUsageToken=uid();q.questionUsageKey=key;
      const id='q:'+q.questionUsageToken+':'+key;
      if(state.events.some(e=>e.id===id))continue;
      state.events.push({id,key,at:Number(q.lockedAt)||Date.now(),source:'question',voided:false});changed=true;
    }
    if(changed)persist();
  }
  function add(key){ensure();if(!rules.definition(key))return;state.events.push({id:'m:'+uid(),key,at:Date.now(),source:'manual',voided:false});persist();if(typeof saveState==='function')saveState();}
  function setPlayed(key,on){ensure();if(on){if(!rules.count(state,key))add(key);return;}for(const e of state.events)if(e.key===key)e.voided=true;persist();if(typeof saveState==='function')saveState();}
  function undo(key){ensure();const item=[...state.events].reverse().find(e=>e.key===key&&!e.voided);if(item){item.voided=true;persist();if(typeof saveState==='function')saveState();}}
  function restore(value){ensure();if(!value)return;const incoming=rules.cleanState(value),merged=new Map(state.events.map(e=>[e.id,e]));for(const e of incoming.events){const prior=merged.get(e.id);merged.set(e.id,{...e,voided:!!(prior?.voided||e.voided)});}state=rules.cleanState({events:[...merged.values()]});persist();}
  function summary(q){ensure();const key=rules.keyFor(q,state),cost=rules.cost(state,key);if(!cost)return null;const event=state.events.find(e=>e.id==='q:'+q.questionUsageToken+':'+key&&!e.voided),asked=event?state.events.filter(e=>e.key===key&&!e.voided&&(e.at<event.at||e.at===event.at&&e.id<=event.id)).length:0;return {...cost,key,definition:rules.definition(key),asked};}
  window.lampskeneQuestionUsage={captureLocked,add,setPlayed,undo,restore,summary,getState:()=>{ensure();return rules.cleanState(state);},cost:key=>{ensure();return rules.cost(state,key);},get count(){ensure();return state.events.filter(e=>!e.voided).length;}};
})();
