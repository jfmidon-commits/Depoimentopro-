const {TABLES}=require('../lib/config');
const air=require('../lib/airtable');
const {bodyJson,json,method,clientIp,requireSameOrigin,ensureRequestId}=require('../lib/http');
const {hashPassword,setSession}=require('../lib/auth');
const {findUserByEmail,publicUser}=require('../lib/user');
const {LIMITS,checkRateLimit,rejectRateLimit,setRateLimitHeaders}=require('../lib/rate-limit');
const {logError}=require('../lib/logger');
const validate=require('../lib/validate');

module.exports=async(req,res)=>{
  const requestId=ensureRequestId(req,res);
  if(!method(req,res,['POST'])||!requireSameOrigin(req,res))return;
  try{
    const ip=clientIp(req);
    const rate=await checkRateLimit({...LIMITS.signupIp,identity:ip});
    setRateLimitHeaders(res,rate);
    if(!rate.allowed)return rejectRateLimit(res,rate,'Muitas tentativas de cadastro. Aguarde alguns minutos e tente novamente.');

    const b=await bodyJson(req);
    let nome,email,password;
    try{
      nome=validate.string(b.nome,{label:'Nome',min:2,max:120});
      email=validate.email(b.email);
      password=validate.password(b.password);
    }catch(e){
      if(e instanceof validate.ValidationError)return json(res,e.statusCode,{error:e.message});
      throw e;
    }
    if(await findUserByEmail(email))return json(res,409,{error:'Não foi possível criar a conta com os dados informados.'});
    const record=await air.create(TABLES.users,{
      'Nome':nome,
      'Email':email,
      'Plano':'Free',
      'Limite Depoimentos':5,
      'Depoimentos Usados':0,
      'Widgets Criados':0,
      'Data Criacao':new Date().toISOString(),
      'Onboarding Completo':false,
      'Password Hash':hashPassword(password),
    });
    setSession(res,record.id);
    return json(res,201,{user:publicUser(record)});
  }catch(e){
    logError('signup.failed',e,{requestId,route:'/api/signup'});
    return json(res,500,{error:'Não foi possível criar a conta agora.'});
  }
};
