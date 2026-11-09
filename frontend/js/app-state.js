"use strict";
// Stage 4.42: shared operational data belongs to one small, per-application store.
// Firebase identity and authentication state remain in app.js.
(function registerAppState(global) {
    function createAppState() {
        const data = {
            products: [],
            transactions: [],
            customers: [],
            pickups: [],
            pickupFormItems: []
        };
        let pendingRequests = 0;

        // Preserve live array references: existing UI modules may mutate form items.
        function getProducts() {
            return data.products;
        }
        function setProducts(value) {
            data.products = value;
        }
        function getTransactions() {
            return data.transactions;
        }
        function setTransactions(value) {
            data.transactions = value;
        }
        function getCustomers() {
            return data.customers;
        }
        function setCustomers(value) {
            data.customers = value;
        }
        function getPickups() {
            return data.pickups;
        }
        function setPickups(value) {
            data.pickups = value;
        }
        function getPickupFormItems() {
            return data.pickupFormItems;
        }
        function setPickupFormItems(value) {
            data.pickupFormItems = value;
        }

        function getPendingRequests() {
            return pendingRequests;
        }
        function adjustPendingRequests(delta) {
            pendingRequests = Math.max(0, pendingRequests + delta);
            return pendingRequests;
        }

        return Object.freeze({
            getProducts,
            setProducts,
            getTransactions,
            setTransactions,
            getCustomers,
            setCustomers,
            getPickups,
            setPickups,
            getPickupFormItems,
            setPickupFormItems,
            getPendingRequests,
            adjustPendingRequests
        });
    }
    global.XTechAppState = Object.freeze({ createAppState });
})(window);
