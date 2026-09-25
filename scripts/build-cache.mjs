import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const files=['index.html','style.css','app.js','storage.js','voice-follow.js','video-processing.js','audio-monitor.js','audio-export.js','visual-effects.js','manifest.webmanifest','README.md','BENCHMARK.md','VERIFICATION.md'];
async function collect(directory){for(const entry of await readdir(path.join(root,directory),{withFileTypes:true})){const name=path.posix.join(directory,entry.name);if(entry.isDirectory())await collect(name);else if(!entry.name.startsWith('.'))files.push(name);}}
await collect('assets');
await collect('docs');
const importAssets=JSON.parse(await readFile(path.join(root,'import-module/offline-assets.json'),'utf8'));
for(const name of importAssets)files.push(path.posix.join('import-module',name));
const unique=[...new Set(files)].sort(),hash=createHash('sha256');
for(const name of unique){hash.update(name);hash.update(await readFile(path.join(root,name)));}
const cache=`pocket-prompter-${hash.digest('hex').slice(0,12)}`;
const current=await readFile(path.join(root,'sw.js'),'utf8'),handlers=current.slice(current.indexOf("self.addEventListener('install'"));
if(!handlers.startsWith("self.addEventListener('install'"))throw new Error('Could not find service-worker event handlers');
await writeFile(path.join(root,'sw.js'),`const CACHE = '${cache}';\nconst ASSETS = ${JSON.stringify(['./',...unique.map(name=>'./'+name)])};\n${handlers}`);
console.log(`${unique.length+1} offline assets; ${cache}`);
