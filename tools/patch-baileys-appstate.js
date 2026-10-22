/**
 * [Lylead] Guard de app-state para Baileys 7.
 *
 * Aplicar una etiqueta de WhatsApp es enviar un "app-state patch". Si la sesión
 * no puede cifrar ese patch (falta la app-state key que comparte el dispositivo
 * primario), Baileys envía el parche con version 0 / LTHash vacío y WhatsApp
 * responde 401 conflict/device_removed: el socket se cierra, el canal se
 * desconecta y expulsa a los demás dispositivos de la cuenta.
 *
 * Este guard impide enviar el patch cuando:
 *   1) no hay baseline válido de la colección (version < 1),
 *   2) no hay `creds.myAppStateKeyId`, o
 *   3) el key store no tiene la clave para ese id
 *      (`keys.get('app-state-sync-key', [keyId])`).
 *
 * En esos casos falla con un 400 limpio y la sesión sobrevive.
 *
 * Idempotente: si ya está aplicado no hace nada, y si está aplicado en una
 * versión anterior lo reemplaza (sin duplicar bloques).
 */
const fs = require('fs');

const MARKER = 'LYLEAD_APP_STATE_GUARD';
const NEW_MARK = '__lyleadKey';
const target = process.argv[2] || '/evolution/node_modules/baileys/lib/Socket/chats.js';

const ANCHOR =
  /([ \t]*)const \{ \[name\]: currentSyncVersion \} = await authState\.keys\.get\('app-state-sync-version', \[name\]\);/;
const OLD_VERSION_BLOCK = /[ \t]*if \(!currentSyncVersion \|\| Number\(currentSyncVersion\) < 1\) \{[\s\S]*?\n[ \t]*\}/;
const OLD_KEY_BLOCK = /[ \t]*if \(!authState\.creds\?\.appStateSyncKey\) \{[\s\S]*?\n[ \t]*\}/;
const OLD_COMMENTS = /[ \t]*\/\/ LYLEAD_APP_STATE_GUARD[^\n]*\n(?=[ \t]*\/\/|[ \t]*if )/g;

function buildGuard(indent) {
  return [
    `${indent}// ${MARKER}: sin baseline válido NO se envía un patch v0.`,
    `${indent}// WhatsApp lo rechaza y responde 401 conflict/device_removed, lo que`,
    `${indent}// desconecta el canal y expulsa a los demás dispositivos de la cuenta.`,
    `${indent}if (!currentSyncVersion || Number(currentSyncVersion) < 1) {`,
    `${indent}    throw new Boom(`,
    `${indent}        'App state baseline missing for ' + name +`,
    `${indent}            + ': refusing to send a v0 patch (it corrupts server state and removes this device with 401 conflict/device_removed)',`,
    `${indent}        { statusCode: 400 },`,
    `${indent}    );`,
    `${indent}}`,
    `${indent}// ${MARKER}: la clave con la que se cifra el patch la comparte el dispositivo`,
    `${indent}// primario y vive en el key store. Sin ella el patch se va corrupto.`,
    `${indent}if (!authState.creds?.myAppStateKeyId) {`,
    `${indent}    throw new Boom(`,
    `${indent}        'App state sync key id missing for ' + name +`,
    `${indent}            + ': refusing to send an app-state patch without the primary device key (it removes this device with 401 conflict/device_removed)',`,
    `${indent}        { statusCode: 400 },`,
    `${indent}    );`,
    `${indent}}`,
    `${indent}const __lyleadKey = (await authState.keys.get('app-state-sync-key', [authState.creds.myAppStateKeyId]))?.[authState.creds.myAppStateKeyId];`,
    `${indent}if (!__lyleadKey) {`,
    `${indent}    throw new Boom(`,
    `${indent}        'App state sync key missing for ' + name +`,
    `${indent}            + ': refusing to send an app-state patch without the primary device key (it removes this device with 401 conflict/device_removed)',`,
    `${indent}        { statusCode: 400 },`,
    `${indent}    );`,
    `${indent}}`,
  ].join('\n');
}

function main() {
  if (!fs.existsSync(target)) {
    console.log('[patch-baileys] no existe el objetivo; se omite el parche');
    return;
  }

  let source = fs.readFileSync(target, 'utf8');

  if (source.includes(NEW_MARK)) {
    console.log('[patch-baileys] el guard de app-state ya está aplicado (v3)');
    return;
  }

  // Versión anterior aplicada: quitar sus bloques para no duplicar guards.
  if (source.includes(MARKER)) {
    const before = source;
    source = source.replace(OLD_VERSION_BLOCK, '').replace(OLD_KEY_BLOCK, '').replace(OLD_COMMENTS, '');
    if (source === before) {
      console.warn('[patch-baileys] hay un guard antiguo que no se pudo reemplazar; se omite para no romper el arranque');
      return;
    }
  }

  const match = source.match(ANCHOR);
  if (!match) {
    console.warn('[patch-baileys] no se encontró el anchor en chats.js (versión de Baileys distinta); se omite el parche');
    return;
  }

  fs.writeFileSync(target, source.replace(ANCHOR, `${match[0]}\n${buildGuard(match[1])}`));
  console.log('[patch-baileys] guard de app-state (v3) aplicado a Baileys');
}

try {
  main();
} catch (error) {
  console.warn('[patch-baileys] no se pudo aplicar el parche:', error && error.message ? error.message : error);
}
