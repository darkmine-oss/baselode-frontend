import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadProject } from '../src/lib/projectLoad.js';
import { readProjectFromFileList } from '../src/lib/projectIo.js';
import { collarsFromStandardRows } from '../src/lib/projectCoordinates.js';

test('loading begins before file access and read failures become visible', async () => {
 const states=[];
 const result=await loadProject({read:async()=>{assert.equal(states.at(-1).status,'loading');throw Error('Permission denied');},ingest:()=>assert.fail('must not parse failed read'),update:s=>states.push(s)});
 assert.equal(result,false);assert.equal(states.at(-1).status,'error');assert.match(states.at(-1).errors.load,/Permission denied/);
});
test('cancelled folder selection restores the prior project status',async()=>{
 const states=[];await loadProject({read:async()=>null,ingest:()=>assert.fail(),update:s=>states.push(s),previousStatus:'ready'});
 assert.equal(states.at(-1).status,'ready');
});
test('parser failures are visible and valid data reach the parser',async()=>{
 const states=[];await loadProject({read:async()=>({files:{}}),ingest:async()=>{throw Error('Invalid collar coordinates');},update:s=>states.push(s)});
 assert.match(states.at(-1).errors.load,/coordinates/);
 let received;await loadProject({read:async()=>({value:4}),ingest:async x=>{received=x;},update:()=>{}});assert.equal(received.value,4);
});
test('empty collars and corrupt required files report concrete errors',async()=>{
 assert.throws(()=>collarsFromStandardRows([]),/no data rows/);
 await assert.rejects(readProjectFromFileList([{name:'collars.parquet',webkitRelativePath:'p/collars.parquet',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}]),/Could not load collars/);
});
test('optional unreadable tables are reported; valid CSV fallback is retained',async()=>{
 const c={name:'collars.csv',webkitRelativePath:'p/collars.csv',text:async()=> 'hole_id,easting,northing\nA,0,10\n'};
 const bad={name:'geology.parquet',webkitRelativePath:'p/geology.parquet',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
 const first=await readProjectFromFileList([c,bad]);assert.match(first.errors.geology,/geology.parquet/);
 const second=await readProjectFromFileList([c,bad,{name:'geology.csv',webkitRelativePath:'p/geology.csv',text:async()=> 'hole_id,from,to,geology_code\nA,0,1,X\n'}]);
 assert.equal(second.formats.geology,'csv');assert.equal(second.errors.geology,undefined);
});
test('all supplied codecs decode with WebAssembly compilation unavailable',async()=>{
 const original=globalThis.WebAssembly;
 globalThis.WebAssembly={Module:class {constructor(){throw Error('WebAssembly blocked by desktop policy');}},Instance:class {constructor(){throw Error('WebAssembly blocked');}}};
 try {
  for(const codec of ['none','snappy','gzip','brotli','zstd','lz4']){
   const b=await readFile(new URL(`./fixtures/collars-${codec}.parquet`,import.meta.url));
   const out=await readProjectFromFileList([{name:'collars.parquet',webkitRelativePath:'p/collars.parquet',arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}]);
   assert.deepEqual(out.files.collars,[{hole_id:'0001',easting:0,northing:100,elevation:20,value:1.25,qa_flag:true},{hole_id:'0002',easting:123.456,northing:200,elevation:null,value:null,qa_flag:null}],codec);
  }
 } finally {globalThis.WebAssembly=original;}
});
