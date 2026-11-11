const crypto = require('node:crypto');
const XANAX_ID = 206;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const integer = (n) => Number.isSafeInteger(n) && n > 0;

function decodeEntities(text) {
  return text.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (part) => {
    const names = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (names[part.toLowerCase()]) return names[part.toLowerCase()];
    const n = part[2].toLowerCase() === 'x' ? parseInt(part.slice(3, -1), 16) : parseInt(part.slice(2, -1), 10);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '\ufffd';
  });
}

function senderFromAnchor(attributes) {
  const values = new Map();
  let rest = attributes;
  while (rest.trim()) {
    const match = rest.match(/^\s*([a-zA-Z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/);
    if (!match || values.has(match[1].toLowerCase()) || !['href', 'class', 'title', 'target', 'rel'].includes(match[1].toLowerCase())) return null;
    values.set(match[1].toLowerCase(), decodeEntities(match[2] ?? match[3]));
    rest = rest.slice(match[0].length);
  }
  const href = values.get('href');
  if (!href || /[\u0000-\u0020\\]/.test(href)) return null;
  try {
    const url = new URL(href, 'https://www.torn.com/');
    if (!['https://www.torn.com', 'https://torn.com'].includes(url.origin) || url.username || url.password || url.hash || url.pathname !== '/profiles.php') return null;
    if ([...url.searchParams.keys()].some((key) => key !== 'XID') || url.searchParams.getAll('XID').length !== 1) return null;
    const raw = url.searchParams.get('XID');
    if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
    const id = Number(raw);
    return integer(id) ? id : null;
  } catch { return null; }
}

function normalizeEvents(payload, source = 'torn-v2-events') {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Object.assign(new Error('Invalid event response'), { code: 'EVENT_SCHEMA' });
  if (source === 'torn-v2-events') {
    if (!Array.isArray(payload.events) || payload.events.length > 100) throw Object.assign(new Error('Invalid v2 events'), { code: 'EVENT_SCHEMA' });
    return payload.events;
  }
  if (source === 'torn-v1-events' && payload.events && typeof payload.events === 'object' && !Array.isArray(payload.events)) {
    return Object.entries(payload.events).map(([id, value]) => ({ ...value, id }));
  }
  throw Object.assign(new Error('Unsupported event response'), { code: 'EVENT_SCHEMA' });
}

function parseEvent(event, now = Math.floor(Date.now() / 1000)) {
  const id = event?.id;
  const timestamp = event?.timestamp;
  const raw = event?.event;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw Object.assign(new Error('Event ID is invalid'), { code: 'EVENT_ID' });
  if (!integer(timestamp) || timestamp > now + 60) throw Object.assign(new Error('Event timestamp is invalid'), { code: 'EVENT_TIMESTAMP' });
  const text = typeof raw === 'string' ? raw : '';
  const result = { eventId: id, timestamp, text: text.slice(0, 4096), payloadHash: hash(JSON.stringify([id, timestamp, raw])), verified: false, status: 'review', reason: 'unrecognized_transfer', senderId: null, itemId: null, itemName: null, quantity: null };
  if (!text || text.length > 4096) return { ...result, reason: 'invalid_event_text' };
  if (!/\b(?:sent|received)\b/i.test(text)) return { ...result, status: 'ignored', reason: 'not_a_transfer' };
  if (!/\bXanax\b/.test(text) && !/^You were sent /.test(text) && !/<\/a> sent you /.test(text)) return { ...result, status: 'ignored', reason: 'not_a_transfer' };
  const anchors = [...text.matchAll(/<a\s+([^<>]+)>([^<>]{1,200})<\/a>/gi)];
  if (anchors.length !== 1) return { ...result, reason: 'missing_or_ambiguous_sender' };
  const anchor = anchors[0];
  const senderId = senderFromAnchor(anchor[1]);
  if (!senderId) return { ...result, reason: 'invalid_sender_link' };
  const plain = text.slice(0, anchor.index) + '\u0000SENDER\u0000' + text.slice(anchor.index + anchor[0].length);
  if (/[<>]/.test(plain)) return { ...result, reason: 'unsupported_markup' };
  const match = plain.match(/^You were sent ([\d,]+)\s*x\s+(.+?) from \u0000SENDER\u0000\.?$/)
    || plain.match(/^\u0000SENDER\u0000 sent you ([\d,]+)\s*x\s+(.+?)\.?$/);
  if (!match) return { ...result, reason: 'unrecognized_transfer' };
  if (!/^(?:[1-9]\d{0,5}|[1-9]\d{0,2}(?:,\d{3})+)$/.test(match[1])) return { ...result, reason: 'invalid_quantity' };
  const quantity = Number(match[1].replace(/,/g, ''));
  if (!integer(quantity) || quantity > 1_000_000) return { ...result, reason: 'invalid_quantity' };
  const itemName = decodeEntities(match[2]);
  if (itemName !== 'Xanax') return { ...result, senderId, itemName: itemName.slice(0, 100), quantity, status: 'ignored', reason: 'not_xanax' };
  return { ...result, verified: true, status: 'verified', reason: null, senderId, itemName: 'Xanax', itemId: XANAX_ID, quantity };
}
module.exports = { parseEvent, normalizeEvents, senderFromAnchor, XANAX_ID };
