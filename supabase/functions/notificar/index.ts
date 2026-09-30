// Trazo · función "notificar"
// Envía correos con Resend:
//  - evento "nueva":  a Compras (CORREO_CREADOR) cuando un usuario registra una requisición
//  - evento "estado": al solicitante cuando Compras cambia el estado o le deja una observación
//
// Variables (Supabase → Edge Functions → Secrets):
//   RESEND_API_KEY   clave de Resend
//   CORREO_REMITENTE por ejemplo "Trazo <notificaciones@tu-dominio.com>"
//   CORREO_CREADOR   compras@massersolutions.com
//   URL_APP          dirección pública de Trazo, por ejemplo https://trazo-asetpor.netlify.app
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY ya existen en toda función.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fecha = (iso?: string) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const lvl = (s?: string) => Number(String(s || "1").charAt(0)) || 1;

// Misma prioridad que calcula la app (pesos 50/30/20)
function prioridad(r: Record<string, any>) {
  let h = 1;
  if (r.fechaSolicitud && r.fechaNecesaria) {
    const d = Math.round((Date.parse(r.fechaNecesaria) - Date.parse(r.fechaSolicitud)) / 864e5);
    h = d <= 2 ? 3 : d <= 7 ? 2 : 1;
  }
  const score = Math.round((0.5 * lvl(r.io) + 0.3 * lvl(r.ss) + 0.2 * h) * 100) / 100;
  return lvl(r.io) === 3 || score >= 2.4 ? "P1" : score >= 1.7 ? "P2" : "P3";
}

function plantilla(titulo: string, cuerpo: string, url: string) {
  return `<!doctype html><html><body style="margin:0;background:#F4F6F9;font-family:Arial,sans-serif;color:#262B33">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden">
  <tr><td style="background:#14264F;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">Trazo <span style="font-size:12px;color:#A9C6E6;font-weight:normal">ASETPOR S.A.S.</span></td></tr>
  <tr><td style="padding:24px"><h2 style="margin:0 0 12px;font-size:19px;color:#14264F">${titulo}</h2>${cuerpo}
  <p style="margin:24px 0 0"><a href="${url}" style="background:#2F5D9E;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;font-weight:bold">Abrir Trazo</a></p></td></tr>
  <tr><td style="padding:14px 24px;background:#EEF2F7;font-size:12px;color:#5E6978">Mensaje automático de Trazo. No responda a este correo.</td></tr>
  </table></td></tr></table></body></html>`;
}

async function enviar(to: string, subject: string, html: string) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: Deno.env.get("CORREO_REMITENTE"), to: [to], subject, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") || "";
    // Quién llama (debe haber iniciado sesión)
    const comoUsuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await comoUsuario.auth.getUser();
    if (!user) return json({ error: "Sin sesión" }, 401);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: perfil } = await admin.from("perfiles").select("rol").eq("id", user.id).maybeSingle();
    const esCreador = perfil?.rol === "creador";
    const app = Deno.env.get("URL_APP") || "";
    const body = await req.json();

    if (body.evento === "nueva") {
      const path = String(body.path || "");
      if (!path.startsWith(`data/users/${user.id}/`)) return json({ error: "Ruta no permitida" }, 403);
      const { data: fila } = await admin.from("documentos").select("data").eq("path", path).maybeSingle();
      if (!fila) return json({ error: "No existe" }, 404);
      const r = fila.data as Record<string, any>;
      const p = prioridad(r);
      const valor = (r.items || []).reduce((s: number, i: any) => s + (Number(i.cantidad) || 0) * (Number(i.precio) || 0), 0);
      const items = (r.items || []).map((i: any) =>
        `<li>${esc(i.producto)} · ${esc(i.cantidad)} ${esc(i.unidad)}${i.quimico ? " · <b>químico</b>" : ""}</li>`).join("");
      const cuerpo = `<p style="margin:0 0 12px"><b>${esc(r.solicitante)}</b> (${esc(r.area)}, ${esc(r.empresa)}) registró una requisición.</p>
        <table cellpadding="6" style="font-size:14px;border-collapse:collapse">
        <tr><td style="color:#5E6978">Requisición</td><td><b>${esc(r.id)}</b></td></tr>
        <tr><td style="color:#5E6978">Prioridad</td><td><b>${p}</b></td></tr>
        <tr><td style="color:#5E6978">Descripción</td><td>${esc(r.descripcion)}</td></tr>
        <tr><td style="color:#5E6978">Se necesita el</td><td>${fecha(r.fechaNecesaria)}</td></tr>
        <tr><td style="color:#5E6978">Valor estimado</td><td>$${Math.round(valor).toLocaleString("es-CO")}</td></tr>
        ${r.justificacion ? `<tr><td style="color:#5E6978">Justificación</td><td>${esc(r.justificacion)}</td></tr>` : ""}
        </table><p style="margin:12px 0 4px;color:#5E6978;font-size:13px">Ítems</p><ul style="margin:0;padding-left:18px;font-size:14px">${items}</ul>`;
      await enviar(Deno.env.get("CORREO_CREADOR")!, `Nueva requisición ${r.id} · ${p} · ${r.area || ""}`, plantilla(`Nueva requisición ${esc(r.id)}`, cuerpo, app));
      return json({ ok: true });
    }

    if (body.evento === "estado") {
      if (!esCreador) return json({ error: "Solo Compras notifica cambios de estado" }, 403);
      const id = String(body.id || "");
      const { data: filas } = await admin.from("documentos").select("path,dueno,data")
        .like("path", `data/users/%/${id}`).limit(1);
      const fila = filas?.[0];
      if (!fila) return json({ ok: true, omitido: "Requisición sin solicitante registrado en Trazo" });
      const r = fila.data as Record<string, any>;
      let para = r.correoSolicitante as string | undefined;
      if (!para && fila.dueno) {
        const { data: u } = await admin.from("perfiles").select("email").eq("id", fila.dueno).maybeSingle();
        para = u?.email;
      }
      if (!para) return json({ ok: true, omitido: "Sin correo" });
      const accion = String(body.accion || "Actualización");
      const cuerpo = `<p style="margin:0 0 12px">Hola ${esc(r.solicitante || "")}, su requisición <b>${esc(id)}</b> tiene una novedad:</p>
        <p style="margin:0 0 12px;padding:12px 14px;background:#EAF1F9;border-radius:8px;font-size:15px"><b>${esc(accion)}</b></p>
        <p style="margin:0;font-size:14px;color:#5E6978">${esc(r.descripcion)}</p>`;
      await enviar(para, `Su requisición ${id}: ${accion}`, plantilla(`Novedad en ${esc(id)}`, cuerpo, app));
      return json({ ok: true });
    }

    return json({ error: "Evento desconocido" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
