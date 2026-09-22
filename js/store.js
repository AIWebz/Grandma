/*
 * Grandma AI — local-first data store.
 *
 * All app data lives in memory, is persisted to IndexedDB on this device, and
 * (when Supabase is configured and the user is signed in) is synced to the
 * cloud by js/account.js.
 *
 * Two shapes of data:
 *   - "docs": a single object (profile, settings, conversation transcripts)
 *   - "collections": arrays of items with {id, createdAt, updatedAt, deleted?}
 * Collections merge item-by-item (last write wins per item, deletes are
 * tombstones) so two devices can edit different items without clobbering.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const U = GA.U;

  /* ---------------- IndexedDB wrapper ---------------- */
  const DB_NAME = "grandma-ai";
  let dbp = null;
  const memFallback = { kv: new Map(), media: new Map() };
  let useMem = false;

  function openDB() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        useMem = true;
        return resolve(null);
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        useMem = true;
        resolve(null);
      };
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const db = await openDB();
    if (!db || useMem) return fn(null, memFallback[store]);
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const os = t.objectStore(store);
      const r = fn(os);
      t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }

  const DB = {
    get: (k) => tx("kv", "readonly", (os, m) => (os ? os.get(k) : { result: m.get(k) })),
    set: (k, v) => tx("kv", "readwrite", (os, m) => (os ? os.put(v, k) : m.set(k, v))),
    del: (k) => tx("kv", "readwrite", (os, m) => (os ? os.delete(k) : m.delete(k))),
    keys: () => tx("kv", "readonly", (os, m) => (os ? os.getAllKeys() : { result: [...m.keys()] })),
    putMedia: (id, blob) => tx("media", "readwrite", (os, m) => (os ? os.put(blob, id) : m.set(id, blob))),
    getMedia: (id) => tx("media", "readonly", (os, m) => (os ? os.get(id) : { result: m.get(id) })),
    delMedia: (id) => tx("media", "readwrite", (os, m) => (os ? os.delete(id) : m.delete(id))),
    clear: async () => {
      await tx("kv", "readwrite", (os, m) => (os ? os.clear() : m.clear()));
      await tx("media", "readwrite", (os, m) => (os ? os.clear() : m.clear()));
    },
  };

  /* ---------------- defaults ---------------- */
  const DEFAULTS = {
    profile: { name: "", email: "", personality: "warm", onboarded: false },
    settings: {
      theme: "system",
      memoryEnabled: true,
      voice: { input: true, replies: false, voiceURI: "", rate: 1 },
      notifications: {
        enabled: false,
        frequency: "normal", // off | light | normal
        daily: true,
        dailyTime: "08:30",
        tasks: true,
        recipes: true,
        dinnerTime: "17:00",
      },
    },
    // Never synced: device-only values.
    local: { ollama: { url: "http://localhost:11434", model: "llama3.1:8b", visionModel: "", ready: false }, usage: { date: "", count: 0 }, bonus: { date: "", count: 0 }, lastInterstitial: 0, sidebarCollapsed: false, notified: {} },
    subscription: { plan: "free", status: "active", period: "", renewsAt: null, source: "" },
    household: { id: "", name: "", inviteCode: "", role: "" },
  };

  const DOC_KEYS = ["profile", "settings", "local", "subscription", "household"];
  const COLLECTION_KEYS = ["memory", "tasks", "htasks", "grocery", "plan", "recipes", "family", "conversations"];
  const LOCAL_ONLY = new Set(["local", "subscription", "household"]);
  // Collections that live with the household (when the user belongs to one).
  const SHARED_KEYS = new Set(["htasks", "grocery", "family"]);

  const state = {};
  const listeners = new Map();
  const pendingWrites = new Set();
  const dirty = new Set();

  const deepMerge = (base, patch) => {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [k, v] of Object.entries(patch || {})) {
      if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object" && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  };

  const flush = U.debounce(async () => {
    const keys = [...pendingWrites];
    pendingWrites.clear();
    for (const k of keys) {
      try {
        await DB.set(k, state[k]);
      } catch (e) {
        console.warn("Could not save", k, e);
      }
    }
  }, 150);

  function touched(key) {
    pendingWrites.add(key);
    flush();
    if (!LOCAL_ONLY.has(key)) {
      dirty.add(key);
      Store.onDirty && Store.onDirty(key);
    }
    emit(key);
  }

  function emit(key) {
    for (const k of [key, key.startsWith("conv:") ? "conv:*" : null, "*"]) {
      if (!k) continue;
      const set = listeners.get(k);
      if (set) set.forEach((fn) => { try { fn(key); } catch (e) { console.error(e); } });
    }
  }

  const Store = {
    DB,
    DOC_KEYS,
    COLLECTION_KEYS,
    SHARED_KEYS,
    LOCAL_ONLY,
    dirty,
    state,

    async init() {
      await openDB();
      for (const k of DOC_KEYS) {
        const v = await DB.get(k).catch(() => null);
        state[k] = deepMerge(DEFAULTS[k], v || {});
      }
      for (const k of COLLECTION_KEYS) {
        const v = await DB.get(k).catch(() => null);
        const cutoff = Date.now() - 30 * 86400000;
        state[k] = (Array.isArray(v) ? v : []).filter((i) => !(i.deleted && i.updatedAt < cutoff));
      }
      const keys = (await DB.keys().catch(() => [])) || [];
      for (const k of keys) {
        if (String(k).startsWith("conv:")) state[k] = await DB.get(k);
      }
      const d = await DB.get("__dirty").catch(() => null);
      (d || []).forEach((k) => dirty.add(k));
    },

    on(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => listeners.get(key).delete(fn);
    },
    emit,

    /* ----- docs ----- */
    doc(key) {
      return state[key] || DEFAULTS[key] || {};
    },
    setDoc(key, patch) {
      state[key] = deepMerge(state[key] || DEFAULTS[key] || {}, patch);
      state[key].updatedAt = Date.now();
      touched(key);
      return state[key];
    },
    replaceDoc(key, value, { silentSync = false } = {}) {
      state[key] = value;
      pendingWrites.add(key);
      flush();
      if (!silentSync && !LOCAL_ONLY.has(key)) dirty.add(key);
      emit(key);
    },

    /* ----- collections ----- */
    list(key) {
      return (state[key] || []).filter((i) => !i.deleted);
    },
    find(key, id) {
      return (state[key] || []).find((i) => i.id === id && !i.deleted) || null;
    },
    add(key, item) {
      const now = Date.now();
      const full = { createdAt: now, ...item, id: item.id || U.uid(key.slice(0, 2) + "_"), updatedAt: now };
      state[key] = state[key] || [];
      state[key].push(full);
      touched(key);
      return full;
    },
    addMany(key, items) {
      const now = Date.now();
      const made = items.map((item, i) => ({ createdAt: now + i, ...item, id: item.id || U.uid(key.slice(0, 2) + "_"), updatedAt: now }));
      state[key] = (state[key] || []).concat(made);
      touched(key);
      return made;
    },
    update(key, id, patch) {
      const it = (state[key] || []).find((i) => i.id === id);
      if (!it) return null;
      Object.assign(it, patch, { updatedAt: Date.now() });
      touched(key);
      return it;
    },
    remove(key, id) {
      const arr = state[key] || [];
      const idx = arr.findIndex((i) => i.id === id);
      if (idx < 0) return false;
      arr[idx] = { id, deleted: true, createdAt: arr[idx].createdAt, updatedAt: Date.now() };
      touched(key);
      return true;
    },
    /* Assigns an explicit sort order to the given ids. */
    reorder(key, ids) {
      const now = Date.now();
      ids.forEach((id, i) => {
        const it = (state[key] || []).find((x) => x.id === id);
        if (it) {
          it.order = i;
          it.updatedAt = now;
        }
      });
      touched(key);
    },

    /* Tasks can live in the personal list or the shared household list. */
    findTask(id) {
      for (const key of ["tasks", "htasks"]) {
        const t = Store.find(key, id);
        if (t) return { key, task: t };
      }
      return null;
    },
    allTasks() {
      return Store.list("tasks").concat(Store.list("htasks").map((t) => ({ ...t, shared: true })));
    },

    /* ----- conversations ----- */
    conv(id) {
      return state["conv:" + id] || { messages: [], api: [] };
    },
    saveConv(id, data) {
      state["conv:" + id] = { ...data, updatedAt: Date.now() };
      touched("conv:" + id);
    },
    async deleteConv(id) {
      Store.remove("conversations", id);
      delete state["conv:" + id];
      await DB.del("conv:" + id).catch(() => {});
      dirty.add("conv:" + id);
      Store.onDirty && Store.onDirty("conv:" + id);
    },

    /* ----- merging remote (cloud) data ----- */
    mergeRemote(key, remote) {
      if (remote == null) return false;
      if (COLLECTION_KEYS.includes(key)) {
        const local = state[key] || [];
        const byId = new Map(local.map((i) => [i.id, i]));
        let changed = false;
        for (const r of Array.isArray(remote) ? remote : []) {
          const l = byId.get(r.id);
          if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) {
            byId.set(r.id, r);
            changed = true;
          }
        }
        if (changed) {
          state[key] = [...byId.values()];
          pendingWrites.add(key);
          flush();
          emit(key);
        }
        // If we have items the remote lacks (or newer ones), push back.
        const remoteById = new Map((remote || []).map((i) => [i.id, i]));
        if (state[key].some((l) => !remoteById.has(l.id) || (l.updatedAt || 0) > (remoteById.get(l.id).updatedAt || 0))) dirty.add(key);
        return changed;
      }
      const local = state[key];
      if (remote && remote.__deleted) {
        if (local) {
          delete state[key];
          DB.del(key).catch(() => {});
          emit(key);
        }
        return true;
      }
      if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
        state[key] = DOC_KEYS.includes(key) ? deepMerge(DEFAULTS[key] || {}, remote) : remote;
        pendingWrites.add(key);
        flush();
        emit(key);
        return true;
      }
      if ((local.updatedAt || 0) > (remote.updatedAt || 0)) dirty.add(key);
      return false;
    },

    persistDirty: U.debounce(() => DB.set("__dirty", [...dirty]).catch(() => {}), 300),

    exportAll() {
      const out = {};
      for (const [k, v] of Object.entries(state)) {
        if (k === "local") continue;
        out[k] = v;
      }
      return out;
    },

    async wipe() {
      for (const k of Object.keys(state)) delete state[k];
      dirty.clear();
      await DB.clear();
      for (const k of DOC_KEYS) state[k] = deepMerge(DEFAULTS[k], {});
      for (const k of COLLECTION_KEYS) state[k] = [];
      emit("*");
    },
  };

  GA.Store = Store;
})();
