const test=require('node:test');
const assert=require('node:assert/strict');
const rate=require('../lib/rate-limit');

const originalFetch=global.fetch;
const originalUrl=process.env.UPSTASH_REDIS_REST_URL;
const originalToken=process.env.UPSTASH_REDIS_REST_TOKEN;

function clearRedisEnv(){delete process.env.UPSTASH_REDIS_REST_URL;delete process.env.UPSTASH_REDIS_REST_TOKEN;}
function restore(){
  global.fetch=originalFetch;
  if(originalUrl===undefined)delete process.env.UPSTASH_REDIS_REST_URL;else process.env.UPSTASH_REDIS_REST_URL=originalUrl;
  if(originalToken===undefined)delete process.env.UPSTASH_REDIS_REST_TOKEN;else process.env.UPSTASH_REDIS_REST_TOKEN=originalToken;
  rate.resetMemoryRateLimits();
}
test.afterEach(restore);

test('rate limit usa memória sem Upstash e bloqueia acima do limite',async()=>{
  clearRedisEnv();rate.resetMemoryRateLimits();
  const input={scope:'teste',identity:'ip-1',limit:2,windowMs:10000};
  assert.equal((await rate.checkRateLimit(input)).allowed,true);
  assert.equal((await rate.checkRateLimit(input)).allowed,true);
  const third=await rate.checkRateLimit(input);
  assert.equal(third.allowed,false);
  assert.equal(third.backend,'memory');
  assert.ok(third.retryAfterSec>=1);
});

test('rate limit usa Upstash REST quando configurado',async()=>{
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='token-de-teste-seguro';
  let count=0;
  global.fetch=async(_url,options)=>{
    const command=JSON.parse(options.body);
    let result=null;
    if(command[0]==='INCR')result=++count;
    else if(command[0]==='PEXPIRE')result=1;
    else if(command[0]==='PTTL')result=60000;
    return{ok:true,status:200,json:async()=>({result})};
  };
  const first=await rate.checkRateLimit({scope:'redis',identity:'user-1',limit:1,windowMs:60000});
  const second=await rate.checkRateLimit({scope:'redis',identity:'user-1',limit:1,windowMs:60000});
  assert.equal(first.allowed,true);assert.equal(first.backend,'redis');
  assert.equal(second.allowed,false);assert.equal(second.backend,'redis');
  assert.equal(second.retryAfterSec,60);
});

test('falha do Redis usa fallback em memória',async()=>{
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='token-de-teste-seguro';
  global.fetch=async()=>{throw new Error('offline');};
  const result=await rate.checkRateLimit({scope:'fallback',identity:'user-2',limit:2,windowMs:10000});
  assert.equal(result.allowed,true);
  assert.equal(result.backend,'memory-fallback');
});

test('429 inclui Retry-After sem expor identidade',()=>{
  const headers={};
  const res={statusCode:0,setHeader:(k,v)=>headers[k]=v,end(body){this.body=body;}};
  rate.rejectRateLimit(res,{remaining:0,resetAt:Date.now()+5000,retryAfterSec:5},'Limite atingido.');
  assert.equal(res.statusCode,429);
  assert.equal(headers['Retry-After'],'5');
  assert.equal(JSON.parse(res.body).error,'Limite atingido.');
});

test('lock em memória impede processamento concorrente e pode ser liberado',async()=>{
  clearRedisEnv();rate.resetMemoryRateLimits();
  const first=await rate.acquireLock({scope:'stripe-event',identity:'evt_1',ttlMs:10000});
  const second=await rate.acquireLock({scope:'stripe-event',identity:'evt_1',ttlMs:10000});
  assert.equal(first.acquired,true);
  assert.equal(first.backend,'memory');
  assert.equal(second.acquired,false);
  assert.equal(await rate.releaseLock(first),true);
  const third=await rate.acquireLock({scope:'stripe-event',identity:'evt_1',ttlMs:10000});
  assert.equal(third.acquired,true);
});

test('lock usa SET NX no Upstash e release protegido por token',async()=>{
  process.env.UPSTASH_REDIS_REST_URL='https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN='token-de-teste-seguro';
  let heldToken='';
  const commands=[];
  global.fetch=async(_url,options)=>{
    const command=JSON.parse(options.body);commands.push(command);
    let result=null;
    if(command[0]==='SET'){
      if(!heldToken){heldToken=command[2];result='OK';}
    }else if(command[0]==='EVAL'){
      if(command[4]===heldToken){heldToken='';result=1;}else result=0;
    }
    return{ok:true,status:200,json:async()=>({result})};
  };
  const first=await rate.acquireLock({scope:'stripe-event',identity:'evt_redis',ttlMs:60000});
  const second=await rate.acquireLock({scope:'stripe-event',identity:'evt_redis',ttlMs:60000});
  assert.equal(first.acquired,true);assert.equal(first.backend,'redis');
  assert.equal(second.acquired,false);
  assert.equal(await rate.releaseLock(first),true);
  assert.ok(commands.some(c=>c[0]==='SET'&&c.includes('NX')&&c.includes('PX')));
  assert.ok(commands.some(c=>c[0]==='EVAL'));
});
