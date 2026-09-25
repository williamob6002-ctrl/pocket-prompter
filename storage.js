const DB_NAME = 'pocket-prompter-recordings-v1';
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('takes', { keyPath: 'id' });
      const chunks = d.createObjectStore('chunks', { keyPath: ['takeId', 'index'] });
      chunks.createIndex('takeId', 'takeId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
    req.onblocked = () => { dbPromise = undefined; reject(new Error('Close other Pocket Prompter windows and try again.')); };
  });
  return dbPromise;
}
async function transaction(storeNames, mode, callback) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeNames, mode);
    let result;
    try { result = callback(tx); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = event => reject(event.target.error || tx.error || new Error('Could not save the recording.'));
    tx.onabort = () => reject(tx.error || new Error('Saving was interrupted.'));
  });
}
export async function saveTake(take) { await transaction(['takes'], 'readwrite', tx => tx.objectStore('takes').put(take)); }
export async function saveChunk(takeId, index, blob) {
  // Materialise each chunk before opening the transaction. This also avoids
  // WebKit failures persisting file-backed MediaRecorder Blob references.
  const bytes = await blob.arrayBuffer();
  await transaction(['chunks'], 'readwrite', tx => tx.objectStore('chunks').put({takeId,index,bytes}));
}
export async function listTakes() {
  const d = await db();
  const takes = await new Promise((resolve,reject)=>{const r=d.transaction('takes').objectStore('takes').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return takes.sort((a,b)=>b.created-a.created);
}
export async function takeBlob(take) {
  const d=await db();
  const chunks=await new Promise((resolve,reject)=>{const r=d.transaction('chunks').objectStore('chunks').index('takeId').getAll(take.id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  if (!chunks.length) throw new Error('No video data was saved for this take.');
  return new Blob(chunks.sort((a,b)=>a.index-b.index).map(c=>c.bytes||c.blob),{type:take.mimeType});
}
export async function deleteTake(id) {
  await transaction(['takes','chunks'],'readwrite',tx=>{
    tx.objectStore('takes').delete(id);
    const s=tx.objectStore('chunks');
    const r=s.index('takeId').openKeyCursor(IDBKeyRange.only(id));
    r.onsuccess=()=>{const c=r.result;if(c){s.delete(c.primaryKey);c.continue();}};
  });
}

/** Patch only an existing take; preserve unrelated metadata and recording chunks. */
export async function updateTakeMetadata(id, changes) {
  const d=await db();
  return new Promise((resolve,reject)=>{
    const tx=d.transaction('takes','readwrite'),store=tx.objectStore('takes');
    let updated,failure;
    tx.oncomplete=()=>resolve(updated);
    tx.onerror=()=>reject(failure||tx.error||new Error('Could not save take changes.'));
    tx.onabort=()=>reject(failure||tx.error||new Error('Saving was interrupted.'));
    const request=store.get(id);
    request.onsuccess=()=>{
      if(!request.result){failure=new Error('This take is not saved on this device. Save its video and SRT files instead.');tx.abort();return;}
      updated={...request.result,...changes,id};store.put(updated);
    };
  });
}
