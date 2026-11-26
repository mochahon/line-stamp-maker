/* Tiny IndexedDB wrapper: one database, one key-value store.
 * Used to persist the whole project (images as Blobs) locally on the device.
 * Nothing ever leaves the browser. */
(function (global) {
  'use strict';
  var DB_NAME = 'line-stamp-maker';
  var STORE = 'kv';
  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(STORE, mode);
        var store = t.objectStore(STORE);
        var result;
        fn(store, function (v) { result = v; });
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  global.StampDB = {
    get: function (key) {
      return tx('readonly', function (store, done) {
        var r = store.get(key);
        r.onsuccess = function () { done(r.result); };
      });
    },
    set: function (key, value) {
      return tx('readwrite', function (store) { store.put(value, key); });
    },
    remove: function (key) {
      return tx('readwrite', function (store) { store.delete(key); });
    }
  };
})(window);
