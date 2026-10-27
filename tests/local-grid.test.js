import test from 'node:test';
import assert from 'node:assert/strict';
import { collarsFromStandardRows, isLocalGridProject, localCollarXY } from '../src/lib/projectCoordinates.js';
import { readProjectFromFileList } from '../src/lib/projectIo.js';
test('local XY preserves zeros and unknown geographic location', () => {
 const c = collarsFromStandardRows([{hole_id:'A',easting:0,northing:1234,elevation:-5}]);
 assert.ok(isLocalGridProject(c)); assert.ok(Number.isNaN(c[0].lat));
 assert.deepEqual(localCollarXY(c[0]), {x:0,y:1234}); assert.equal(c[0].elevation,-5);
});
test('geographic and local coordinate contracts are explicit', () => {
 const g={hole_id:'A',latitude:-30,longitude:120};
 assert.equal(isLocalGridProject(collarsFromStandardRows([g])),false);
 assert.throws(()=>collarsFromStandardRows([{hole_id:'A',easting:'',northing:10}]),/coordinates required/);
 assert.throws(()=>collarsFromStandardRows([g,g]),/Duplicate/);
 assert.throws(()=>collarsFromStandardRows([g,{hole_id:'B',easting:10,northing:20}]),/mix/);
});
test('browser folder input cannot combine nested projects', async () => {
 const file = (path,contents) => ({name:'collars.csv',webkitRelativePath:path,text:async()=>contents});
 const out=await readProjectFromFileList([file('root/collars.csv','root'),file('root/child/collars.csv','child')]);
 assert.equal(out.files.collars,'root');
 await assert.rejects(readProjectFromFileList([file('root/child/collars.csv','child')]),/Missing required/);
});
