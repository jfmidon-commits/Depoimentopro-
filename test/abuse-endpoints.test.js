const test=require('node:test');
const assert=require('node:assert/strict');
process.env.SESSION_SECRET='x'.repeat(48);
process.env.NODE_ENV='production';
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

const signup=require('../api/signup');
const login=require('../api/login');
const {resetMemoryRateLimits}=require('../lib/rate-limit');

function req(body,ip){return{method:'POST',body,headers:{host:'depoimentopro.test',origin:'https://depoimentopro.test','x-forwarded-for':ip},socket:{remoteAddress:ip}};}
function res(){const headers={};return{headers,statusCode:0,setHeader(k,v){headers[k]=v;},end(body){this.body=body;}};}

test.beforeEach(()=>resetMemoryRateLimits());

test('signup bloqueia abuso com 429 e Retry-After',async()=>{
  let response;
  for(let i=0;i<6;i++){response=res();await signup(req({},'203.0.113.10'),response);}
  assert.equal(response.statusCode,429);
  assert.ok(Number(response.headers['Retry-After'])>=1);
});

test('login bloqueia brute force por conta com 429',async()=>{
  let response;
  for(let i=0;i<7;i++){
    response=res();
    await login(req({email:'invalido',password:'SenhaErrada123'},'203.0.113.11'),response);
  }
  assert.equal(response.statusCode,429);
  assert.ok(Number(response.headers['Retry-After'])>=1);
  assert.match(JSON.parse(response.body).error,/Muitas tentativas/i);
});
