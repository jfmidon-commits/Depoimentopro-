const {bodyJson,json,method,clientIp,requireSameOrigin,ensureRequestId}=require('../lib/http');
const {verifyPassword,setSession}=require('../lib/auth');
const {findUserByEmail,publicUser}=require('../lib/user');
const {LIMITS,checkRateLimit,rejectRateLimit}=require('../lib/rate-limit');
const {log,logError}=require('../lib/logger');
const validate=require('../lib/validate');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

module.exports=async(req,res)=>{
  const requestId=ensureRequestId(req,res);
  if(!method(req,res,['POST'])||!requireSameOrigin(req,res))return;
  try{
    const b=await bodyJson(req);
    const rawEmail=String(b.email||'').trim().toLowerCase().slice(0,254);
    const rawPassword=String(b.password||'').slice(0,129);
    const ip=clientIp(req);
    const [ipRate,accountRate]=await Promise.all([
      checkRateLimit({...LIMITS.loginIp,identity:ip}),
      checkRateLimit({...LIMITS.loginAccount,identity:rawEmail||'invalid'}),
    ]);
    if(!ipRate.allowed||!accountRate.allowed){
      const blocked=!ipRate.allowed?ipRate:accountRate;
      log('warn','auth.login_rate_limited',{requestId,backend:blocked.backend});
      return rejectRateLimit(res,blocked,'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
    }

    let email;
    try{email=validate.email(rawEmail);}catch{
      await sleep(180);
      return json(res,401,{error:'E-mail ou senha inválidos.'});
    }
    if(!rawPassword||rawPassword.length>128){
      await sleep(180);
      return json(res,401,{error:'E-mail ou senha inválidos.'});
    }

    const user=await findUserByEmail(email);
    const valid=Boolean(user&&verifyPassword(rawPassword,user.fields?.['Password Hash']));
    if(!valid){
      const attempt=Math.max(1,LIMITS.loginAccount.limit-accountRate.remaining);
      await sleep(Math.min(900,150+attempt*110));
      return json(res,401,{error:'E-mail ou senha inválidos.'});
    }

    setSession(res,user.id);
    return json(res,200,{user:publicUser(user)});
  }catch(e){
    logError('login.failed',e,{requestId,route:'/api/login'});
    return json(res,500,{error:'Não foi possível entrar agora.'});
  }
};
