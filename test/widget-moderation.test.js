const test=require('node:test');
const assert=require('node:assert/strict');

function mockRes(){return{statusCode:200,headers:{},body:'',setHeader(k,v){this.headers[String(k).toLowerCase()]=String(v);},end(v=''){this.body=String(v);return this;}};}

function loadHandler(handlerRelative,mocks){const saved=[];for(const [moduleRelative,exports] of Object.entries(mocks)){const p=require.resolve(moduleRelative);saved.push([p,require.cache[p]]);require.cache[p]={id:p,filename:p,loaded:true,exports};}const hp=require.resolve(handlerRelative);const oldHandler=require.cache[hp];delete require.cache[hp];const handler=require(handlerRelative);return{handler,restore(){delete require.cache[hp];if(oldHandler)require.cache[hp]=oldHandler;for(const [p,old] of saved){if(old)require.cache[p]=old;else delete require.cache[p];}}};}

const USER='rec'+'A'.repeat(14);
const OTHER='rec'+'B'.repeat(14);
const TESTIMONIAL='rec'+'T'.repeat(14);
const TOKEN='W'.repeat(32);

test('widget mostra apenas aprovados consentidos, escapa XSS e não usa cache persistente',async()=>{
  const air={
    escapeFormula:v=>v,
    findOne:async()=>({fields:{User:[USER],Limite:5,Ativo:true}}),
    get:async()=>({fields:{Testimonials:['1','2','3']}}),
    getMany:async()=>[
      {createdTime:'2026-08-29T10:00:00Z',fields:{Status:'Aprovado','Consentimento Publicacao':true,Texto:'<script>alert(1)</script>',Nota:5,'Nome Cliente':'Cliente & Cia','Aprovado Em':'2026-08-29T10:00:00Z'}},
      {createdTime:'2026-08-29T09:00:00Z',fields:{Status:'Aprovado','Consentimento Publicacao':false,Texto:'NÃO PUBLICAR',Nota:5,'Nome Cliente':'Sem consentimento'}},
      {createdTime:'2026-08-29T08:00:00Z',fields:{Status:'Pendente','Consentimento Publicacao':true,Texto:'PENDENTE',Nota:5,'Nome Cliente':'Pendente'}},
    ],
  };
  const {handler,restore}=loadHandler('../api/widget',{'../lib/airtable':air});
  try{
    const req={method:'GET',query:{token:TOKEN,style:'cards',limit:'5'},headers:{}};const res=mockRes();
    await handler(req,res);
    assert.equal(res.statusCode,200);
    assert.equal(res.headers['cache-control'],'no-store');
    assert.match(res.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(res.body,/Cliente &amp; Cia/);
    assert.doesNotMatch(res.body,/NÃO PUBLICAR/);
    assert.doesNotMatch(res.body,/PENDENTE/);
    assert.doesNotMatch(res.body,/<script>alert/);
  }finally{restore();}
});

test('widget rejeita token público inválido',async()=>{
  const air={escapeFormula:v=>v};
  const {handler,restore}=loadHandler('../api/widget',{'../lib/airtable':air});
  try{const res=mockRes();await handler({method:'GET',query:{token:'curto'},headers:{}},res);assert.equal(res.statusCode,400);assert.equal(res.headers['cache-control'],'no-store');}finally{restore();}
});

test('moderação impede usuário de alterar depoimento de outro proprietário',async()=>{
  let updated=false;
  const air={get:async()=>({fields:{User:[OTHER],Status:'Pendente'}}),update:async()=>{updated=true;}};
  const auth={readSession:()=>({userId:USER})};
  const {handler,restore}=loadHandler('../api/moderate',{'../lib/airtable':air,'../lib/auth':auth});
  try{
    const req={method:'POST',headers:{host:'depoimentopro-app.vercel.app',origin:'https://depoimentopro-app.vercel.app'},body:{testimonialId:TESTIMONIAL,status:'Aprovado'}};const res=mockRes();
    await handler(req,res);
    assert.equal(res.statusCode,403);assert.equal(updated,false);
  }finally{restore();}
});

test('retirada de consentimento registra auditoria e despublica',async()=>{
  let captured=null;
  const air={get:async()=>({fields:{User:[USER],Status:'Aprovado','Consentimento Publicacao':true}}),update:async(_table,_id,fields)=>{captured=fields;}};
  const auth={readSession:()=>({userId:USER})};
  const {handler,restore}=loadHandler('../api/moderate',{'../lib/airtable':air,'../lib/auth':auth});
  try{
    const req={method:'POST',headers:{host:'depoimentopro-app.vercel.app',origin:'https://depoimentopro-app.vercel.app'},body:{testimonialId:TESTIMONIAL,withdrawConsent:true}};const res=mockRes();
    await handler(req,res);
    assert.equal(res.statusCode,200);
    assert.equal(captured['Consentimento Publicacao'],false);
    assert.equal(captured['Moderado Por'],USER);
    assert.match(captured['Moderado Em'],/^\d{4}-\d{2}-\d{2}T/);
    const payload=JSON.parse(res.body);assert.equal(payload.consentimento,false);
  }finally{restore();}
});
