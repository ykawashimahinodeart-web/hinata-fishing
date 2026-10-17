/* Local measured-depth storage. This database is separate from fishing spots and Supabase. */
(() => {
  const DB_NAME='hinata-depth-local-v1', STORE='datasets', DB_VERSION=1;
  function open(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window)){reject(new Error('このブラウザは端末内データ保存に対応していません。'));return;}const request=indexedDB.open(DB_NAME,DB_VERSION);request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'dataset_id'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error||new Error('保存領域を開けません。'));});}
  async function transact(mode,operation){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode);let result;try{result=operation(tx.objectStore(STORE));}catch(error){db.close();reject(error);return;}tx.oncomplete=()=>{db.close();resolve(result?.result);};tx.onerror=tx.onabort=()=>{const error=tx.error||new Error('端末内保存に失敗しました。');db.close();reject(error);};});}
  async function list(){const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction(STORE,'readonly').objectStore(STORE).getAll();request.onsuccess=()=>{db.close();resolve((request.result||[]).sort((a,b)=>b.created_at.localeCompare(a.created_at)));};request.onerror=()=>{db.close();reject(request.error);};});}
  async function get(id){const db=await open();return new Promise((resolve,reject)=>{const request=db.transaction(STORE,'readonly').objectStore(STORE).get(id);request.onsuccess=()=>{db.close();resolve(request.result||null);};request.onerror=()=>{db.close();reject(request.error);};});}
  const put=dataset=>transact('readwrite',store=>store.put(dataset));
  const remove=id=>transact('readwrite',store=>store.delete(id));
  window.HINATA_DEPTH_STORE={list,get,put,remove};
})();
