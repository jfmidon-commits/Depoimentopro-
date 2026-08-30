const crypto = require('node:crypto');

async function bodyRaw(req, maxBytes = 1024 * 1024) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw Object.assign(new Error('Corpo da requisição muito grande.'), { statusCode: 413 });
    return req.body;
  }
  if (typeof req.body === 'string') {
    const buffer = Buffer.from(req.body, 'utf8');
    if (buffer.length > maxBytes) throw Object.assign(new Error('Corpo da requisição muito grande.'), { statusCode: 413 });
    return buffer;
  }
  if (req.body && typeof req.body === 'object') {
    throw Object.assign(new Error('Corpo bruto indisponível para validação de assinatura.'), { statusCode: 400 });
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw Object.assign(new Error('Corpo da requisição muito grande.'), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString('utf8')); } catch { return {}; } }
  let raw='';
  for await (const chunk of req) { raw+=chunk; if(raw.length>64*1024) return {}; }
  if(!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
function json(res,status,data){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(data));}
function method(req,res,allowed){if(!allowed.includes(req.method)){res.setHeader('Allow',allowed.join(', '));json(res,405,{error:'Método não permitido'});return false;}return true;}
function clientIp(req){const xf=req.headers['x-forwarded-for'];return (Array.isArray(xf)?xf[0]:String(xf||'')).split(',')[0].trim()||req.socket?.remoteAddress||'unknown';}
function requestHost(req){const forwarded=String(req.headers['x-forwarded-host']||'').split(',')[0].trim();return forwarded||String(req.headers.host||'').trim();}
function sameOrigin(req){const source=String(req.headers.origin||req.headers.referer||'').trim();if(!source)return process.env.NODE_ENV!=='production';try{return new URL(source).host===requestHost(req);}catch{return false;}}
function requireSameOrigin(req,res){if(sameOrigin(req))return true;json(res,403,{error:'Origem da requisição não autorizada.'});return false;}
function ensureRequestId(req,res){if(req._requestId)return req._requestId;const id=crypto.randomUUID();req._requestId=id;res.setHeader('X-Request-Id',id);return id;}
module.exports={bodyRaw,bodyJson,json,method,clientIp,sameOrigin,requireSameOrigin,ensureRequestId};
