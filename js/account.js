/*
 * Grandma AI — accounts and cloud sync (Supabase, loaded from a CDN only when
 * configured; no package manager involved).
 *
 * Without Supabase the app runs in "this device only" mode: everything is
 * stored in IndexedDB on the device and nothing leaves it except AI requests.
 */
(function () {
  "use strict";
  const GA = window.GA;
  const { U, Store } = GA;
  const CFG = (window.GRANDMA_CONFIG || {}).supabase || {};
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

  let client = null;
  let session = null;
  let syncing = false;
  let pushTimer = null;
  let pullTimer = null;

  const loadScript = (src) =>
    new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.crossOrigin = "anonymous";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.head.appendChild(s);
    });

  const Account = {
    configured: () => Boolean(CFG.url && CFG.anonKey),
    signedIn: () => Boolean(session && session.user),
    userId: () => (session && session.user ? session.user.id : null),
    email: () => (session && session.user ? session.user.email : ""),
    accessToken: () => (session ? session.access_token : null),
    client: () => client,

    async init() {
      if (!Account.configured()) return;
      try {
        if (!window.supabase) await loadScript(SUPABASE_CDN);
        client = window.supabase.createClient(CFG.url, CFG.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        const { data } = await client.auth.getSession();
        session = data.session;
        client.auth.onAuthStateChange((event, s) => {
          const was = Account.userId();
          session = s;
          if (s && s.user && s.user.id !== was) Account.afterSignIn();
          if (!s && was) GA.App && GA.App.refreshAll();
        });
        if (session) Account.afterSignIn();
      } catch (e) {
        console.warn("Supabase unavailable:", e);
      }
      Store.onDirty = () => {
        Store.persistDirty();
        Account.schedulePush();
      };
      window.addEventListener("focus", () => Account.signedIn() && Account.pull());
      window.addEventListener("online", () => Account.signedIn() && Account.push());
    },

    async afterSignIn() {
      const user = session.user;
      const profile = Store.doc("profile");
      const meta = user.user_metadata || {};
      Store.setDoc("profile", {
        email: user.email || profile.email,
        name: profile.name || meta.full_name || meta.name || "",
      });
      await Account.refreshSubscription();
      await Account.refreshHousehold();
      await Account.pull();
      // Anything created before signing in should reach the cloud too.
      Store.COLLECTION_KEYS.concat(["profile", "settings"]).forEach((k) => Store.dirty.add(k));
      Object.keys(Store.state).filter((k) => k.startsWith("conv:")).forEach((k) => Store.dirty.add(k));
      Account.schedulePush();
      clearInterval(pullTimer);
      pullTimer = setInterval(() => document.visibilityState === "visible" && Account.pull(), 60000);
      GA.App && GA.App.refreshAll();
    },

    /* ---------- auth actions ---------- */
    async signUp(email, password, name) {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: { data: { full_name: name || "" }, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
      if (name) Store.setDoc("profile", { name });
      return data;
    },
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signInWithGoogle() {
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: location.origin + location.pathname },
      });
      if (error) throw error;
    },
    async resetPassword(email) {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
    },
    async signOut({ skipPush = false } = {}) {
      clearInterval(pullTimer);
      if (!skipPush) await Account.push().catch(() => {});
      if (client) await client.auth.signOut().catch(() => {});
      session = null;
      // Keep this device clean once someone signs out.
      await Store.wipe();
    },
    async deleteAccountData() {
      if (!Account.signedIn()) return;
      const uid = Account.userId();
      await client.from("user_data").delete().eq("user_id", uid);
      const { data: files } = await client.storage.from("media").list(uid, { limit: 1000 });
      if (files && files.length) await client.storage.from("media").remove(files.map((f) => `${uid}/${f.name}`));
      // Removes the sign-in itself (and, by cascade, the subscription row).
      await client.rpc("delete_my_account");
    },

    /* ---------- subscription (written only by payment webhooks) ---------- */
    async refreshSubscription() {
      if (!Account.signedIn()) return;
      const { data, error } = await client
        .from("subscriptions")
        .select("plan,status,period,current_period_end,source")
        .eq("user_id", Account.userId())
        .maybeSingle();
      if (error) return;
      if (data) {
        Store.setDoc("subscription", {
          plan: data.plan,
          status: data.status,
          period: data.period || "",
          renewsAt: data.current_period_end,
          source: data.source || "",
        });
      } else {
        Store.setDoc("subscription", { plan: "free", status: "active", period: "", renewsAt: null, source: "" });
      }
    },

    /* ---------- household (Grandma Pro sharing) ---------- */
    async refreshHousehold() {
      if (!Account.signedIn()) return;
      const { data } = await client
        .from("household_members")
        .select("role, households(id,name,invite_code)")
        .eq("user_id", Account.userId())
        .maybeSingle();
      if (data && data.households) {
        Store.replaceDoc("household", { id: data.households.id, name: data.households.name, inviteCode: data.households.invite_code, role: data.role });
      } else {
        Store.replaceDoc("household", { id: "", name: "", inviteCode: "", role: "" });
      }
    },
    async createHousehold(name) {
      const { data, error } = await client.rpc("create_household", { p_name: name });
      if (error) throw error;
      await Account.refreshHousehold();
      Store.SHARED_KEYS.forEach((k) => Store.dirty.add(k));
      await Account.push();
      return data;
    },
    async joinHousehold(code) {
      const { error } = await client.rpc("join_household", { p_code: code.trim().toUpperCase() });
      if (error) throw error;
      await Account.refreshHousehold();
      await Account.pull();
    },
    async leaveHousehold() {
      const { error } = await client.rpc("leave_household");
      if (error) throw error;
      await Account.refreshHousehold();
    },
    householdId: () => Store.doc("household").id || "",

    /* ---------- sync ---------- */
    target(key) {
      const hid = Account.householdId();
      if (hid && Store.SHARED_KEYS.has(key)) return { table: "household_data", col: "household_id", id: hid };
      return { table: "user_data", col: "user_id", id: Account.userId() };
    },

    async pull() {
      if (!Account.signedIn() || syncing) return;
      syncing = true;
      try {
        const { data, error } = await client.from("user_data").select("key,value,updated_at").eq("user_id", Account.userId());
        if (error) throw error;
        const hid = Account.householdId();
        let shared = [];
        if (hid) {
          const res = await client.from("household_data").select("key,value,updated_at").eq("household_id", hid);
          if (!res.error) shared = res.data || [];
        }
        for (const row of data || []) {
          if (hid && Store.SHARED_KEYS.has(row.key)) continue;
          Store.mergeRemote(row.key, row.value);
        }
        for (const row of shared) Store.mergeRemote(row.key, row.value);
        if (Store.dirty.size) Account.schedulePush();
      } catch (e) {
        console.warn("Sync pull failed", e);
      } finally {
        syncing = false;
      }
    },

    schedulePush() {
      if (!Account.signedIn()) return;
      clearTimeout(pushTimer);
      pushTimer = setTimeout(() => Account.push(), 1500);
    },

    async push() {
      if (!Account.signedIn() || !navigator.onLine) return;
      const keys = [...Store.dirty].filter((k) => !Store.LOCAL_ONLY.has(k));
      for (const key of keys) {
        const value = Store.state[key] === undefined && key.startsWith("conv:") ? { __deleted: true, updatedAt: Date.now() } : Store.state[key];
        if (value === undefined) {
          Store.dirty.delete(key);
          continue;
        }
        const t = Account.target(key);
        const row = { [t.col]: t.id, key, value, updated_at: new Date().toISOString() };
        const { error } = await client.from(t.table).upsert(row, { onConflict: `${t.col},key` });
        if (!error) Store.dirty.delete(key);
        else console.warn("Sync push failed for", key, error.message);
      }
      Store.persistDirty();
    },

    /* ---------- media (photos of recipes etc.) ---------- */
    async uploadMedia(id, blob) {
      if (!Account.signedIn()) return null;
      const hid = Account.householdId();
      const path = hid ? `h/${hid}/${id}.jpg` : `${Account.userId()}/${id}.jpg`;
      const { error } = await client.storage.from("media").upload(path, blob, { upsert: true, contentType: blob.type || "image/jpeg" });
      if (error) {
        console.warn("Upload failed", error.message);
        return null;
      }
      return path;
    },
    async downloadMedia(path) {
      if (!Account.signedIn() || !path) return null;
      const { data, error } = await client.storage.from("media").download(path);
      return error ? null : data;
    },
  };

  /* Resolve an image for display: local IndexedDB first, then the cloud. */
  const urlCache = new Map();
  Account.mediaURL = async (media) => {
    if (!media || !media.id) return "";
    if (urlCache.has(media.id)) return urlCache.get(media.id);
    let blob = await Store.DB.getMedia(media.id).catch(() => null);
    if (!blob && media.path) {
      blob = await Account.downloadMedia(media.path);
      if (blob) await Store.DB.putMedia(media.id, blob).catch(() => {});
    }
    if (!blob) return "";
    const url = URL.createObjectURL(blob);
    urlCache.set(media.id, url);
    return url;
  };

  /* Store a new image locally (and in the cloud when signed in). */
  Account.saveMedia = async (file, maxDim = 1600) => {
    const blob = await U.resizeImage(file, maxDim, 0.85);
    const id = U.uid("m_");
    await Store.DB.putMedia(id, blob);
    const path = await Account.uploadMedia(id, blob);
    return { id, path: path || "", type: "image/jpeg", blob };
  };

  /* Fill <img data-media-id> elements inside a container. */
  Account.hydrateImages = (root) => {
    U.$$("img[data-media-id]", root).forEach(async (img) => {
      if (img.dataset.loaded) return;
      img.dataset.loaded = "1";
      const url = await Account.mediaURL({ id: img.dataset.mediaId, path: img.dataset.mediaPath });
      if (url) img.src = url;
      else img.closest(".media-frame") && img.closest(".media-frame").classList.add("missing");
    });
  };

  GA.Account = Account;
})();
