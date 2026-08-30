const test=require('node:test');
const assert=require('node:assert/strict');
const {sanitize,redactString}=require('../lib/logger');
const {ensureRequestId}=require('../lib/http');

function fakeRes(){
  const headers={};
  return{headers,statusCode:0,setHeader(k,v){headers[k]=v;},end(body){this.body=body;}};
}

test('logger remove secrets e PII por chave',()=>{
  process.env.SESSION_SECRET='segredo-super-forte-1234567890-abcdef';
  const clean=sanitize({password:'Senha123',email:'pessoa@example.com',safe:'ok',nested:{token:'abc',count:2}});
  assert.equal(clean.password,'[REDACTED]');
  assert.equal(clean.email,'[REDACTED]');
  assert.equal(clean.nested.token,'[REDACTED]');
  assert.equal(clean.safe,'ok');
  assert.equal(clean.nested.count,2);
  assert.equal(redactString(`erro ${process.env.SESSION_SECRET}`).includes(process.env.SESSION_SECRET),false);
});

test('request id é gerado e devolvido no header',()=>{
  const req={headers:{}};const res=fakeRes();
  const id=ensureRequestId(req,res);
  assert.match(id,/^[0-9a-f-]{36}$/i);
  assert.equal(res.headers['X-Request-Id'],id);
  assert.equal(ensureRequestId(req,res),id);
});
