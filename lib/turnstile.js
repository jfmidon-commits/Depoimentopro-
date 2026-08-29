function config(){
  const siteKey=String(process.env.TURNSTILE_SITE_KEY||'').trim();
  const secret=String(process.env.TURNSTILE_SECRET_KEY||'').trim();
  return {siteKey,secret,enabled:Boolean(siteKey&&secret)};
}

function siteKey(){
  const current=config();
  return current.enabled?current.siteKey:'';
}

async function verifyTurnstile(responseToken,remoteIp){
  const current=config();
  if(!current.enabled)return{ok:true,skipped:true};
  if(!responseToken)return{ok:false,error:'Confirme que você não é um robô.'};
  try{
    const body=new URLSearchParams({secret:current.secret,response:responseToken});
    if(remoteIp&&remoteIp!=='unknown')body.set('remoteip',remoteIp);
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body,
    });
    const data=await response.json().catch(()=>({}));
    return data.success?{ok:true}:{ok:false,error:'Não foi possível validar o desafio anti-spam.'};
  }catch(error){
    console.error('turnstile',error);
    return{ok:false,error:'Não foi possível validar o desafio anti-spam.'};
  }
}

module.exports={siteKey,verifyTurnstile};
