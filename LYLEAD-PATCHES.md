# Parches de Lylead sobre Evolution API 2.4.0-rc2

Rama `lylead/labels-fix`. Imagen `ghcr.io/derek123enterprise-oss/evolution-api:lylead-labels`
(se publica sola al hacer push a `lylead/**`). Corre en Hetzner como `evolution-api-v24`
(`evo-test.lylead.com`, compose en `/root/evolution-v24`).

**No reemplazar esta imagen por la oficial ni hacer rebase sin revisar cada punto.**
Varios de estos cambios evitan que WhatsApp desvincule el teléfono del cliente.

## 1. La app-state key se lee con `fromObject`, nunca con `create` (CRÍTICO)

Archivos: `src/utils/use-multi-file-auth-state-{prisma,provider-files,redis-db}.ts`.

Baileys 7 guarda `keyData` como base64. `proto.Message.AppStateSyncKeyData.create(value)`
lo deja como texto de 44 caracteres; `fromObject(value)` lo convierte a los 32 bytes.
Con la llave como texto, `expandAppStateKeys` deriva llaves equivocadas:

- los cambios de lista hechos en el celular fallan con `bad decrypt` y Baileys los
  descarta **en silencio** (la versión de `regular` avanza igual, no sale `labels.association`);
- los parches de etiqueta salen cifrados con una llave equivocada y WhatsApp responde
  401 `device_removed` (desvincula este dispositivo y a veces los demás de la cuenta).

Sólo "funciona" los ~5 min posteriores a vincular, mientras la llave sigue en la caché en
memoria. Medido el 2026-10-28: `create.keyData = String/44`, `fromObject.keyData = Buffer/32`.

Upstream sigue con `create()` en `main` y `develop`; hay PRs abiertos con el mismo arreglo
(evolution-foundation/evolution-api#2685, #2610).

Guarda adicional: `getAppStateReadiness()` responde `ready: false` si la llave no llega
como `Uint8Array` de 32 bytes, así que una regresión deja de escribir en vez de desvincular.

## 2. El 408 vuelve a reconectar

`codesToNotReconnect` sin 408. 2.4.0-rc2 lo agregó y un corte de red ("Connection was
lost") dejaba la instancia en `close` para siempre. 2.3.7 y `main` reconectan.

## 3. Endpoints de etiquetas

- `GET /label/writeStatus/{instance}` (solo lectura): sesión abierta + app-state key en
  binario + baseline de `regular`. Lylead lo consulta antes de cada escritura.
- `POST /label/sync/{instance}`: pide los cambios pendientes de `regular` (sin parches).
- `handleLabel` etiqueta el `@lid` (no el teléfono) y lee la respuesta del servidor al
  parche. Si WhatsApp lo rechaza, resincroniza pero **no reintenta** la escritura.
- `labels.association` ya no descarta `labels.edit` del mismo lote.

## 4. Guard de Baileys (`tools/patch-baileys-appstate.js`, postinstall)

No envía un parche de app-state sin baseline (`version >= 1`) ni sin la llave del
dispositivo primario.

## Cómo verificar una imagen nueva antes de usarla

```bash
docker exec evolution-api-v24 node -e '
const fs=require("fs"),p=require("path");
function walk(d,o){for(const f of fs.readdirSync(d)){const q=p.join(d,f);fs.statSync(q).isDirectory()?walk(q,o):q.endsWith(".js")&&o.push(q)}return o}
for(const f of walk("/evolution/dist",[])){const s=fs.readFileSync(f,"utf8");
const a=(s.match(/AppStateSyncKeyData\.fromObject/g)||[]).length,b=(s.match(/AppStateSyncKeyData\.create/g)||[]).length;
if(a||b)console.log(f,"fromObject",a,"create",b)}'
```

Debe haber `fromObject` y **cero** `create`. Después, `GET /label/writeStatus/{instance}`
de un canal abierto debe decir `ready: true`.

## Reversión

En el servidor queda la imagen anterior etiquetada `lylead-labels-rollback-20261028`
(tiene el error de la llave: usarla sólo con el etiquetado bloqueado).

## Vista previa de enlaces (c9328c0)
`sendMessageWithTyping` ya no inyecta la tarjeta `externalAdReply` que generaba
`generateLinkPreview` (formato de anuncio). Sólo se activa con
`EVOLUTION_EXTERNAL_AD_PREVIEW=true`. Con `linkPreview` distinto de `false`, Baileys
genera su vista previa nativa (`generateHighQualityLinkPreview`), igual que en 2.3.7.

## Carrusel con botones que sí responden (9dadb81)
Con el nodo `biz` simple (`buildInteractiveBizNode`) el carrusel llegaba pero sus botones
no hacían nada. `carouselMessage` ahora manda el nodo `biz` completo (`actual_actors`,
`host_storage`, `privacy_mode_ts` + `quality_control`, como Itsukichan/Baileys) y
`messageParamsJson` + título en cada tarjeta. Probado 2026-10-28: "Lo quiero" llega al
webhook con su id. No volver al nodo simple en el carrusel.
