"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {registerCustomerRegistrationRoutes}=require("../backend/routes/customer-registration.routes");
function setup(options={}) {
  const routes={};const app={post:(url,...f)=>routes[url]=f.at(-1)};
  const collections={users:new Map(),customers:new Map()};
  const uid="generated-uid";const email="hello@example.com";
  let created=null,deleted=false,seq=0;const issued=[];
  const doc=(name,id)=>({
    id,
    get:async()=>{const d=collections[name].get(id);return {exists:!!d,data:()=>d,id};},
    set:async d=>{if(options.failUserSave&&name==="users")throw new Error("Firestore user save failed");collections[name].set(id,d);},
    update:async changes=>collections[name].set(id,{...collections[name].get(id),...changes}),
    delete:async()=>collections[name].delete(id)
  });
  const db={collection:name=>({doc:id=>doc(name,id),where:(field,op,value)=>({limit:()=>({get:async()=>{
    const docs=[...collections[name]].filter(([,data])=>data[field]===value).map(([key,data])=>({id:key,ref:doc(name,key),data:()=>data}));
    return {empty:docs.length===0,docs};
  }})})})};
  const auth={
    getUserByEmail:async()=>{if(options.existingUser)return {uid:options.existingUid||"existing-uid",email};throw Object.assign(new Error("Not found"),{code:"auth/user-not-found"});},
    createUser:async input=>{created={uid,...input};return created;},
    deleteUser:async id=>{deleted=true;assert.equal(id,uid);}
  };
  const deps={getDb:()=>db,getAuth:()=>auth,now:()=>({time:Date.now()}),newDocumentId:()=>"new-cust-1",
    normalizedEmail:x=>String(x||"").trim().toLowerCase(),
    normalizePhilippineMobile:x=>x==="bad"?null:String(x||""),
    isValidName:x=>/^[A-Za-z ]{2,}$/.test(x),
    isValidEmailAddress:x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x),
    emailDomainCanReceiveMail:async()=>!options.badDomain,
    isValidOptionalText:(x,max)=>x.length<=max,
    isValidPassword:x=>x.length>=6&&x.length<=128,
    issueEmailOtp:async (...args)=>{if(options.failOtp)throw new Error("Email delivery failed");issued.push(args);return {maskedEmail:"h***@example.com",expiresInSeconds:600,resendAfterSeconds:60};}
  };
  registerCustomerRegistrationRoutes(app,deps);
  const body={name:"Alice Test",email:" Hello@Example.com ",password:"12345678",phone:"09171234567",company:"XTECH",address:"Metro Manila"};
  const call=async(overrides={})=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(obj){this.body=obj;return this;}};await routes["/api/auth/register-customer"]({body:{...body,...overrides}},res);return res;};
  return {routes,call,body,collections,issued,uid,auth,db,get created(){return created},get deleted(){return deleted}};
}

test("registers only the original customer registration endpoint",()=>{assert.deepEqual(Object.keys(setup().routes),["/api/auth/register-customer"]);});
test("registration route does not initialize Firebase while registering handlers",()=>{const s=setup({badDomain:true});assert.equal(s.issued.length,0);});
test("rejects invalid full names before account creation",async()=>{const s=setup();const r=await s.call({name:"1"});assert.equal(r.statusCode,400);assert.equal(s.created,null);});
test("rejects malformed email addresses",async()=>{const s=setup();const r=await s.call({email:"bad"});assert.equal(r.statusCode,400);});
test("rejects nonreceiving email domains",async()=>{const s=setup({badDomain:true});const r=await s.call();assert.equal(r.statusCode,400);assert.equal(s.created,null);});
test("rejects invalid Philippine mobile numbers",async()=>{const s=setup();const r=await s.call({phone:"bad"});assert.equal(r.statusCode,400);});
test("rejects overlong optional profile values",async()=>{const s=setup();const r=await s.call({company:"x".repeat(121)});assert.equal(r.statusCode,400);});
test("rejects short passwords before account creation",async()=>{const s=setup();const r=await s.call({password:"123"});assert.equal(r.statusCode,400);});
test("creates pending Firebase Auth, customer and user documents",async()=>{const s=setup();const r=await s.call();assert.equal(r.statusCode,201);assert.equal(r.body.verificationRequired,true);assert.equal(s.created.email,"hello@example.com");assert.equal(s.created.disabled,true);assert.equal(s.collections.customers.get("new-cust-1").registrationPending,true);assert.equal(s.collections.users.get(s.uid).active,false);assert.equal(s.issued[0][2],"registration");});
test("registration never makes account active before email verification",async()=>{const s=setup();await s.call();assert.equal(s.collections.users.get(s.uid).registrationPending,true);assert.equal(s.collections.customers.get("new-cust-1").active,false);});
test("existing completed account yields HTTP 409 without mutation",async()=>{const s=setup({existingUser:true});s.collections.users.set("existing-uid",{active:true,registrationPending:false});const r=await s.call();assert.equal(r.statusCode,409);assert.equal(s.created,null);});
test("pending existing registration resends code and returns HTTP 200",async()=>{const s=setup({existingUser:true});s.collections.users.set("existing-uid",{registrationPending:true});const r=await s.call();assert.equal(r.statusCode,200);assert.equal(r.body.verificationRequired,true);assert.equal(s.issued.length,1);assert.equal(s.created,null);});
test("pending registration resend honors OTP cooldown error",async()=>{const s=setup({existingUser:true,failOtp:true});s.collections.users.set("existing-uid",{registrationPending:true});const err=console.error;console.error=()=>{};try{const r=await s.call();assert.equal(r.statusCode,500);}finally{console.error=err;}});
test("links an existing customer record by email",async()=>{const s=setup();s.collections.customers.set("linked-cust",{email:"hello@example.com",name:"Legacy Customer",company:"Old Co",active:true});const r=await s.call();assert.equal(r.statusCode,201);assert.equal(s.collections.customers.get("linked-cust").userUID,s.uid);assert.equal(s.collections.users.get(s.uid).customerID,"linked-cust");assert.equal(s.collections.customers.size,1);});
test("failed OTP delivery rolls back new Auth account and newly created documents",async()=>{const s=setup({failOtp:true});const err=console.error;console.error=()=>{};try{const r=await s.call();assert.equal(r.statusCode,500);assert.equal(s.deleted,true);assert.equal(s.collections.customers.size,0);assert.equal(s.collections.users.size,0);}finally{console.error=err;}});
test("failed customer linking restores previous customer data",async()=>{const s=setup({failOtp:true});s.collections.customers.set("linked-cust",{email:"hello@example.com",name:"Old Person",active:true});const err=console.error;console.error=()=>{};try{const r=await s.call();assert.equal(r.statusCode,500);assert.equal(s.deleted,true);assert.equal(s.collections.customers.get("linked-cust").name,"Old Person");assert.equal(s.collections.customers.get("linked-cust").active,true);}finally{console.error=err;}});
test("failed Firestore account write deletes Auth and customer records",async()=>{const s=setup({failUserSave:true});const err=console.error;console.error=()=>{};try{const r=await s.call();assert.equal(r.statusCode,500);assert.equal(s.deleted,true);assert.equal(s.collections.customers.size,0);}finally{console.error=err;}});
