import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../dist/main.mjs',import.meta.url),'utf8');
const field="_sToken",label="Stable Debt";
const cid='QmTVumjhubXWP8MeDx5g114MRX99E4Gie5mFqVurttF99X',registry='0x03cfa0c4622ff84e50e75062683f44c9587e6cc1';
const hash='0x'+'ab'.repeat(32),addr=n=>'0x'+n.toString(16).padStart(40,'0');
const meta=()=>({deployment:cid,hasIndexingErrors:false,block:{number:1000,hash}});
function row(i=1,symbol='WETH') {
 const r={id:addr(i+10000),inputToken:{id:addr(i),name:'Wrapped Ether',symbol},outputToken:{id:addr(i+10000),name:'Spark '+symbol,symbol:'sp'+symbol},protocol:{id:registry}};
 r[field]={id:addr(i+(field==='outputToken'?10000:field==='_vToken'?20000:30000)),name:'Spark '+label+' '+symbol,symbol:label+symbol};return r;
}
const response=data=>({ok:true,json:async()=>({data})});
const fixture=rows=>async(body,n)=>response(n===1?{_meta:meta()}:{_meta:meta(),markets:rows});
async function load(handler){
 const calls=[];const mock=async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,options,body});return handler(body,calls.length);};
 const context=vm.createContext({AbortController,setTimeout,clearTimeout}),dependency=new vm.SyntheticModule(['default'],function(){this.setExport('default',mock);},{context}),module=new vm.SourceTextModule(code,{context});
 await module.link(specifier=>{assert.equal(specifier,'node-fetch');return dependency;});await module.evaluate();return{run:module.namespace.returnTags,calls,exports:Object.keys(module.namespace)};
}
test('single exported async two-argument function',async()=>{const x=await load(fixture([row()]));assert.deepEqual(x.exports,['returnTags']);assert.equal(x.run.length,2);assert.equal(x.run.constructor.name,'AsyncFunction');});
test('unsupported chain and invalid key make no request',async()=>{
 for(const chain of ['137','01',1,null]){const x=await load(fixture([row()]));await assert.rejects(x.run(chain,'key'),/Unsupported/);assert.equal(x.calls.length,0);}
 for(const key of ['',null,'two words']){const x=await load(fixture([row()]));await assert.rejects(x.run('1',key),/API key/);assert.equal(x.calls.length,0);}
});
test('query-derived selected role, namespace and bearer authentication',async()=>{
 const x=await load(fixture([row()])),tags=await x.run('1','test-key');assert.equal(tags[0]['Contract Address'],'eip155:1:'+row()[field].id);assert.equal(tags[0]['Public Name Tag'],'SparkLend WETH '+label);assert.equal(tags[0]['Project Name'],'Spark');
 assert(x.calls[1].body.query.includes(field+' { id name symbol }'));assert(!x.calls[1].body.query.includes('totalSupply'));assert(!x.calls[1].body.query.includes('isActive'));assert.equal(x.calls[0].options.headers.authorization,'Bearer test-key');assert.equal(x.calls[0].url,'https://gateway.thegraph.com/api/deployments/id/'+cid);assert(!x.calls[0].url.includes('test-key'));assert.equal(x.calls[1].body.variables.block.hash,hash);
});
test('pagination over 1000 markets is complete and hash pinned',async()=>{
 const first=Array.from({length:1000},(_,i)=>row(i+1,'ASSET'+(i+1)));
 const x=await load(async(body,n)=>response(n===1?{_meta:meta()}:{_meta:meta(),markets:n===2?first:[row(1001,'ASSET1001')]}));assert.equal((await x.run('1','key')).length,1001);assert.equal(x.calls[2].body.variables.last,first.at(-1).id);assert.equal(x.calls[2].body.variables.block.hash,hash);
});
test('historical zero supply is not excluded or represented as current borrowing',async()=>{const r={...row(),totalSupply:'0',isActive:false};const x=await load(fixture([r]));const tags=await x.run('1','key');assert.equal(tags.length,1);assert.match(tags[0]['Public Note'],/historical reserve accounting/);assert.match(tags[0]['Public Note'],/does not imply new borrowing/);});
test('empty, malformed, zero or missing roles fail closed',async()=>{
 for(const rows of [[],null,[{...row(),[field]:null}],[{...row(),[field]:{...row()[field],id:addr(0)}}],[{...row(),inputToken:{...row().inputToken,name:''}}]]){const x=await load(fixture(rows));await assert.rejects(x.run('1','key'));}
});
test('market identity and provider-registry mismatch fail closed',async()=>{
 for(const r of [{...row(),id:row().inputToken.id},{...row(),protocol:{id:addr(99)}}]){const x=await load(fixture([r]));await assert.rejects(x.run('1','key'),/identity/);}
});
test('duplicate cursor and conflicting token associations fail',async()=>{for(const rows of [[row(),row()],[row(2,'B'),row(1,'A')]]){const x=await load(fixture(rows));await assert.rejects(x.run('1','key'),/cursor/);}});
test('name collisions fail and long symbols do not break 50-character limit',async()=>{
 const x=await load(fixture([row(1,'WETH'),row(2,'WETH')]));await assert.rejects(x.run('1','key'),/Ambiguous/);const y=await load(fixture([row(1,'A'.repeat(150))]));assert((await y.run('1','key'))[0]['Public Name Tag'].length<=50);
});
test('untrusted markdown and controls are rendered as plain text',async()=>{const r=row(1,'[X]');r.inputToken.name='name <tag> `code`\u202e';const x=await load(fixture([r]));const tags=await x.run('1','key');assert(!/[<>`\u202e]/.test(tags[0]['Public Note']));assert(!/[\[\]]/.test(tags[0]['Public Name Tag']));});
test('known associated issuers and upstream projects appear in notes',async()=>{
 const rows=[row(1,'USDC'),row(2,'LBTC'),row(3,'PYUSD')];const x=await load(fixture(rows));const tags=await x.run('1','key');assert(tags[0]['Public Note'].includes('Circle'));assert(tags[1]['Public Note'].includes('Lombard'));assert(tags[2]['Public Note'].includes('PayPal; Paxos'));assert(tags.every(t=>t['Public Note'].includes('Spark; Sky; Aave (upstream protocol code)')));
});
test('metadata mismatch, indexing errors and snapshot changes fail closed',async()=>{
 for(const change of [{deployment:'QmWrong'},{hasIndexingErrors:true},{block:{number:1001,hash}},{block:{number:1000,hash:'0x'+'cd'.repeat(32)}}]){const x=await load(async(body,n)=>response(n===1?{_meta:meta()}:{_meta:{...meta(),...change},markets:[row()]}));await assert.rejects(x.run('1','key'),/metadata/);}
});
test('null hash is permitted on a hash-pinned page, not the initial snapshot',async()=>{const x=await load(async(body,n)=>response(n===1?{_meta:meta()}:{_meta:{...meta(),block:{number:1000,hash:null}},markets:[row()]}));assert.equal((await x.run('1','key')).length,1);const y=await load(async()=>response({_meta:{...meta(),block:{number:1000,hash:null}}}));await assert.rejects(y.run('1','key'),/snapshot hash/);});
test('HTTP, Graph and transport errors never return partial output or reflect secrets',async()=>{
 for(const handler of [async()=>({ok:false}),async()=>({ok:true,json:async()=>({errors:[{message:'test-secret'}]})}),async()=>{throw Error('test-secret');}]){const x=await load(handler);await assert.rejects(x.run('1','test-secret'),e=>!e.message.includes('test-secret'));}
});
