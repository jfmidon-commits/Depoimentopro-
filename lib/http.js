const crypto = require('node:crypto');

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
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
module.exports={bodyJson,json,method,clientIp,sameOrigin,requireSameOrigin,ensureRequestId};
