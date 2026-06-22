# html-viewer

Plataforma para **guardar, ver, editar, presentar y compartir archivos HTML** (reportes de IA, dashboards, etc.) sin que quien los recibe tenga que saber qué es un HTML ni cómo abrirlo.

- Entras con un **token único** y eliges (o creas) un **perfil** (nombre, correo, área).
- Subes un `.html` → queda en tu **biblioteca**, marcado como **público** o **privado**.
- Lo **ves** renderizado, editas su **texto** (estilo Gmail) o su **código** (con números de línea y resaltado).
- Lo **presentas** a pantalla completa con zoom, ideal para una reunión.
- Cada archivo tiene un **link para compartir**: público (abierto a cualquiera) o privado (exige iniciar sesión).
- Interfaz con la identidad de **Reuse** y **tema claro/oscuro** (por defecto sigue el del sistema).

> 📓 Mapa técnico detallado del codebase: **[DOCS.md](DOCS.md)**.

## Stack

- **Cloudflare Workers** — sirve el frontend estático (`public/`) y una API JSON.
- **D1** (SQLite) — metadatos: perfiles, documentos, visibilidad, `share_id`.
- **R2** — contenido HTML de cada archivo (no va en D1 por el límite de 1 MB/fila).
- Frontend en **JS vanilla** (módulos ES), sin framework ni build step. **Poppins** y **CodeMirror 5** servidos *self-host* (sin CDNs).

## Funcionalidades

- **Perfiles en el login** (2 pasos: token → elegir/crear perfil). El perfil activo se guarda por navegador y se puede cambiar desde la barra superior.
- **Biblioteca con tabs**: *Mis archivos* (del perfil) y *Público* (todos los compartidos como públicos).
- **Cards con thumbnail** (preview en vivo) y acciones solo-ícono: compartir, descargar, eliminar.
- **Compartir estilo Drive**: modal con el link, botón copiar y toggle **Público/Privado**.
- **Editor**: pestañas *Vista* (interactiva), *Editar texto* (`designMode`) y *Código* (CodeMirror); el documento se muestra como una hoja delimitada.
- **Modo presentación**: pantalla completa con zoom (+/−), atajos de teclado (`+` `-` `0` `Esc`).
- **Failsafe de almacenamiento**: a 7 GB de uso en R2 se bloquean las subidas con un aviso, para no exceder el plan gratuito (10 GB).

## Diseño y temas

- Identidad de **Reuse**: Foundation Purple `#151930`, Solid Purple `#37417f`, Re-Blue `#4b75f7`, Rising Lilac `#afb9ff` y verde de acento `#c6ffad`; tipografía **Poppins**.
- **Selector de tema** (Sistema / Claro / Oscuro): la preferencia se guarda en `localStorage` y *Sistema* sigue `prefers-color-scheme`. Un script inline en cada `<head>` evita el parpadeo. Tokens en `public/app.css`.

## Seguridad

- Acceso con token único → **cookie de sesión firmada con HMAC-SHA256** (sin estado en DB). `Secure` solo bajo HTTPS para que funcione en `localhost`.
- El HTML subido **nunca se sanitiza** (se preserva tal cual), sino que se **aísla al renderizar**:
  - `/raw/:shareId` se sirve con `Content-Security-Policy: sandbox allow-scripts …` → **origen opaco**.
  - Vista, thumbnails y presentación usan `iframe sandbox="allow-scripts"` (sin `allow-same-origin`).
  - **Editar texto** usa `allow-same-origin` **sin** `allow-scripts`: permite `designMode`, los `<script>` quedan **inertes** pero presentes (se conservan al guardar).
- **Visibilidad**: un documento **privado** solo se abre con sesión (su link devuelve `403` sin autenticación); uno **público** es abierto a cualquiera con el link.

## Desarrollo local

```bash
npm install
cp .dev.vars.example .dev.vars      # edita AUTH_TOKEN y SESSION_SECRET
npm run db:migrate:local            # crea/actualiza las tablas en la D1 local
npm run dev                         # http://localhost:8787
```

Para entrar, usa el `AUTH_TOKEN` que definiste en `.dev.vars` y elige/crea un perfil.

## Despliegue a Cloudflare

```bash
npx wrangler login

# 1. Crear la base D1 y copiar el database_id que imprime a wrangler.jsonc
npx wrangler d1 create html-viewer-db

# 2. Crear el bucket R2 (requiere R2 habilitado en el dashboard)
npx wrangler r2 bucket create html-viewer-files

# 3. Migrar la base remota (aplica todas las migraciones)
npm run db:migrate:remote

# 4. Configurar los secretos de producción
npx wrangler secret put AUTH_TOKEN
npx wrangler secret put SESSION_SECRET     # usa algo aleatorio y largo

# 5. Desplegar
npm run deploy
```

> Al agregar features con migraciones nuevas, aplica `npm run db:migrate:remote` **antes** de `npm run deploy` (el código usa las columnas nuevas).
>
> **Endurecimiento recomendado:** servir `/raw/:shareId` desde un subdominio aparte (p. ej. `view.tudominio.com`) para aislar también las cookies del origin principal.

## Estructura

```
wrangler.jsonc          Config del Worker (assets, D1, R2)
migrations/             Esquema SQL de D1 (0001 base, 0002 perfiles+visibilidad)
src/
  index.js              Router: API + contenido + assets + failsafe de storage
  auth.js               Sesión por cookie firmada (HMAC)
  util.js               Helpers (respuestas, ids, base64url)
public/
  index.html / login.js     Login en 2 pasos (token → perfil)
  library.html / library.js Biblioteca (tabs, subida, cards con thumbnail, switcher)
  viewer.html / viewer.js   Visor/editor + Presentar + Compartir
  shared.html / shared.js   Vista pública compartida (+ Presentar)
  app.css                   Estilos + design tokens (tema claro/oscuro)
  common.js                 Helpers, perfil activo, modales y modo presentación
  theme.js                  Selector de tema
  fonts/                    Poppins (self-host)
  vendor/codemirror/        CodeMirror 5 (self-host)
  *.png                     Logos de Reuse + favicon
DOCS.md                     Mapa técnico detallado del codebase
```

## API (resumen)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| POST | `/auth/login` · `/auth/logout` | — | Token → cookie / cierra sesión |
| GET | `/api/session` | cookie | Verifica sesión |
| GET | `/api/storage` | sí | Uso de almacenamiento (failsafe) |
| GET/POST | `/api/profiles` | sí | Lista / crea perfiles (nombre, correo, área) |
| DELETE | `/api/profiles/:id` | sí | Elimina perfil |
| GET | `/api/documents?scope=public` · `?profile_id=N` | sí | Lista por tab |
| POST | `/api/documents` | sí | Sube documento (con visibilidad) |
| GET/PUT/DELETE | `/api/documents/:id` | sí | Lee (con contenido) / actualiza (incl. `public`) / elimina |
| GET | `/api/shared/:shareId` | — (privado: 403) | Metadatos públicos |
| GET | `/raw/:shareId` | público o sesión si privado | Contenido HTML aislado (`?download`) |
| GET | `/s/:shareId` · `/doc/:id` | — / shell | Páginas de visualización |

## Roadmap

- [ ] Editor visual completo (no solo texto): barra de formato, imágenes, bloques.
- [ ] Versionado/historial de ediciones.
- [ ] Búsqueda y carpetas/etiquetas en la biblioteca.
- [ ] Thumbnails pre-renderizados (server-side) para carga más rápida.
- [ ] Subdominio dedicado para `/raw` (aislamiento de cookies).
