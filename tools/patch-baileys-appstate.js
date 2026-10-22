/**
 * [Lylead] Guard de app-state para Baileys.
 *
 * Aplicar una etiqueta de WhatsApp es enviar un "app-state patch". Si la sesión
 * no puede descifrar el snapshot de la colección 'regular' (falta la app-state
 * key que envía el dispositivo primario), Baileys deja el estado local en
 * version 0 / LTHash vacío y envía el parche así:
 *
 *   attrs: { name: 'regular', version: (state.version - 1) }  // → "0"
 *
 * WhatsApp rechaza ese parche (baseline corrupto) y responde
 * <stream:error code="401"><conflict type="device_removed"/></: el socket se
 * cierra y el canal se desconecta. Con varios dispositivos de la misma cuenta
 * además expulsa a los demás (teléfono, PC).
 *
 * Con este guard, si no hay baseline válido NO se envía el parche: la operación
 * falla con un 400 limpio y la sesión sobrevive.
 *
 * Es idempotente y no rompe el build: si el anchor no existe (otra versión de
 * Baileys) avisa y sale con código 0.
 */
const fs = require('fs');
const path = require('path');

const MARKER = 'LYLEAD_APP_STATE_GUARD';
const target = path.join(__dirname, '..', 'node_modules', 'baileys', 'lib', 'Socket', 'chats.js');

function main() {
  if (!fs.existsSync(target)) {
    console.log('[patch-baileys] baileys no está instalado; se omite el parche');
    return;
  }

  const source = fs.readFileSync(target, 'utf8');
  if (source.includes(MARKER)) {
    console.log('[patch-baileys] el guard de app-state ya está aplicado');
    return;
  }

  const re = /([ \t]*)const \{ \[name\]: currentSyncVersion \} = await authState\.keys\.get\('app-state-sync-version', \[name\]\);/;
  const match = source.match(re);
  if (!match) {
    console.warn('[patch-baileys] no se encontró el anchor en chats.js (versión de Baileys distinta); se omite el parche');
    return;
  }

  const indent = match[1];
  const guard = [
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
    `${indent}// primario. Sin ella el patch se va corrupto y también expulsan el dispositivo.`,
    `${indent}if (!authState.creds?.appStateSyncKey) {`,
    `${indent}    throw new Boom(`,
    `${indent}        'App state sync key missing for ' + name +`,
    `${indent}            + ': refusing to send an app-state patch without the primary device key (it removes this device with 401 conflict/device_removed)',`,
    `${indent}        { statusCode: 400 },`,
    `${indent}    );`,
    `${indent}}`,
  ].join('\n');

  const patched = source.replace(re, `${match[0]}\n${guard}`);
  fs.writeFileSync(target, patched);
  console.log('[patch-baileys] guard de app-state aplicado a Baileys');
}

try {
  main();
} catch (error) {
  console.warn('[patch-baileys] no se pudo aplicar el parche:', error && error.message ? error.message : error);
}
