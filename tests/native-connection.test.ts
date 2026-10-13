import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeConnectionFailure} from '../packages/contracts/native-connection.ts';
test('native relay distinguishes timeout, TLS and connection reset without exposing error messages',()=>{
  for(const code of ['ECONNRESET','ECONNREFUSED','CERT_HAS_EXPIRED','NATIVE_DOCUMENT_TIMEOUT','NATIVE_DOCUMENT_RESPONSE_LIMIT']){const result=nativeConnectionFailure({code,message:'Bearer secret https://private/path'});assert.ok(result.includes(`(${code})`));assert.ok(!result.includes('secret'));assert.match(result,/No automatic replay/);}
});
test('unknown native error fields are suppressed instead of becoming model-visible secrets',()=>{
  for(const error of [null,'secret',{code:'secret-token',message:'secret'},{code:123}])assert.match(nativeConnectionFailure(error),/\(CONNECTION\)/);
});
