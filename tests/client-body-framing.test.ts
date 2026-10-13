import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {httpsTransport} from '../packages/client/index.ts';
test('JSON DELETE bodies are framed without overriding supplied framing or mutating caller headers',async()=>{
  const original=https.request;const captured:any[]=[];
  (https as any).request=(_url:any,options:any,callback:any)=>{
    const req=new EventEmitter() as any;req.destroy=(error:Error)=>req.emit('error',error);req.end=(body:Buffer)=>{captured.push({options,body});queueMicrotask(()=>{const res=new EventEmitter() as any;res.statusCode=200;callback(res);res.emit('data',Buffer.from('{}'));res.emit('end');});};return req;
  };
  try{
    const body=Buffer.from('{"token":"synthetic"}'),headers={'Content-Type':'application/json'};
    await httpsTransport({url:new URL('https://localhost/access'),method:'DELETE',headers,body,ca:'fixture',timeoutMs:1000});assert.equal(captured[0].options.headers['Content-Length'],String(body.length));assert.equal(captured[0].options.rejectUnauthorized,true);assert.equal(captured[0].body,body);assert.deepEqual(headers,{'Content-Type':'application/json'});
    await httpsTransport({url:new URL('https://localhost/access'),method:'DELETE',headers:{'content-length':String(body.length)},body,ca:'fixture',timeoutMs:1000});assert.equal(captured[1].options.headers['Content-Length'],undefined);
    await httpsTransport({url:new URL('https://localhost/access'),method:'DELETE',headers:{'Transfer-Encoding':'chunked'},body,ca:'fixture',timeoutMs:1000});assert.equal(captured[2].options.headers['Content-Length'],undefined);
    await httpsTransport({url:new URL('https://localhost/access'),method:'GET',headers:{},ca:'fixture',timeoutMs:1000});assert.equal(captured[3].options.headers['Content-Length'],undefined);
  }finally{https.request=original;}
});
