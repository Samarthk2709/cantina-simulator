(function(root){
'use strict';
const KEY='cantina-simulator-v3',LEGACY_KEY='cantina-simulator-v2';
// acquire(): state/null when owned, undefined when blocked. No writes before ownership.
// Save before release() on pagehide; reacquire and apply its state on pageshow/retry.
function create({storage,locks,validSave,onBlocked=()=>{}}){
 let owner=false,available=!!storage,current=null,pending=null,unlock=null,generation=0;
 function parse(raw){try{const value=JSON.parse(raw);return validSave(value)?value:null;}catch{return null;}}
 function save(state){
  if(!owner)return false;
  current=state;
  if(!available)return false;
  try{storage.setItem(KEY,JSON.stringify(state));return true;}catch{available=false;return false;}
 }
 function load(){
  if(!available)return current;
  let raw,legacy;
  try{raw=storage.getItem(KEY);if(raw===null)legacy=storage.getItem(LEGACY_KEY);}catch{available=false;return current;}
  // A present but invalid new save must never resurrect an older legacy run.
  current=parse(raw===null?legacy:raw);
  if(raw===null&&current)save(current);
  return current;
 }
 function acquire(){
  if(owner)return Promise.resolve(current);
  if(pending)return pending.promise;
  const attempt={generation,resolve:null,promise:null};
  attempt.promise=new Promise(resolve=>{attempt.resolve=resolve;});
  pending=attempt;
  function finish(value){if(pending===attempt)pending=null;attempt.resolve(value);}
  function blocked(reason){finish(undefined);onBlocked(reason);}
  if(!locks||typeof locks.request!=='function'){
   blocked('This browser cannot safely coordinate saved games between tabs. Open the game in a browser with Web Locks support.');
   return attempt.promise;
  }
  Promise.resolve().then(()=>locks.request(KEY,{mode:'exclusive',ifAvailable:true},lock=>{
   if(attempt.generation!==generation)return;
   if(!lock){blocked('Game open in another tab. Close that tab and retry.');return;}
   owner=true;
   const held=new Promise(resolve=>{unlock=resolve;});
   finish(load());
   return held;
  })).catch(()=>{
   if(attempt.generation!==generation)return;
   owner=false;
   if(unlock){unlock();unlock=null;}
   blocked('Unable to secure the saved game. Close other game tabs and retry.');
  });
  return attempt.promise;
 }
 function release(){
  generation++;
  owner=false;
  if(pending){pending.resolve(undefined);pending=null;}
  if(unlock){unlock();unlock=null;}
 }
 return {acquire,save,release,get isOwner(){return owner;},get storageAvailable(){return available;}};
}
const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CantinaSave=api;
})(typeof window!=='undefined'?window:globalThis);
