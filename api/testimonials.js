const {TABLES}=require('../lib/config');
const air=require('../lib/airtable');
const {bodyJson,json,method,clientIp,ensureRequestId}=require('../lib/http');
const {LIMITS,checkRateLimit,rejectRateLimit,setRateLimitHeaders}=require('../lib/rate-limit');
const {logError}=require('../lib/logger');
const {canAcceptTestimonial}=require('../lib/plans');
const validate=require('../lib/validate');
const {verifyTurnstile}=require('../lib/turnstile');

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function testimonialOrder(a,b){const da=String(a.fields?.['Data Criacao']||a.createdTime||'');const db=String(b.fields?.['Data Criacao']||b.createdTime||'');return da.localeCompare(db)||a.id.localeCompare(b.id);}

module.exports=async(req,res)=>{
  const requestId=ensureRequestId(req,res);
  if(!method(req,res,['POST']))return;
  try{
    const ip=clientIp(req);
    const rate=await checkRateLimit({...LIMITS.testimonialIp,identity:ip});
    setRateLimitHeaders(res,rate);
    if(!rate.allowed)return rejectRateLimit(res,rate,'Muitas tentativas. Tente novamente em instantes.');

    let input;
    try{input=validate.testimonialInput(await bodyJson(req));}
    catch(e){if(e instanceof validate.ValidationError)return json(res,e.statusCode,{error:e.message});throw e;}
    if(input.website)return json(res,200,{ok:true});
    if(!input.consentimento)return json(res,400,{error:'É necessário autorizar a revisão e eventual publicação.'});

    const turnstile=await verifyTurnstile(input.turnstileToken,ip);
    if(!turnstile.ok)return json(res,400,{error:turnstile.error});

    const t=air.escapeFormula(input.token);
    const campaign=await air.findOne(TABLES.campaigns,`AND({Public Token}='${t}',{Status}='Ativa')`);
    if(!campaign)return json(res,404,{error:'Campanha não encontrada ou pausada.'});
    const userId=campaign.fields?.['User']?.[0];
    if(!userId)return json(res,400,{error:'Campanha inválida.'});

    const user=await air.get(TABLES.users,userId);
    const uf=user.fields||{};
    const linkedBefore=Array.isArray(uf['Testimonials'])?uf['Testimonials']:[];
    const used=Math.max(Number(uf['Depoimentos Usados']||0),linkedBefore.length);
    const ent=canAcceptTestimonial({...uf,'Depoimentos Usados':used});
    const limit=ent.limit;
    if(!ent.canAccept)return json(res,403,{error:'Esta campanha atingiu o limite do plano atual.'});

    const record=await air.create(TABLES.testimonials,{
      'Nome Cliente':input.nomeCliente,
      'Texto':input.texto,
      'Nota':input.nota,
      'Status':'Pendente',
      'Origem':'Form',
      'Data Criacao':new Date().toISOString(),
      'User':[userId],
      'Campaign':[campaign.id],
      'Consentimento Publicacao':true,
    });

    let finalUsed=used+1;
    if(limit!==null){
      await sleep(200);
      const refreshedUser=await air.get(TABLES.users,userId);
      const linked=Array.isArray(refreshedUser.fields?.['Testimonials'])?refreshedUser.fields['Testimonials']:[];
      const records=await air.getMany(TABLES.testimonials,linked,Math.max(100,limit));
      records.sort(testimonialOrder);
      const allowed=new Set(records.slice(0,limit).map(r=>r.id));
      if(!allowed.has(record.id)){
        await air.remove(TABLES.testimonials,record.id);
        return json(res,409,{error:'O limite do plano foi atingido por outro envio simultâneo.'});
      }
      finalUsed=Math.min(linked.length,limit);
    }else{
      const refreshedUser=await air.get(TABLES.users,userId);
      const linked=Array.isArray(refreshedUser.fields?.['Testimonials'])?refreshedUser.fields['Testimonials']:[];
      finalUsed=Math.max(finalUsed,linked.length);
    }

    const refreshedCampaign=await air.get(TABLES.campaigns,campaign.id);
    const linkedResponses=Array.isArray(refreshedCampaign.fields?.['Testimonials'])
      ?refreshedCampaign.fields['Testimonials'].length
      :Number(campaign.fields?.['Total Respostas']||0)+1;
    await Promise.all([
      air.update(TABLES.users,userId,{'Depoimentos Usados':finalUsed}),
      air.update(TABLES.campaigns,campaign.id,{'Total Respostas':linkedResponses}),
    ]);
    return json(res,201,{ok:true,id:record.id});
  }catch(e){
    logError('testimonials.failed',e,{requestId,route:'/api/testimonials'});
    return json(res,500,{error:'Não foi possível enviar o depoimento.'});
  }
};
