class ValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

function string(value, { label = 'Campo', min = 0, max = 255, optional = false } = {}) {
  const out = String(value ?? '').trim();
  if (!out && optional) return '';
  if (out.length < min || out.length > max) throw new ValidationError(`${label} deve ter entre ${min} e ${max} caracteres.`);
  return out;
}
function email(value) {
  const out = String(value ?? '').trim().toLowerCase();
  if (out.length < 3 || out.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out)) throw new ValidationError('E-mail inválido.');
  return out;
}
function password(value) {
  const out = String(value ?? '');
  if (out.length < 10 || out.length > 128 || !/[A-Za-z]/.test(out) || !/\d/.test(out)) throw new ValidationError('A senha precisa ter entre 10 e 128 caracteres e conter letras e números.');
  return out;
}
function recordId(value, label = 'Registro') { const out=String(value??'').trim(); if(!/^rec[A-Za-z0-9]{14}$/.test(out)) throw new ValidationError(`${label} inválido.`); return out; }
function publicToken(value, label = 'Token') { const out=String(value??'').trim(); if(!/^[A-Za-z0-9_-]{20,128}$/.test(out)) throw new ValidationError(`${label} inválido.`); return out; }
function rating(value) { const out=Number(value); if(![1,2,3,4,5].includes(out)) throw new ValidationError('Selecione uma nota de 1 a 5.'); return out; }
function moderationStatus(value) { const out=String(value??''); if(!['Aprovado','Rejeitado'].includes(out)) throw new ValidationError('Status inválido.'); return out; }
function campaignInput(body={}) { return { nome:string(body.nome,{label:'Nome da campanha',min:2,max:120}), mensagemEmail:string(body.mensagemEmail,{label:'Mensagem de e-mail',min:0,max:2000,optional:true}), mensagemWhatsApp:string(body.mensagemWhatsApp,{label:'Mensagem de WhatsApp',min:0,max:2000,optional:true}) }; }
function testimonialInput(body={}) { return { token:publicToken(body.token,'Link'), nomeCliente:string(body.nomeCliente,{label:'Nome',min:2,max:120}), texto:string(body.texto,{label:'Depoimento',min:10,max:2000}), nota:rating(body.nota), consentimento:body.consentimento===true, website:String(body.website??'').trim().slice(0,500), turnstileToken:String(body.turnstileToken??'').trim().slice(0,2048) }; }
module.exports={ValidationError,string,email,password,recordId,publicToken,rating,moderationStatus,campaignInput,testimonialInput};
