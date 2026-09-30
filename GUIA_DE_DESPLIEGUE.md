# Guía para publicar Trazo en internet

Esta guía deja Trazo como un sitio web público, con inicio de sesión real, datos guardados en Supabase y correos automáticos con Resend. Todo usa planes gratuitos. Tiempo estimado: 1 a 2 horas.

| Paso | Servicio | Resultado |
| --- | --- | --- |
| 1 | Supabase | Base de datos, cuentas de usuario y la función de correos |
| 2 | Resend | Envío de los correos |
| 3 | Supabase | Función `notificar` publicada con sus claves |
| 4 | Netlify | La página en internet, conectada a este repositorio |
| 5 | Google Search Console | Que Google encuentre el sitio |

> Los nombres de los menús pueden variar un poco según la versión de cada servicio.

---

## 1. Supabase: base de datos y cuentas

1. Cree una cuenta en **supabase.com** (puede entrar con GitHub) y un proyecto nuevo:
   - Nombre: `trazo`
   - Región: **South America (São Paulo)**, la más cercana a Colombia
   - Guarde la contraseña de la base de datos en un lugar seguro.
2. Abra **SQL Editor → New query**, pegue todo el archivo [`supabase/schema.sql`](supabase/schema.sql) y pulse **Run**. Crea las tablas, las reglas de acceso y el consecutivo REQ.
3. En otra consulta, pegue el archivo **`datos_iniciales_trazo.sql`** (se lo entregan aparte, **no está en GitHub** porque contiene datos internos) y pulse **Run**. Carga las 60 requisiciones migradas.
4. **Authentication → Sign In / Providers → Email**: mientras dura el piloto, desactive **Confirm email** para que los usuarios entren apenas crean su cuenta. (Cuando tenga dominio propio en Resend, puede activarlo y configurar Resend como SMTP en Authentication → Emails.)
5. **Cuenta del creador:** Authentication → Users → **Add user → Create new user**:
   - Correo: `compras@massersolutions.com`
   - Contraseña: una nueva y segura (no reutilice la que se compartió por chat)
   - Marque **Auto Confirm User**
6. Dele el rol de creador: en SQL Editor ejecute
   ```sql
   update public.perfiles set rol = 'creador' where email = 'compras@massersolutions.com';
   ```
7. Copie de **Project Settings → API**: la **Project URL** y la **anon public key**. Péguelas en [`web/config.js`](web/config.js). Esas dos son públicas por diseño. **Nunca** copie la `service_role` key en la página.

## 2. Resend: correos

1. Cree una cuenta en **resend.com**.
2. **Domains → Add domain**: agregue el dominio desde el que saldrán los correos (por ejemplo `trazo-asetpor.com`) y copie los registros DNS que le indique en el proveedor del dominio. Sin dominio verificado, Resend **solo** deja enviar correos a la dirección con la que creó la cuenta: sirve para probar, no para avisar a todos los usuarios.
3. **API Keys → Create API Key** con permiso de envío. Cópiela.

## 3. Supabase: función de correos `notificar`

1. En Supabase abra **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: `notificar`. Pegue el contenido de [`supabase/functions/notificar/index.ts`](supabase/functions/notificar/index.ts) y pulse **Deploy**. Deje activada la verificación de JWT.
3. **Edge Functions → Secrets** (o Manage secrets), agregue:

   | Nombre | Valor |
   | --- | --- |
   | `RESEND_API_KEY` | la clave del paso 2 |
   | `CORREO_REMITENTE` | `Trazo <notificaciones@su-dominio.com>` (o `Trazo <onboarding@resend.dev>` para probar) |
   | `CORREO_CREADOR` | `compras@massersolutions.com` |
   | `URL_APP` | la dirección de Netlify del paso 4 |

**Qué correos se envían:**
- A Compras, cada vez que un usuario registra una requisición (con prioridad, valor, fecha e ítems).
- Al usuario, cada vez que Compras aprueba, devuelve, rechaza, registra OC, recepción, FDS o factura, le deja una observación o deshace un paso.

## 4. Netlify: la página en internet

1. Cree una cuenta en **netlify.com** entrando con GitHub.
2. **Add new site → Import an existing project → GitHub** y elija el repositorio **Trazo**.
3. No cambie nada más: el archivo [`netlify.toml`](netlify.toml) ya indica que se publique la carpeta `web`. Pulse **Deploy**.
4. **Site configuration → Change site name**: póngale `trazo-asetpor`. La dirección queda `https://trazo-asetpor.netlify.app`. Si elige otro nombre, cámbielo también en `web/robots.txt` y `web/sitemap.xml`.
5. En Supabase, **Authentication → URL Configuration → Site URL**: ponga esa misma dirección.

Desde ahora, cada cambio que se suba a GitHub se publica solo en un par de minutos.

## 5. Google Search Console: aparecer en buscadores

1. Entre a **search.google.com/search-console** con una cuenta de Google y agregue la propiedad **Prefijo de la URL** con la dirección de Netlify.
2. Verifique con el método **Etiqueta HTML**: copie la etiqueta `<meta name="google-site-verification" ...>` y agréguela dentro del `<head>` de `web/index.html` (o pídale a Claude que lo haga).
3. En **Sitemaps**, envíe `sitemap.xml`.
4. Google tarda de unos días a algunas semanas en mostrar el sitio. Para que lo encuentren más fácil, compártalo desde la página o redes de la empresa.

Solo se indexa la portada. Las requisiciones, precios y proveedores quedan detrás del inicio de sesión y las reglas de la base de datos.

---

## Quién puede hacer qué

| | Usuario | Creador |
| --- | --- | --- |
| Crear cuenta desde la portada | Sí | No (la crea el administrador en Supabase) |
| Registrar requisiciones | Sí | Sí |
| Ver requisiciones | Solo las suyas | Todas |
| Editar o deshacer su pedido | Mientras espera aprobación, si se la devolvieron o si tiene una observación | — |
| Bandeja, estadísticas, exportar y ajustes | No | Sí |

Para dar el rol de creador a otra persona: que cree su cuenta como usuario y luego ejecute en SQL Editor
`update public.perfiles set rol = 'creador' where email = 'correo@empresa.com';`
