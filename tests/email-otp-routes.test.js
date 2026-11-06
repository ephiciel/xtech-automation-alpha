"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {registerEmailOtpRoutes}=require("../backend/routes/email-otp.routes");

function setup(options={}) {
  const routes={};
  const app={post:(url,...handlers)=>{routes[url]=handlers.at(-1);}};
  const stores={users:new Map(),customers:new Map(),emailOtpChallenges:new Map()};
  const sent=[];const authCalls=[];
  const user={uid:"uid-1",email:"hello@example.com",disabled:false,emailVerified:false};
  const clock={now:Date.now()};
  const stamp=ms=>({toMillis:()=>ms});
  const doc=(collection,id)=>({
    id,
    get:async()=>{if(options.offline)throw new Error("Offline");const v=stores[collection].get(id);return {exists:!!v,id,data:()=>v};},
    set:async(v,opts)=>{const old=stores[collection].get(id)||{};stores[collection].set(id,opts?.merge?{...old,...v}:v);},
    update:async(v)=>stores[collection].set(id,{...stores[collection].get(id),...v}),
    delete:async()=>stores[collection].delete(id)
  });
  const db={collection:name=>({doc:id=>doc(name,id)}),runTransaction:async fn=>fn({get:ref=>ref.get(),set:(ref,v)=>ref.set(v),update:(ref,v)=>ref.update(v),delete:ref=>ref.delete()})};
  const auth={
    getUserByEmail:async email=>{if(options.notFound)throw Object.assign(new Error("missing"),{code:"auth/user-not-found"});assert.equal(email,user.email);return user;},
    getUser:async()=>user,
    updateUser:async(uid,v)=>{authCalls.push({uid,...v});return Object.assign(user,v);},
    createCustomToken:async(uid,claims)=>{authCalls.push({customToken:true,uid,claims});return "fake-custom-token";}
  };
  const deps={getDb:()=>db,getAuth:()=>auth,getTimestamp:()=>({fromMillis:stamp}),now:()=>stamp(Date.now()),
    normalizedEmail:x=>String(x||"").trim().toLowerCase(),
    isValidEmailAddress:x=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x),
    createOtpHash:()=>({salt:"s",hash:"h"}),emailChallengeId:email=>"otp-"+email,
    generateOtpCode:()=>"123456",maskEmail:()=>"h***@example.com",
    otpExpiryMinutes:()=>10,otpResendSeconds:()=>60,
    sendOtpEmail:async(...args)=>{if(options.mailError)throw new Error("Email provider failed");sent.push(args);},
    verifyOtpHash:code=>code==="123456"
  };
  const issueEmailOtp=registerEmailOtpRoutes(app,deps);
  const call=async(url,body={})=>{const res={statusCode:200,status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;}};await routes[url]({body},res);return res;};
  return {routes,stores,sent,authCalls,user,clock,stamp,call,issueEmailOtp,db,auth};
}
const REQUEST="/api/auth/email-otp/request",VERIFY="/api/auth/email-otp/verify";
const seedChallenge=(s,v={})=>s.stores.emailOtpChallenges.set("otp-hello@example.com",{
  uid:"uid-1",email:"hello@example.com",purpose:"signin",salt:"s",codeHash:"h",attemptsRemaining:5,
  expiresAt:s.stamp(Date.now()+600_000),lastSentAt:s.stamp(Date.now()-120_000),...v
});

test("registers the two existing unauthenticated email OTP endpoints",()=>{const s=setup();assert.deepEqual(Object.keys(s.routes),[REQUEST,VERIFY]);});
test("route registration does not initialize Firebase or send email",()=>{const s=setup({offline:true});assert.equal(s.sent.length,0);});
test("OTP helper is available to customer registration",()=>{assert.equal(typeof setup().issueEmailOtp,"function");});
test("request validates email before Firebase access",async()=>{const s=setup({offline:true});const r=await s.call(REQUEST,{email:"bad"});assert.equal(r.statusCode,400);});
test("request normalizes email and sends challenge with five attempts",async()=>{const s=setup();const r=await s.call(REQUEST,{email:" HELLO@EXAMPLE.COM "});assert.equal(r.statusCode,200);assert.equal(s.sent.length,1);assert.equal(s.sent[0][2],"signin");assert.equal(s.stores.emailOtpChallenges.get("otp-hello@example.com").attemptsRemaining,5);assert.equal(r.body.registrationPending,false);});
test("pending registration uses registration code purpose",async()=>{const s=setup();s.stores.users.set("uid-1",{registrationPending:true,active:false});const r=await s.call(REQUEST,{email:"hello@example.com"});assert.equal(r.body.registrationPending,true);assert.equal(s.sent[0][2],"registration");});
test("inactive existing user cannot request a sign-in code",async()=>{const s=setup();s.stores.users.set("uid-1",{active:false});const r=await s.call(REQUEST,{email:"hello@example.com"});assert.equal(r.statusCode,403);assert.equal(s.sent.length,0);});
test("unknown account returns 404",async()=>{const s=setup({notFound:true});const r=await s.call(REQUEST,{email:"hello@example.com"});assert.equal(r.statusCode,404);});
test("request enforces resend cooldown",async()=>{const s=setup();seedChallenge(s,{lastSentAt:s.stamp(Date.now())});const r=await s.call(REQUEST,{email:"hello@example.com"});assert.equal(r.statusCode,429);assert.equal(s.sent.length,0);assert.ok(r.body.retryAfterSeconds>0);});
test("email provider failure removes the stored challenge",async()=>{const s=setup({mailError:true});const previous=console.error;console.error=()=>{};try{const r=await s.call(REQUEST,{email:"hello@example.com"});assert.equal(r.statusCode,500);assert.equal(s.stores.emailOtpChallenges.size,0);}finally{console.error=previous;}});
test("verify validates six-digit code before touching Firestore",async()=>{const s=setup({offline:true});const r=await s.call(VERIFY,{email:"hello@example.com",code:"123"});assert.equal(r.statusCode,400);});
test("verify refuses a missing challenge",async()=>{const s=setup();const r=await s.call(VERIFY,{email:"hello@example.com",code:"123456"});assert.equal(r.statusCode,400);});
test("verify deletes an expired challenge",async()=>{const s=setup();seedChallenge(s,{expiresAt:s.stamp(Date.now()-1000)});const r=await s.call(VERIFY,{email:"hello@example.com",code:"123456"});assert.equal(r.statusCode,400);assert.equal(s.stores.emailOtpChallenges.size,0);});
test("verify decrements attempts for incorrect code",async()=>{const s=setup();seedChallenge(s);const r=await s.call(VERIFY,{email:"hello@example.com",code:"333333"});assert.equal(r.statusCode,400);assert.equal(s.stores.emailOtpChallenges.get("otp-hello@example.com").attemptsRemaining,4);});
test("verify locks challenge on last incorrect attempt",async()=>{const s=setup();seedChallenge(s,{attemptsRemaining:1});const r=await s.call(VERIFY,{email:"hello@example.com",code:"333333"});assert.equal(r.statusCode,429);assert.equal(s.stores.emailOtpChallenges.size,0);});
test("successful sign-in returns a custom token and consumes challenge",async()=>{const s=setup();seedChallenge(s);const r=await s.call(VERIFY,{email:"hello@example.com",code:"123456"});assert.equal(r.statusCode,200);assert.equal(r.body.customToken,"fake-custom-token");assert.equal(r.body.registrationCompleted,false);assert.equal(s.stores.emailOtpChallenges.size,0);});
test("verified pending registration activates linked customer and Firebase user",async()=>{const s=setup();seedChallenge(s,{purpose:"registration"});s.stores.users.set("uid-1",{registrationPending:true,active:false,customerID:"cust-1"});s.stores.customers.set("cust-1",{registrationPending:true,active:false});const r=await s.call(VERIFY,{email:"hello@example.com",code:"123456"});assert.equal(r.statusCode,200);assert.equal(r.body.registrationCompleted,true);assert.equal(s.stores.users.get("uid-1").active,true);assert.equal(s.stores.customers.get("cust-1").active,true);assert.equal(s.user.emailVerified,true);});
test("disabled user is rejected after consuming valid sign-in challenge",async()=>{const s=setup();seedChallenge(s);s.user.disabled=true;const r=await s.call(VERIFY,{email:"hello@example.com",code:"123456"});assert.equal(r.statusCode,403);});
