const test=require('node:test');
const assert=require('node:assert/strict');
const turnstile=require('../lib/turnstile');

const originalFetch=global.fetch;
const originalSite=process.env.TURNSTILE_SITE_KEY;
const originalSecret=process.env.TURNSTILE_SECRET_KEY;
function restore(){
  global.fetch=originalFetch;
  if(originalSite===undefined)delete process.env.TURNSTILE_SITE_KEY;else process.env.TURNSTILE_SITE_KEY=originalSite;
  if(originalSecret===undefined)delete process.env.TURNSTILE_SECRET_KEY;else process.env.TURNSTILE_SECRET_KEY=originalSecret;
}
test.afterEach(restore);

test('Turnstile fica desativado sem as duas chaves',async()=>{
  delete process.env.TURNSTILE_SITE_KEY;delete process.env.TURNSTILE_SECRET_KEY;
  assert.equal(turnstile.isEnabled(),false);
  assert.equal(turnstile.siteKey(),'');
  assert.deepEqual(await turnstile.verifyTurnstile('', '127.0.0.1'),{ok:true,skipped:true});
  process.env.TURNSTILE_SITE_KEY='site-only';
  assert.equal(turnstile.isEnabled(),false);
});

test('Turnstile configurado rejeita token ausente',async()=>{
  process.env.TURNSTILE_SITE_KEY='site-key';process.env.TURNSTILE_SECRET_KEY='secret-key';
  const result=await turnstile.verifyTurnstile('', '127.0.0.1');
  assert.equal(result.ok,false);
  assert.match(result.error,/robô/i);
});

test('Turnstile aceita resposta validada pelo backend',async()=>{
  process.env.TURNSTILE_SITE_KEY='site-key';process.env.TURNSTILE_SECRET_KEY='secret-key';
  global.fetch=async(_url,options)=>{
    assert.equal(options.method,'POST');
    assert.match(String(options.body),/secret=secret-key/);
    return{json:async()=>({success:true})};
  };
  const result=await turnstile.verifyTurnstile('response-token','127.0.0.1');
  assert.equal(result.ok,true);
});

test('Turnstile rejeita resposta inválida',async()=>{
  process.env.TURNSTILE_SITE_KEY='site-key';process.env.TURNSTILE_SECRET_KEY='secret-key';
  global.fetch=async()=>({json:async()=>({success:false})});
  const result=await turnstile.verifyTurnstile('bad-token','127.0.0.1');
  assert.equal(result.ok,false);
});
