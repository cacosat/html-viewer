# html-viewer

Plataforma para **guardar, ver, editar y compartir archivos HTML** (reportes generados por IA, dashboards, etc.) sin que quien los recibe tenga que saber qué es un HTML ni cómo abrirlo.

- Entras con un **único token** de acceso.
- Eliges un **perfil** (solo para etiquetar quién subió cada archivo).
- Subes un `.html` → queda en tu **biblioteca**.
- Lo **ves** renderizado, editas su **texto** (estilo Gmail) o su **código**.
- Cada archivo tiene un **link público** para compartir; quien lo recibe solo ve, sin token.

## Stack

- **Cloudflare Workers** — sirve el frontend estático (`public/`) y una API JSON.
- **D1** (SQLite) — metadatos: perfiles, documentos, `share_id`.
- **R2** — contenido HTML de cada archivo (no va en D1 por el límite de 1 MB/fila).
- Frontend en **JS vanilla** (módulos ES), sin framework ni build step.

## Seguridad

- Acceso con token único → **cookie de sesión firmada con HMAC-SHA256** (sin estado en DB). `Secure` solo bajo HTTPS para que funcione en `localhost`.
- El HTML subido **nunca se sanitiza** (se preserva tal cual, con su interactividad), sino que se **aísla al renderizar**:
  - La ruta pública `/raw/:shareId` se sirve con `Content-Security-Policy: sandbox allow-scripts …` → **origen opaco**, sin acceso a la plataforma.
  - El visor del dueño usa un `iframe sandbox="allow-scripts"` (sin `allow-same-origin`) para la **Vista** interactiva.
  - El modo **Editar texto** usa `iframe sandbox="allow-same-origin"` **sin** `allow-scripts`: el navegador puede activar `designMode` (edición), los `<script>` del reporte quedan **inertes** (no se ejecutan) pero **presentes en el DOM**, así se conservan al guardar.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars      # edita AUTH_TOKEN y SESSION_SECRET
npm run db:migrate:local            # crea las tablas en la D1 local
npm run dev                         # http://localhost:8787
```

Para entrar, usa el `AUTH_TOKEN` que definiste en `.dev.vars`.

## Despliegue a Cloudflare

```bash
npx wrangler login

# 1. Crear la base D1 y copiar el database_id que imprime a wrangler.jsonc
npx wrangler d1 create html-viewer-db

# 2. Crear el bucket R2
npx wrangler r2 bucket create html-viewer-files

# 3. Migrar la base remota
npm run db:migrate:remote

# 4. Configurar los secretos de producción
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put SESSION_SECRET     # usa algo aleatorio y largo

# 5. Desplegar
npm run deploy
```

Tras el deploy obtienes una URL `https://html-viewer.<tu-subdominio>.workers.dev`. Para un dominio propio, agrega un `route`/Custom Domain desde el dashboard de Cloudflare o en `wrangler.jsonc`.

> **Endurecimiento recomendado para producción:** servir `/raw/:shareId` desde un **subdominio aparte** (p. ej. `view.tudominio.com`) para aislar también las cookies del origin principal.

## Estructura

```
wrangler.jsonc          Config del Worker (assets, D1, R2)
migrations/             Esquema SQL de D1
src/
  index.js              Router: API + contenido + sirve assets
  auth.js               Sesión por cookie firmada (HMAC)
  util.js               Helpers (respuestas, ids, base64url)
public/
  index.html / login.js     Entrada (token)
  library.html / library.js Biblioteca (subir, perfiles, lista)
  viewer.html / viewer.js   Visor/editor del dueño (Vista / Texto / Código)
  shared.html / shared.js   Vista pública compartida (solo lectura)
  app.css / common.js       Estilos y helpers compartidos
```

## API (resumen)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/login` | — | Token → cookie de sesión |
| POST | `/auth/logout` | — | Cierra sesión |
| GET | `/api/session` | cookie | Verifica sesión |
| GET/POST | `/api/profiles` | sí | Lista / crea perfiles |
| DELETE | `/api/profiles/:id` | sí | Elimina perfil |
| GET/POST | `/api/documents` | sí | Lista / sube documentos |
| GET/PUT/DELETE | `/api/documents/:id` | sí | Lee (con contenido) / actualiza / elimina |
| GET | `/api/shared/:shareId` | — | Metadatos públicos (título) |
| GET | `/raw/:shareId` | — | Contenido HTML aislado (`?download` fuerza descarga) |
| GET | `/s/:shareId` | — | Página pública de visualización |
| GET | `/doc/:id` | — (datos: sí) | Visor/editor del dueño |

## Roadmap

- [ ] Editor visual completo (no solo texto): barra de formato, imágenes, bloques.
- [ ] Versionado/historial de ediciones.
- [ ] Búsqueda y carpetas/etiquetas en la biblioteca.
- [ ] Subdominio dedicado para `/raw` (aislamiento de cookies).
- [ ] Vista previa (thumbnail) de cada archivo en la biblioteca.
