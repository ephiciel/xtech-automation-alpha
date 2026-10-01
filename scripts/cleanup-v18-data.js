require("dotenv").config();

const { FieldValue } = require("firebase-admin/firestore");
const { db } = require("../backend/firebase");

if (!process.argv.includes("--confirm")) {
    console.log("This cleanup permanently removes legacy monetary fields from old product and sales records.");
    console.log("Run again with: npm.cmd run cleanup:v18 -- --confirm");
    process.exit(0);
}

async function commitInBatches(operations) {
    for (let index = 0; index < operations.length; index += 400) {
        const batch = db.batch();
        for (const operation of operations.slice(index, index + 400)) {
            batch.update(operation.ref, operation.data);
        }
        await batch.commit();
    }
}

async function main() {
    const [productSnap, saleSnap] = await Promise.all([
        db.collection("products").get(),
        db.collection("sales").get()
    ]);

    const productUpdates = [];
    for (const doc of productSnap.docs) {
        const data = doc.data();
        if (Object.prototype.hasOwnProperty.call(data, "price")) {
            productUpdates.push({
                ref: doc.ref,
                data: { price: FieldValue.delete() }
            });
        }
    }

    const saleUpdates = [];
    for (const doc of saleSnap.docs) {
        const data = doc.data();
        const items = Array.isArray(data.items) ? data.items : [];
        let changed = Object.prototype.hasOwnProperty.call(data, "total");
        const cleanedItems = items.map(item => {
            const clean = { ...item };
            if (Object.prototype.hasOwnProperty.call(clean, "unitPrice")) {
                delete clean.unitPrice;
                changed = true;
            }
            if (Object.prototype.hasOwnProperty.call(clean, "lineTotal")) {
                delete clean.lineTotal;
                changed = true;
            }
            return clean;
        });

        if (changed) {
            saleUpdates.push({
                ref: doc.ref,
                data: {
                    total: FieldValue.delete(),
                    items: cleanedItems
                }
            });
        }
    }

    await commitInBatches(productUpdates);
    await commitInBatches(saleUpdates);

    console.log(`Updated ${productUpdates.length} product record(s).`);
    console.log(`Updated ${saleUpdates.length} sales record(s).`);
    console.log("V18 legacy monetary-field cleanup completed.");
}

main().catch(error => {
    console.error("Cleanup failed:", error.message);
    process.exit(1);
});
