/* Trazo · conexión con Supabase
   Ofrece a la app la misma forma de trabajo que tenía en Claude:
   db.doc("ruta").get/set/update/delete/onSnapshot y db.collection("ruta").onSnapshot,
   guardando cada documento como una fila de la tabla "documentos". */
(function () {
  const cfg = window.TRAZO_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    window.TrazoBackend = null;
    return;
  }
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const parentOf = (path) => path.split("/").slice(0, -1).join("/");
  const lastOf = (path) => path.split("/").pop();
  const snapDoc = (path, data) => ({
    id: lastOf(path), exists: !!data, data: () => data || undefined, metadata: { fromCache: false, hasPendingWrites: false },
  });
  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const deepMerge = (a, b) => {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
    return out;
  };
  const fail = (error) => { const e = new Error(error?.message || "Error de base de datos"); e.code = error?.code || "unavailable"; throw e; };

  /* ---- cambios en vivo: un solo canal, y cada suscripción decide si le interesa ---- */
  const listeners = new Set();
  let channel = null;
  function ensureChannel() {
    if (channel) return;
    channel = sb.channel("trazo-documentos")
      .on("postgres_changes", { event: "*", schema: "public", table: "documentos" }, (p) => {
        const row = p.new && p.new.path ? p.new : p.old || {};
        for (const l of listeners) l(row);
      })
      .subscribe();
  }
  function listen(match, refresh) {
    ensureChannel();
    let t = null;
    const fn = (row) => { if (match(row)) { clearTimeout(t); t = setTimeout(refresh, 120); } };
    listeners.add(fn);
    return () => { listeners.delete(fn); clearTimeout(t); };
  }

  function docRef(path) {
    return {
      id: lastOf(path),
      path,
      async get() {
        const { data, error } = await sb.from("documentos").select("data").eq("path", path).maybeSingle();
        if (error) fail(error);
        return snapDoc(path, data ? data.data : null);
      },
      async set(body) {
        const { error } = await sb.from("documentos").upsert({ path, coleccion: parentOf(path), data: body });
        if (error) fail(error);
      },
      async update(patch) {
        const cur = await this.get();
        if (!cur.exists) fail({ message: "El documento no existe", code: "invalid_argument" });
        const { error } = await sb.from("documentos").update({ data: deepMerge(cur.data(), patch) }).eq("path", path);
        if (error) fail(error);
      },
      async delete() {
        const { error } = await sb.from("documentos").delete().eq("path", path);
        if (error) fail(error);
      },
      onSnapshot(next, onError) {
        let alive = true;
        const refresh = () => this.get().then((s) => alive && next(s)).catch((e) => onError && onError(e));
        refresh();
        const off = listen((row) => row.path === path, refresh);
        return () => { alive = false; off(); };
      },
      collection(sub) { return collRef(path + "/" + sub); },
      async acquire() { return { acquired: true }; },
    };
  }

  function collRef(path) {
    return {
      path,
      doc(id) { return docRef(path + "/" + (id || crypto.randomUUID())); },
      async get() {
        const { data, error } = await sb.from("documentos").select("path,data").eq("coleccion", path);
        if (error) fail(error);
        const docs = (data || []).map((r) => snapDoc(r.path, r.data));
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false } };
      },
      onSnapshot(next, onError) {
        let alive = true;
        const refresh = () => this.get().then((s) => alive && next(s)).catch((e) => onError && onError(e));
        refresh();
        const off = listen((row) => row.coleccion === path || (row.path && parentOf(row.path) === path), refresh);
        return () => { alive = false; off(); };
      },
    };
  }

  const db = { doc: docRef, collection: collRef };

  /* ---- sesión y perfil ---- */
  let perfil = null;
  async function loadPerfil() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) { perfil = null; return null; }
    const { data } = await sb.from("perfiles").select("id,email,nombre,rol").eq("id", user.id).maybeSingle();
    perfil = data || { id: user.id, email: user.email, nombre: user.user_metadata?.nombre || "", rol: "usuario" };
    return perfil;
  }
  const user = {
    async me() {
      const p = perfil || (await loadPerfil());
      return p ? { id: p.id, name: p.nombre || "", email: p.email, isOwner: p.rol === "creador", canEdit: p.rol === "creador" }
               : { id: null, name: "", email: null, isOwner: false, canEdit: false };
    },
    async canEdit() { const p = perfil || (await loadPerfil()); return !!p && p.rol === "creador"; },
    async profiles(ids) {
      const out = {};
      for (const id of ids) out[id] = { id, name: "" };
      if (!ids.length) return out;
      const { data } = await sb.from("perfiles").select("id,nombre,email").in("id", ids);
      for (const r of data || []) out[r.id] = { id: r.id, name: r.nombre || r.email || "" };
      return out;
    },
  };

  const auth = {
    async session() { const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return error;
      await loadPerfil(); return null;
    },
    async signUp(email, password, nombre) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nombre } } });
      if (error) return error;
      if (!data.session) return { message: "confirmar" };
      await loadPerfil();
      if (perfil && !perfil.nombre && nombre) { await sb.from("perfiles").update({ nombre }).eq("id", perfil.id); perfil.nombre = nombre; }
      return null;
    },
    async signOut() { await sb.auth.signOut(); perfil = null; },
    async changePassword(email, actual, nueva) {
      const { error: e1 } = await sb.auth.signInWithPassword({ email, password: actual });
      if (e1) return "actual";
      const { error: e2 } = await sb.auth.updateUser({ password: nueva });
      return e2 ? "error" : null;
    },
    async resetPassword(email) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      return error;
    },
    reload: loadPerfil,
  };

  /* ---- descargas: fuera de Claude, el navegador guarda el archivo directamente ---- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    },
  };

  /* ---- correos: la función "notificar" de Supabase los envía con Resend ---- */
  async function notify(body) {
    try { await sb.functions.invoke("notificar", { body }); } catch (e) { console.warn("No se pudo enviar la notificación", e); }
  }

  async function nextNumber() {
    const { data, error } = await sb.rpc("siguiente_numero");
    if (error) fail(error);
    return data;
  }

  window.TrazoBackend = { sb, db, user, auth, downloads, notify, nextNumber };
})();
