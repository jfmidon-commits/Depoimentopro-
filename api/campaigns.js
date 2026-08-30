const {TABLES}=require('../lib/config');
const air=require('../lib/airtable');
const {bodyJson,json,method,requireSameOrigin,ensureRequestId}=require('../lib/http');
const {readSession}=require('../lib/auth');
const {randomToken}=require('../lib/security');
const {LIMITS,checkRateLimit,rejectRateLimit,setRateLimitHeaders}=require('../lib/rate-limit');
const {logError}=require('../lib/logger');
const validate=require('../lib/validate');

module.exports=async(req,res)=>{
  const requestId=ensureRequestId(req,res);
  if(!method(req,res,['POST'])||!requireSameOrigin(req,res))return;
  try{
    const s=readSession(req);
    if(!s)return json(res,401,{error:'Sessão inválida.'});
    const rate=await checkRateLimit({...LIMITS.campaignUser,identity:s.userId});
    setRateLimitHeaders(res,rate);
    if(!rate.allowed)return rejectRateLimit(res,rate,'Muitas campanhas criadas em pouco tempo. Aguarde alguns minutos.');

    await air.get(TABLES.users,s.userId);
    let input;
    try{input=validate.campaignInput(await bodyJson(req));}
    catch(e){if(e instanceof validate.ValidationError)return json(res,e.statusCode,{error:e.message});throw e;}

    const token=randomToken(24);
    const prod=process.env.VERCEL_PROJECT_PRODUCTION_URL?`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`:'';
    const base=String(process.env.APP_URL||prod).replace(/\/$/,'');
    const link=base?`${base}/form?token=${encodeURIComponent(token)}`:`/form?token=${encodeURIComponent(token)}`;
    const record=await air.create(TABLES.campaigns,{
      'Nome':input.nome,
      'Mensagem Email':input.mensagemEmail,
      'Mensagem WhatsApp':input.mensagemWhatsApp,
      'Link Formulario':link,
      'Status':'Ativa',
      'Criada Em':new Date().toISOString(),
      'Total Enviados':0,
      'Total Respostas':0,
      'User':[s.userId],
      'Public Token':token,
    });
    return json(res,201,{campaign:{id:record.id,nome:input.nome,status:'Ativa',link,totalRespostas:0}});
  }catch(e){
    logError('campaigns.failed',e,{requestId,route:'/api/campaigns'});
    return json(res,500,{error:'Não foi possível criar a campanha.'});
  }
};
