# html-viewer

Plataforma para **guardar, ver, editar, presentar y compartir archivos HTML** (reportes de IA, dashboards, etc.) sin que quien los recibe tenga que saber qué es un HTML ni cómo abrirlo.

- Entras con un **token único** y eliges (o creas) un **perfil** (nombre, correo, área).
- Subes un `.html` → queda en tu **biblioteca**, marcado como **público** o **privado**.
- Lo **ves** renderizado, lo **editas** (texto, formato, bloques, tablas e imágenes, con deshacer/rehacer) o editas su **código** (con números de línea y resaltado).
- Lo **presentas** a pantalla completa con zoom, ideal para una reunión.
- Cada archivo tiene un **link para compartir**: público (abierto a cualquiera) o privado (exige iniciar sesión).
- Interfaz con el sistema de diseño **"Joaquin"** (controles táctiles sobre superficies casi negras, un solo acento naranja) y **tema oscuro/claro** (por defecto sigue el del sistema).

> 📓 Mapa técnico detallado del codebase: **[DOCS.md](DOCS.md)**.

## Stack

- **Cloudflare Workers** — sirve el frontend estático (`public/`) y una API JSON.
- **D1** (SQLite) — metadatos: perfiles, documentos, visibilidad, `share_id`.
- **R2** — contenido HTML de cada archivo (no va en D1 por el límite de 1 MB/fila).
- Frontend en **JS vanilla** (módulos ES), sin framework ni build step. **Inter**, **JetBrains Mono** y **CodeMirror 5** servidos *self-host* (sin CDNs).

## Funcionalidades

- **Navegación tipo Obsidian**: ribbon de íconos (explorador, biblioteca, subir, buscar, tema, perfil), **explorador** lateral con *Públicos* y *Mis archivos* (filtro y medidor de almacenamiento) y **panel** derecho del documento. En móvil, ambos laterales son cajones.
- **Buscador rápido** con `⌘K` / `Ctrl+K` (documentos y acciones) y **subida por arrastre**: suelta un `.html` en cualquier parte.
- **Perfiles en el login** (2 pasos: token → elegir/crear perfil). El perfil se cambia desde el avatar del ribbon.
- **Biblioteca** con tabs *Públicos* (la vista por defecto al entrar) / *Mis archivos* (`/library?scope=mine`) y tarjetas con **miniatura en vivo**, badges y acciones (compartir, descargar, eliminar).
- **Compartir**: modal con el link, *Copiar link* y el switch **Documento público**; también desde el panel *Detalles*.
- **Visor** con modos **Vista · Editar · Código**, título editable, estado de guardado real ("Cambios sin guardar" se apaga si deshaces todo), **Guardar** (`⌘S`) y **Descartar cambios**.
- **Edición** en *Editar*: barra de formato (estilos de párrafo, negrita/cursiva/subrayado/tachado, color y resaltado, listas y sangría, alineación, enlaces, imágenes, quitar formato) y **editor de bloques** con acciones en pares: contenedor ↔ interior, mover ↑/↓, duplicar / insertar debajo, A−/A+, fondo, ocultar ↔ mostrar (con *Ocultos* para recuperarlos), eliminar con *Deshacer*; en tablas, operaciones de **fila y columna**. **Deshacer/rehacer** cubre todo (texto, formato y bloques). La ruta del bloque se ve abajo. Todo opera sobre el DOM real: no rompe el HTML ni los scripts del reporte.
- **Modo presentación**: pantalla completa con zoom (+/−) y atajos (`+` `-` `0` `Esc`).
- **Comentarios** en el panel: resolver/reabrir (desplegable *Resueltos*), eliminar con confirmación y `⌘↵` para enviar; el botón del panel muestra los abiertos.
- **Failsafe de almacenamiento**: a 7 GB de uso en R2 se bloquean las subidas con un aviso, para no exceder el plan gratuito (10 GB).

## Diseño y temas

- Sistema de diseño **"Joaquin"**: lo que se presiona tiene relieve, donde se escribe está hundido, superficies casi negras con hairlines, un solo acento **naranja `#e8490c`** y brillo solo para lo activo. Tipografías **Inter** y **JetBrains Mono**; íconos **Lucide**.
- **Selector de tema** (Sistema / Claro / Oscuro) en el ribbon: la preferencia se guarda en `localStorage` y *Sistema* sigue `prefers-color-scheme`. Un script inline en cada `<head>` evita el parpadeo. Tokens y componentes `ui-*` en `public/app.css` (detalle en [DOCS.md](DOCS.md) §11).

## Seguridad

- Acceso con token único → **cookie de sesión firmada con HMAC-SHA256** (sin estado en DB). `Secure` solo bajo HTTPS para que funcione en `localhost`.
- El HTML subido **nunca se sanitiza** (se preserva tal cual), sino que se **aísla al renderizar**:
  - `/raw/:shareId` se sirve con `Content-Security-Policy: sandbox allow-scripts …` → **origen opaco**.
  - Vista, thumbnails y presentación usan `iframe sandbox="allow-scripts"` (sin `allow-same-origin`).
  - **Editar** usa `allow-same-origin` **sin** `allow-scripts`: permite `designMode`, los `<script>` quedan **inertes** pero presentes (se conservan al guardar). La UI del editor vive fuera del documento y nunca se guarda dentro del HTML.
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
migrations/             Esquema SQL de D1 (0001 base, 0002 perfiles+visibilidad, 0003 comentarios, 0004 comentarios resueltos)
src/
  index.js              Router: API + contenido + assets + failsafe de storage
  auth.js               Sesión por cookie firmada (HMAC)
  util.js               Helpers (respuestas, ids, base64url)
public/
  index.html / login.js     Login en 2 pasos (token → perfil)
  library.html / library.js Biblioteca (tabs + galería)
  viewer.html / viewer.js   Visor: Vista / Editar / Código + panel
  editor.js                 Editor enriquecido (formato, bloques, historial)
  comments.js               Comentarios del panel
  shell.js                  Ribbon, explorador, panel, subida, buscador ⌘K
  shared.html / shared.js   Vista pública compartida (+ Presentar)
  app.css                   Sistema de diseño (tokens + componentes ui-*) y layouts
  common.js                 Helpers, modales, menús, toasts, compartir, presentación
  icons.js · theme.js       Íconos Lucide · tema Sistema/Claro/Oscuro
  favicon.svg               Favicon
  fonts/                    Inter y JetBrains Mono (self-host)
  vendor/codemirror/        CodeMirror 5 (self-host)
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
| GET/POST | `/api/documents/:id/comments` | sí | Lista / agrega comentarios |
| PATCH | `/api/comments/:id` | sí | Resuelve / reabre (`{resolved, by}`) |
| DELETE | `/api/comments/:id` | sí | Elimina un comentario |
| GET | `/api/shared/:shareId` | — (privado: 403) | Metadatos públicos |
| GET | `/raw/:shareId` | público o sesión si privado | Contenido HTML aislado (`?download`) |
| GET | `/s/:shareId` · `/doc/:id` | — / shell | Páginas de visualización |

## Roadmap

- [ ] Versionado/historial de ediciones.
- [ ] Carpetas/etiquetas en la biblioteca y búsqueda dentro del contenido.
- [ ] Edición asistida por IA sobre el documento.
- [ ] Thumbnails pre-renderizados (server-side) para carga más rápida.
- [ ] Subdominio dedicado para `/raw` (aislamiento de cookies).
