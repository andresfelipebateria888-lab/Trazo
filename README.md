# Trazo

**Cada compra, trazada de principio a fin.** Sistema de requisiciones de compra de ASETPOR S.A.S.: los usuarios registran sus pedidos y siguen su estado; Compras los prioriza, aprueba y lleva hasta la factura, con fichas de seguridad exigidas al recibir y control de proveedores según la Guía RUC 3.2.1.

Proyecto Culminante · Ingeniería Industrial · Universidad del Magdalena.

## Qué incluye

- Portada pública con ingreso de **usuario** (crea su cuenta) y **creador** (Compras).
- Prioridad automática P1/P2/P3, nivel de aprobación y cotizaciones requeridas.
- Bandeja con filtros por fecha, área y prioridad; detección de datos faltantes; observaciones al solicitante; eliminar con deshacer.
- Estadísticas con indicadores y gráficos.
- Exportación a Excel y a la hoja de Google Drive.
- Correos automáticos: a Compras por cada requisición nueva y al usuario por cada cambio de estado.

## Estructura

| Carpeta | Contenido |
| --- | --- |
| `web/` | La página (se publica en Netlify) |
| `supabase/schema.sql` | Tablas, reglas de acceso y consecutivo |
| `supabase/functions/notificar/` | Función que envía los correos con Resend |
| `GUIA_DE_DESPLIEGUE.md` | Pasos para ponerlo en internet |

Los datos reales de la empresa **no** se guardan en este repositorio.
