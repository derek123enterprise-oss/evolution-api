/**
 * [Lylead] Ack de las estrofas <status> para Baileys 7.
 *
 * WhatsApp empezó a entregar los Estados de los contactos como una estrofa
 * <status> de primer nivel (no como <message from="status@broadcast">). Baileys
 * 7.0.0-rc14 no la maneja, así que nunca la confirma. ~50 min después el servidor
 * cierra el socket con <stream:error><ack class="status" type="media"/></stream:error>
 * y, mientras tanto, RETIENE los mensajes entrantes del número: llegan en ráfagas
 * en cada reconexión, a veces con horas de atraso.
 *
 * El parche solo confirma la estrofa (no la decodifica). Es el backport de
 * WhiskeySockets/Baileys#2883 (issue #2858; evolution-api#2778 / PR #2785).
 * Se puede quitar cuando una versión de Baileys lo traiga.
 *
 * Idempotente: si ya está aplicado no hace nada. Si el código de Baileys no
 * coincide con lo esperado, avisa y no toca nada (no rompe el arranque).
 */
const fs = require('fs');

const MARKER = 'LYLEAD_STATUS_ACK';
const target = process.argv[2] || '/evolution/node_modules/baileys/lib/Socket/messages-recv.js';

// Donde se crea el procesador de nodos offline (rc14: con el Map en línea; rc9: fábrica local).
const PROCESSOR_ANCHOR = /^([ \t]*)const (?:offlineNodeProcessor = makeOfflineNodeProcessor\(new Map\(|makeOfflineNodeProcessor = \(\) =>)/m;
const MAP_ENTRY = /(\[\s*'notification',\s*handleNotification\s*\])(\s*\n([ \t]*)\])/;
const LISTENER_ANCHOR = /^([ \t]*)ws\.on\('CB:ack,class:message'/m;

function main() {
  if (!fs.existsSync(target)) {
    console.log('[patch-baileys-status] no existe el objetivo; se omite el parche');
    return;
  }
  let source = fs.readFileSync(target, 'utf8');
  if (source.includes(MARKER)) {
    console.log('[patch-baileys-status] el ack de <status> ya está aplicado');
    return;
  }
  if (/ws\.on\('CB:status'/.test(source)) {
    console.log('[patch-baileys-status] esta versión de Baileys ya maneja <status>; no hace falta el parche');
    return;
  }

  const proc = source.match(PROCESSOR_ANCHOR);
  const entry = source.match(MAP_ENTRY);
  const listener = source.match(LISTENER_ANCHOR);
  if (!proc || !entry || !listener || !source.includes('const sendMessageAck = ')) {
    console.warn('[patch-baileys-status] no se encontraron los anclajes en messages-recv.js (versión de Baileys distinta); se omite el parche');
    return;
  }

  const i = proc[1];
  const handler = [
    `${i}// ${MARKER}: WhatsApp entrega los Estados como estrofa <status>. Si no se`,
    `${i}// confirma, ~50 min después cierra el socket (stream:error ack class=status)`,
    `${i}// y retiene los mensajes entrantes. Solo se confirma; no se decodifica.`,
    `${i}const lyleadHandleStatus = async (node) => {`,
    `${i}    try {`,
    `${i}        await sendMessageAck(node);`,
    `${i}    }`,
    `${i}    catch (error) {`,
    `${i}        onUnexpectedError(error, 'acking status stanza');`,
    `${i}    }`,
    `${i}};`,
    '',
  ].join('\n');

  const l = listener[1];
  const wsListener = [
    `${l}// ${MARKER}`,
    `${l}ws.on('CB:status', async (node) => {`,
    `${l}    await processNode('status', node, 'acking status stanza', lyleadHandleStatus).catch(error => onUnexpectedError(error, 'acking status stanza'));`,
    `${l}});`,
    '',
  ].join('\n');

  // Orden: de atrás hacia adelante para no mover los índices de los anclajes previos.
  source = source.replace(LISTENER_ANCHOR, (m) => `${wsListener}${m}`);
  source = source.replace(MAP_ENTRY, (m, e, rest, ind) => `${e},\n${ind}    ['status', lyleadHandleStatus]${rest}`);
  source = source.replace(PROCESSOR_ANCHOR, (m) => `${handler}${m}`);

  fs.writeFileSync(target, source);
  console.log('[patch-baileys-status] ack de <status> aplicado a Baileys');
}

try {
  main();
} catch (error) {
  console.warn('[patch-baileys-status] no se pudo aplicar el parche:', error && error.message ? error.message : error);
}
