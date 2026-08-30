const {TABLES}=require('../lib/config');
const air=require('../lib/airtable');
const {bodyJson,json,method,requireSameOrigin,ensureRequestId}=require('../lib/http');
const {readSession}=require('../lib/auth');
const {LIMITS,checkRateLimit,rejectRateLimit,setRateLimitHeaders}=require('../lib/rate-limit');
const {logError}=require('../lib/logger');
const validate=require('../lib/validate');

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function requestAction(req){
  try{return String(new URL(String(req.url||'/api/moderate'),'https://depoimentopro.invalid').searchParams.get('action')||'').toLowerCase();}
  catch{return '';}
}

async function deleteTestimonial(record,id,userId){
  const campaignId=record.fields?.['Campaign']?.[0]||null;
  await air.remove(TABLES.testimonials,id);
  await sleep(200);

  const user=await air.get(TABLES.users,userId);
  const userTestimonials=Array.isArray(user.fields?.['Testimonials'])?user.fields['Testimonials']:[];
  const updates=[air.update(TABLES.users,userId,{'Depoimentos Usados':userTestimonials.length})];

  if(campaignId&&/^rec[A-Za-z0-9]{14}$/.test(campaignId)){
    const campaign=await air.get(TABLES.campaigns,campaignId).catch(()=>null);
    if(campaign&&(campaign.fields?.['User']||[]).includes(userId)){
      const campaignTestimonials=Array.isArray(campaign.fields?.['Testimonials'])?campaign.fields['Testimonials']:[];
      updates.push(air.update(TABLES.campaigns,campaignId,{'Total Respostas':campaignTestimonials.length}));
    }
  }
  await Promise.all(updates);
}

module.exports=async(req,res)=>{
  const requestId=ensureRequestId(req,res);
  if(!method(req,res,['POST'])||!requireSameOrigin(req,res))return;
  try{
    const s=readSession(req);
    if(!s)return json(res,401,{error:'Sessão inválida.'});
    const rate=await checkRateLimit({...LIMITS.moderationUser,identity:s.userId});
    setRateLimitHeaders(res,rate);
    if(!rate.allowed)return rejectRateLimit(res,rate,'Muitas ações de moderação em pouco tempo. Aguarde um instante.');

    const b=await bodyJson(req);
    let id;
    try{id=validate.recordId(b.testimonialId,'Depoimento');}
    catch(e){return json(res,400,{error:e.message});}

    const record=await air.get(TABLES.testimonials,id);
    const owners=record.fields?.['User']||[];
    if(!owners.includes(s.userId))return json(res,403,{error:'Sem permissão para este depoimento.'});

    if(b.action==='delete'||requestAction(req)==='delete'){
      await deleteTestimonial(record,id,s.userId);
      return json(res,200,{ok:true,deleted:true});
    }

    const withdrawConsent=b.withdrawConsent===true;
    let status='';
    if(!withdrawConsent){
      try{status=validate.moderationStatus(b.status);}
      catch(e){return json(res,400,{error:e.message});}
    }

    const now=new Date().toISOString();
    const fields={'Moderado Em':now,'Moderado Por':s.userId};
    if(withdrawConsent){fields['Consentimento Publicacao']=false;}
    else{fields['Status']=status;fields['Aprovado Em']=status==='Aprovado'?now:null;}
    await air.update(TABLES.testimonials,id,fields);
    return json(res,200,{ok:true,status:status||record.fields?.['Status']||'',consentimento:!withdrawConsent});
  }catch(e){
    if(e?.statusCode===404)return json(res,404,{error:'Depoimento não encontrado.'});
    logError('moderate.failed',e,{requestId,route:'/api/moderate'});
    return json(res,500,{error:'Não foi possível concluir a ação no depoimento.'});
  }
};
