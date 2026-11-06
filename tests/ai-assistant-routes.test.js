"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {registerAiAssistantRoutes}=require("../backend/routes/ai-assistant.routes");
function setup(options={}) {
  const routes={};const app={
    get:(url,...args)=>routes["GET "+url]=args,
    delete:(url,...args)=>routes["DELETE "+url]=args,
    post:(url,...args)=>routes["POST "+url]=args
  };
  const messages=new Map();const batches=[];const modelCalls=[];let index=0;
  const chat=(uid)=>({
    doc(id){const key=id||"doc-"+(++index);return {id:key,uid};},
    orderBy(field,direction){return {limit(n){return {get:async()=>{if(options.offline)throw new Error("Offline");
      const list=[...(messages.get(uid)||[])].slice().reverse().slice(0,n);
      return {docs:list.map(item=>({id:item.id,data:()=>item,ref:{id:item.id,uid}}))};
    }};}};},
    async get(){if(options.offline)throw new Error("Offline");return {docs:(messages.get(uid)||[]).map(item=>({ref:{id:item.id,uid},data:()=>item}))};}
  });
  const db={collection:()=>({doc:uid=>({collection:()=>chat(uid)})}),batch:()=>{
    const operations=[];const batch={
      set:(ref,data)=>operations.push({op:"set",ref,data}),
      delete:ref=>operations.push({op:"delete",ref}),
      async commit(){if(options.failBatch)throw new Error("Batch unavailable");batches.push(operations);
        for(const op of operations){const data=messages.get(op.ref.uid)||[];
          if(op.op==="set")messages.set(op.ref.uid,[...data,{id:op.ref.id,...op.data}]);
          else messages.set(op.ref.uid,data.filter(item=>item.id!==op.ref.id));
        }
      }
    };return batch;
  }};
  class FakeGoogleGenAI {
    constructor(config){assert.ok(config.apiKey);this.models={generateContent:async payload=>{
      modelCalls.push(payload);
      if(options.quota)throw Object.assign(new Error("quota"),{status:429});
      if(options.aiError)throw new Error("AI provider failed");
      return {text:options.emptyResponse?"":"Assistant response"};
    }};}
  }
  const middleware=(req,res,next)=>next();
  registerAiAssistantRoutes(app,{
    getDb:()=>db,getTimestamp:()=>({fromMillis:ms=>({ms})}),authRequired:middleware,
    serialize:x=>x,newDocumentId:()=>"uuid-"+(++index),XTECH_MANUAL:"XTECH manual: stock in and stock out.",
    loadGoogleGenAI:async()=>({GoogleGenAI:FakeGoogleGenAI})
  });
  const call=async(method,url,body={},who={uid:"alice",name:"Alice"},role="customer")=>{
    const handlers=routes[method+" "+url];assert.ok(handlers);
    const request={body,user:who,profile:{role,name:who.name}};
    const res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;}};
    await handlers.at(-1)(request,res);return res;
  };
  return {routes,messages,batches,modelCalls,call,middleware};
}
async function withKey(value,fn) {const prior=process.env.GEMINI_API_KEY;if(value===null)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=value;
  try{return await fn();}finally{if(prior===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=prior;}}
const withErrors=async fn=>{const previous=console.error;console.error=()=>{};try{return await fn();}finally{console.error=previous;}};
test("registers original chat list, deletion and message endpoints",()=>{const s=setup();assert.deepEqual(Object.keys(s.routes),["GET /api/chat/history","DELETE /api/chat/history","POST /api/chat"]);});
test("all AI endpoints retain required authentication middleware",()=>{const s=setup();for(const handlers of Object.values(s.routes)){assert.equal(handlers.length,2);assert.equal(handlers[0],s.middleware);}});
test("registration does not fetch Gemini or query Firestore",()=>{const s=setup({offline:true});assert.equal(s.modelCalls.length,0);});
test("history retrieves authenticated user's messages only, in old-to-new order",async()=>{const s=setup();s.messages.set("alice",[{id:"a",text:"first",role:"user"},{id:"b",text:"last",role:"assistant"}]);s.messages.set("bob",[{id:"c",text:"secret"}]);const r=await s.call("GET","/api/chat/history");assert.equal(r.statusCode,200);assert.deepEqual(r.body.messages.map(x=>x.text),["first","last"]);});
test("history enforces the original 60-message upper bound",async()=>{const s=setup();s.messages.set("alice",Array.from({length:70},(_,i)=>({id:String(i),text:String(i)})));const r=await s.call("GET","/api/chat/history");assert.equal(r.body.messages.length,60);});
test("history returns HTTP 500 when Firestore is unavailable",async()=>withErrors(async()=>{const s=setup({offline:true});const r=await s.call("GET","/api/chat/history");assert.equal(r.statusCode,500);}));
test("deleting history removes only current user's records",async()=>{const s=setup();s.messages.set("alice",[{id:"a"},{id:"b"}]);s.messages.set("bob",[{id:"c"}]);const r=await s.call("DELETE","/api/chat/history");assert.equal(r.statusCode,200);assert.equal(s.messages.get("alice").length,0);assert.equal(s.messages.get("bob").length,1);});
test("history deletion splits more than 400 documents into separate batches",async()=>{const s=setup();s.messages.set("alice",Array.from({length:405},(_,i)=>({id:"m"+i})));await s.call("DELETE","/api/chat/history");assert.equal(s.batches.length,2);assert.equal(s.messages.get("alice").length,0);});
test("history deletion reports HTTP 500 for Firestore write failure",async()=>withErrors(async()=>{const s=setup({failBatch:true});s.messages.set("alice",[{id:"a"}]);const r=await s.call("DELETE","/api/chat/history");assert.equal(r.statusCode,500);}));
test("AI endpoint rejects blank messages",async()=>{const s=setup();const r=await s.call("POST","/api/chat",{message:" "});assert.equal(r.statusCode,400);});
test("AI endpoint rejects messages over 1,500 characters",async()=>{const s=setup();const r=await s.call("POST","/api/chat",{message:"x".repeat(1501)});assert.equal(r.statusCode,400);});
test("AI endpoint returns 503 without Gemini API key",async()=>withKey(null,async()=>{const s=setup();const r=await s.call("POST","/api/chat",{message:"What is pickup?"});assert.equal(r.statusCode,503);}));
test("AI prompt contains XTECH manual and permitted customer page context",async()=>withKey("fake",async()=>{const s=setup();const r=await s.call("POST","/api/chat",{message:"How do I request pickup?",section:"pickups"});assert.equal(r.statusCode,200);const instruction=s.modelCalls[0].config.systemInstruction;assert.match(instruction,/XTECH manual: stock in and stock out/);assert.match(instruction,/Current XTECH page: Pickup Services/);assert.match(instruction,/Role: customer/);}));
test("AI prompt rejects unauthorized page context without revealing its label",async()=>withKey("fake",async()=>{const s=setup();await s.call("POST","/api/chat",{message:"Help",section:"users"});assert.match(s.modelCalls[0].config.systemInstruction,/Current XTECH page: Not supplied/);}));
test("AI uses only the currently authenticated user's chat history",async()=>withKey("fake",async()=>{const s=setup();s.messages.set("bob",[{id:"a",role:"user",text:"bob private data"}]);s.messages.set("alice",[{id:"b",role:"user",text:"alice question"}]);await s.call("POST","/api/chat",{message:"follow-up"});const instr=s.modelCalls[0].config.systemInstruction;assert.match(instr,/alice question/);assert.doesNotMatch(instr,/bob private data/);}));
test("AI stores user question and response in a single Firestore batch",async()=>withKey("fake",async()=>{const s=setup();const r=await s.call("POST","/api/chat",{message:"help"});assert.equal(r.body.reply,"Assistant response");assert.equal(s.batches.length,1);assert.equal(s.batches[0].length,2);assert.deepEqual(s.batches[0].map(x=>x.data.role),["user","assistant"]);}));
test("AI response fallback when Gemini returns empty text",async()=>withKey("fake",async()=>{const s=setup({emptyResponse:true});const r=await s.call("POST","/api/chat",{message:"help"});assert.match(r.body.reply,/don't have enough information/);}));
test("AI quota failure maps to original HTTP 429",async()=>withErrors(()=>withKey("fake",async()=>{const s=setup({quota:true});const r=await s.call("POST","/api/chat",{message:"help"});assert.equal(r.statusCode,429);}))); 
test("AI provider failure returns HTTP 500 without saving conversation",async()=>withErrors(()=>withKey("fake",async()=>{const s=setup({aiError:true});const r=await s.call("POST","/api/chat",{message:"help"});assert.equal(r.statusCode,500);assert.equal(s.batches.length,0);}))); 
