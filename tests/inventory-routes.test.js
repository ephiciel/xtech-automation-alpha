"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { registerInventoryRoutes } = require("../backend/routes/inventory.routes");

function setup(overrides = {}) {
    const entries = [];
    const app = {};
    for (const method of ["get", "post", "put", "patch"]) {
        app[method] = (url, ...handlers) => entries.push({ method: method.toUpperCase(), url, handlers });
    }
    const authRequired = (req, res, next) => next();
    const roles = (...allowed) => {
        const guard = (req, res, next) => next();
        guard.allowed = allowed;
        return guard;
    };
    const deps = {
        authRequired,
        roles,
        getDb: () => { throw new Error("Unexpected database access"); },
        now: () => "test-timestamp",
        num: value => { const n = Number(value); return Number.isFinite(n) ? n : 0; },
        serialize: value => value,
        operationalProduct: product => { const copy = { ...product }; delete copy.price; return copy; },
        newDocumentId: () => "audit-1",
        isValidProductID: value => /^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(String(value)),
        isValidProductName: value => String(value).trim().length >= 2 && String(value).trim().length <= 100,
        isValidCategory: value => ["Industrial Chemical", "Janitorial Chemical", "Cleaning Supply", "Other"].includes(value),
        isValidOptionalText: (value, max) => String(value).trim().length <= max,
        isValidPositiveWholeNumber: value => Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 1000000,
        ...overrides
    };
    registerInventoryRoutes(app, deps);
    function handler(method, url) {
        const route = entries.find(r => r.method === method && r.url === url);
        assert.ok(route, `Missing ${method} ${url}`);
        return route.handlers.at(-1);
    }
    return { entries, deps, handler, authRequired };
}
function response() {
    return {
        statusCode: 200, body: null,
        status(code) { this.statusCode = code; return this; },
        json(data) { this.body = data; return this; }
    };
}
const user = { uid: "test-admin", email: "admin@example.test", name: "Test Admin" };
function req(body = {}, params = {}) { return { body, params, user }; }
async function quiet(fn) {
    const previous = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = previous; }
}
function collectionDb(name, value) {
    return {
        collection(requested) {
            assert.equal(requested, name);
            return value;
        }
    };
}
function validProduct(overrides = {}) {
    return {
        productID: "P100", productName: "Floor Cleaner", category: "Cleaning Supply",
        unit: "L", quantity: 5, reorderLevel: 2, description: "For floors", ...overrides
    };
}

test("registers exactly ten product/inventory API routes with original HTTP methods", () => {
    const { entries } = setup();
    assert.deepEqual(entries.map(e => `${e.method} ${e.url}`), [
        "GET /api/products",
        "GET /api/products/archived",
        "GET /api/products/:productID",
        "POST /api/products",
        "PUT /api/products/:productID",
        "PATCH /api/products/:productID/archive",
        "PATCH /api/products/:productID/restore",
        "POST /api/inventory/stock-in",
        "POST /api/inventory/stock-out",
        "GET /api/inventory/transactions"
    ]);
});

test("keeps original role requirements and protects all inventory routes", () => {
    const { entries, authRequired } = setup();
    for (const entry of entries) assert.equal(entry.handlers[0], authRequired);
    assert.equal(entries[0].handlers.length, 2);
    assert.deepEqual(entries[1].handlers[1].allowed, ["admin", "warehouse"]);
    assert.equal(entries[2].handlers.length, 2);
    for (const entry of entries.slice(3, 9)) {
        assert.deepEqual(entry.handlers[1].allowed, ["admin", "warehouse"]);
    }
    assert.deepEqual(entries[9].handlers[1].allowed, ["admin", "warehouse", "secretary"]);
});

test("does not connect to Firebase during route registration", () => {
    setup({ getDb: () => { throw new Error("No startup DB"); } });
});

test("lists active products, strips prices, and sorts by product name", async () => {
    const collection = {
        where(field, cmp, value) { assert.deepEqual([field, cmp, value], ["active", "==", true]); return this; },
        async get() { return { docs: [
            { data: () => validProduct({productID:"P200", productName:"Z Soap", price:99}) },
            { data: () => validProduct({productID:"P100", productName:"A Cleaner", price:50}) }
        ] }; }
    };
    const {handler} = setup({getDb: () => collectionDb("products", collection)});
    const res=response();
    await handler("GET","/api/products")(req(),res);
    assert.equal(res.body.success,true);
    assert.equal(res.body.count,2);
    assert.deepEqual(res.body.products.map(p=>p.productName),["A Cleaner","Z Soap"]);
    assert.ok(res.body.products.every(p=>!("price" in p)));
});

test("active product listing handles Firestore failures safely", async () => {
    const {handler}=setup({getDb:()=>collectionDb("products",{where(){throw Error("private db error");}})});
    const res=response();
    await quiet(()=>handler("GET","/api/products")(req(),res));
    assert.equal(res.statusCode,500);
    assert.equal(res.body.message,"Failed to retrieve products.");
    assert.doesNotMatch(res.body.message,/private db error/);
});

test("lists archived products using the inactive filter", async () => {
    const collection={
        where(field,cmp,value){assert.deepEqual([field,cmp,value],["active","==",false]);return this;},
        async get(){return {docs:[{data:()=>validProduct({active:false,price:100})}]};}
    };
    const {handler}=setup({getDb:()=>collectionDb("products",collection)});
    const res=response();
    await handler("GET","/api/products/archived")(req(),res);
    assert.equal(res.body.products.length,1);
    assert.equal(res.body.products[0].active,false);
    assert.equal(res.body.products[0].price,undefined);
});

test("GET product returns HTTP 404 for missing document", async () => {
    const col={doc(id){assert.equal(id,"P404");return {get:async()=>({exists:false})};}};
    const {handler}=setup({getDb:()=>collectionDb("products",col)});
    const res=response();
    await handler("GET","/api/products/:productID")(req({}, {productID:"P404"}),res);
    assert.equal(res.statusCode,404);
    assert.equal(res.body.message,"Product not found.");
});

test("GET product returns the requested product without monetary fields", async () => {
    const col={doc:()=>({get:async()=>({exists:true,data:()=>validProduct({price:20})})})};
    const {handler}=setup({getDb:()=>collectionDb("products",col)});
    const res=response();
    await handler("GET","/api/products/:productID")(req({}, {productID:"P100"}),res);
    assert.equal(res.body.product.productID,"P100");
    assert.equal(res.body.product.price,undefined);
});

test("POST product rejects invalid identifier before Firestore access", async () => {
    const {handler}=setup();const res=response();
    await handler("POST","/api/products")(req(validProduct({productID:"!"})),res);
    assert.equal(res.statusCode,400);
    assert.match(res.body.message,/Product ID/);
});

test("POST product rejects duplicates without committing a batch", async () => {
    const db={collection:()=>({doc:()=>({get:async()=>({exists:true})})}),batch:()=>{throw Error("unexpected batch");}};
    const {handler}=setup({getDb:()=>db});const res=response();
    await handler("POST","/api/products")(req(validProduct()),res);
    assert.equal(res.statusCode,409);
    assert.match(res.body.message,/already exists/i);
});

test("POST product creates initial-stock audit in the same batch", async () => {
    const writes=[];
    const db={
        collection(name){return {doc(id){return {id, get:async()=>({exists:false})};}};},
        batch(){return {set(ref,data){writes.push([ref.id,data]);},async commit(){writes.push(["commit"]);}};}
    };
    const {handler}=setup({getDb:()=>db});const res=response();
    await handler("POST","/api/products")(req(validProduct({quantity:5})),res);
    assert.equal(res.statusCode,201);
    assert.deepEqual(writes.map(([id])=>id),["P100","audit-1","commit"]);
    assert.equal(writes[1][1].type,"INITIAL_STOCK");
    assert.equal(writes[1][1].previousQuantity,0);
    assert.equal(writes[1][1].newQuantity,5);
    assert.equal(writes[1][1].userId,"test-admin");
    assert.equal(res.body.product.quantity,5);
});

test("POST product with zero initial stock does not create audit transaction", async () => {
    const writes=[];
    const db={collection:()=>({doc:id=>({id,get:async()=>({exists:false})})}),
        batch:()=>({set:(ref)=>writes.push(ref.id),commit:async()=>{}})};
    const {handler}=setup({getDb:()=>db});const res=response();
    await handler("POST","/api/products")(req(validProduct({quantity:0})),res);
    assert.equal(res.statusCode,201);
    assert.deepEqual(writes,["P100"]);
});

test("PUT product rejects direct quantity edits to preserve inventory audit", async () => {
    let updated=false;
    const col={doc:()=>({get:async()=>({exists:true,data:()=>validProduct()}),update:async()=>{updated=true;}})};
    const {handler}=setup({getDb:()=>collectionDb("products",col)});const res=response();
    await handler("PUT","/api/products/:productID")(req(validProduct({quantity:9}),{productID:"P100"}),res);
    assert.equal(res.statusCode,400);
    assert.match(res.body.message,/Stock In\/Stock Out/);
    assert.equal(updated,false);
});

test("PUT product rejects archived records", async () => {
    let updated=false;
    const col={doc:()=>({get:async()=>({exists:true,data:()=>validProduct({active:false})}),update:async()=>{updated=true;}})};
    const {handler}=setup({getDb:()=>collectionDb("products",col)});const res=response();
    await handler("PUT","/api/products/:productID")(req(validProduct(),{productID:"P100"}),res);
    assert.equal(res.statusCode,400);
    assert.match(res.body.message,/Archived products/);
    assert.equal(updated,false);
});

test("PUT product updates details without changing stock quantity", async () => {
    const updates=[];
    const col={doc:()=>({get:async()=>({exists:true,data:()=>validProduct({active:true})}),update:async data=>updates.push(data)})};
    const {handler}=setup({getDb:()=>collectionDb("products",col)});const res=response();
    await handler("PUT","/api/products/:productID")(req(validProduct({quantity:5, productName:"Fresh Cleaner"}),{productID:"P100"}),res);
    assert.equal(res.statusCode,200);
    assert.equal(updates[0].productName,"Fresh Cleaner");
    assert.ok(!Object.hasOwn(updates[0],"quantity"));
    assert.equal(updates[0].updatedAt,"test-timestamp");
});

test("PATCH product archive and restore preserve original status updates", async () => {
    const updates=[];
    const doc={get:async()=>({exists:true}),update:async data=>updates.push(data)};
    const col={doc:()=>doc};const {handler}=setup({getDb:()=>collectionDb("products",col)});
    const archive=response(), restore=response();
    await handler("PATCH","/api/products/:productID/archive")(req({}, {productID:"P100"}),archive);
    await handler("PATCH","/api/products/:productID/restore")(req({}, {productID:"P100"}),restore);
    assert.equal(archive.body.success,true);assert.equal(restore.body.success,true);
    assert.deepEqual(updates[0],{active:false,archivedAt:"test-timestamp",updatedAt:"test-timestamp"});
    assert.deepEqual(updates[1],{active:true,archivedAt:null,updatedAt:"test-timestamp"});
});

function stockDb(previous, { archived = false, fail = false } = {}) {
    const writes=[];
    const productRef={id:"P100"}, auditRef={id:"audit-1"};
    const db={
        collection(name){return {doc(id){assert.equal(id,name==="products"?"P100":"audit-1");return name==="products"?productRef:auditRef;}};},
        async runTransaction(fn){
            const trx={
                async get(ref){assert.equal(ref,productRef);return {exists:true,data:()=>validProduct({quantity:previous,active:!archived})};},
                update(ref,data){writes.push({method:"update",ref,data});},
                set(ref,data){writes.push({method:"set",ref,data});}
            };
            if (fail) throw Error("db transaction failed");
            return fn(trx);
        }
    };
    return {db,writes};
}

test("stock-in transaction increases stock and writes audit record", async () => {
    const {db,writes}=stockDb(10);const {handler}=setup({getDb:()=>db});const res=response();
    await handler("POST","/api/inventory/stock-in")(req({productID:"P100",quantity:5,reason:"Restock"}),res);
    assert.equal(res.body.success,true);
    assert.equal(res.body.product.previousQuantity,10);
    assert.equal(res.body.product.newQuantity,15);
    assert.equal(res.body.transactionID,"audit-1");
    assert.equal(writes[0].method,"update");assert.equal(writes[0].data.quantity,15);
    assert.equal(writes[1].method,"set");assert.equal(writes[1].data.type,"STOCK_IN");
});

test("stock-out transaction rejects insufficient quantity without writing", async () => {
    const {db,writes}=stockDb(3);const {handler}=setup({getDb:()=>db});const res=response();
    await quiet(()=>handler("POST","/api/inventory/stock-out")(req({productID:"P100",quantity:5,reason:"Dispatch"}),res));
    assert.equal(res.statusCode,400);
    assert.match(res.body.message,/Insufficient stock/);
    assert.equal(writes.length,0);
});

test("stock-out transaction deducts available stock and saves audit record", async () => {
    const {db,writes}=stockDb(10);const {handler}=setup({getDb:()=>db});const res=response();
    await handler("POST","/api/inventory/stock-out")(req({productID:"P100",quantity:6,reason:"Dispatch"}),res);
    assert.equal(res.body.product.newQuantity,4);
    assert.equal(writes[0].data.quantity,4);
    assert.equal(writes[1].data.type,"STOCK_OUT");
    assert.equal(writes[1].data.previousQuantity,10);
    assert.equal(writes[1].data.newQuantity,4);
});

test("stock changes reject archived products without writing", async () => {
    const {db,writes}=stockDb(10,{archived:true});const {handler}=setup({getDb:()=>db});const res=response();
    await quiet(()=>handler("POST","/api/inventory/stock-in")(req({productID:"P100",quantity:2,reason:"Restock"}),res));
    assert.equal(res.statusCode,400);
    assert.match(res.body.message,/archived product/);
    assert.equal(writes.length,0);
});

test("stock changes reject invalid quantities before reaching database", async () => {
    const {handler}=setup();const res=response();
    await handler("POST","/api/inventory/stock-in")(req({productID:"P100",quantity:-2,reason:"Restock"}),res);
    assert.equal(res.statusCode,400);
    assert.match(res.body.message,/positive whole number/);
});

test("inventory transactions history sorts newest first and limits 1000", async () => {
    const calls=[];
    const col={orderBy(...args){calls.push(["orderBy",...args]);return this;},
        limit(n){calls.push(["limit",n]);return this;},
        async get(){return {docs:[{id:"tr1",data:()=>({type:"STOCK_IN",quantity:2})}]};}};
    const {handler}=setup({getDb:()=>collectionDb("inventoryTransactions",col)});const res=response();
    await handler("GET","/api/inventory/transactions")(req(),res);
    assert.deepEqual(calls,[["orderBy","createdAt","desc"],["limit",1000]]);
    assert.deepEqual(res.body.transactions,[{id:"tr1",type:"STOCK_IN",quantity:2}]);
});
