// Meeting rooms («حلقة»): the server only introduces participants to each other and relays small messages.
// Audio and video travel directly between browsers (WebRTC); the server never sees them.
// Each participant holds one Server-Sent Events stream for incoming messages and POSTs what it sends.
// Chat and the whiteboard are kept in memory for the life of the room, so late joiners see what came before.
const crypto = require('node:crypto');

const MAX_PEERS = 8, MAX_BODY = 256 * 1024, MAX_CHAT = 300, MAX_BOARD = 3000, HEARTBEAT = 25000;
const rooms = new Map();
const ROOM_ID = /^[a-z0-9-]{3,40}$/;

function room(id) {
  let r = rooms.get(id);
  if (!r) { r = {peers: new Map(), chat: [], board: [], created: Date.now()}; rooms.set(id, r); }
  return r;
}
const publicPeer = p => ({id: p.id, name: p.name, state: p.state});
// Messages for a participant whose event stream is not open yet (they just joined, or are reconnecting) are held
// and sent as soon as it opens; dropping them would lose the connection offer that starts the call.
function deliver(peer, message) {
  if (peer.stream) peer.stream.write(`data: ${JSON.stringify(message)}\n\n`);
  else if (peer.pending.length < 500) peer.pending.push(message);
}
function broadcast(r, message, exceptId) { for (const p of r.peers.values()) if (p.id !== exceptId) deliver(p, message); }

function leave(roomId, peerId) {
  const r = rooms.get(roomId);
  if (!r || !r.peers.has(peerId)) return;
  r.peers.delete(peerId);
  broadcast(r, {type: 'leave', from: peerId});
  if (!r.peers.size) rooms.delete(roomId);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(Error('too large'), {status: 413})); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(Error('bad json'), {status: 400})); } });
    req.on('error', reject);
  });
}
const clean = (text, max) => String(text ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

// Whiteboard operations are replayed in order for late joiners; strokes are upserted by id while being drawn.
function applyBoard(r, op) {
  if (op.op === 'clear') { r.board = []; return true; }
  if (op.op === 'remove') { r.board = r.board.filter(item => item.id !== op.id); return true; }
  if (op.op === 'item' && op.item && typeof op.item.id === 'string') {
    const i = r.board.findIndex(item => item.id === op.item.id);
    if (i >= 0) r.board[i] = op.item; else if (r.board.length < MAX_BOARD) r.board.push(op.item); else return false;
    return true;
  }
  return false;
}

async function handleMeeting(req, res, send, pathname) {
  const json = (status, body) => send(req, res, status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}, JSON.stringify(body));
  const url = new URL(req.url, 'http://localhost');
  // Only the app's own pages may use the rooms.
  const origin = req.headers.origin;
  if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return json(403, {error: 'forbidden'});

  if (pathname === '/api/meet/join' && req.method === 'POST') {
    let body; try { body = await readJson(req); } catch (e) { return json(e.status || 400, {error: 'bad_request'}); }
    const roomId = clean(body.room, 40).toLowerCase(), name = clean(body.name, 40) || 'ضيف';
    if (!ROOM_ID.test(roomId)) return json(400, {error: 'bad_room'});
    const r = room(roomId);
    if (r.peers.size >= MAX_PEERS) return json(409, {error: 'room_full', max: MAX_PEERS});
    const peer = {id: crypto.randomUUID().slice(0, 8), token: crypto.randomBytes(16).toString('hex'), name, state: {mic: true, cam: true, hand: false, screen: false}, stream: null, pending: []};
    const others = [...r.peers.values()].map(publicPeer);
    r.peers.set(peer.id, peer);
    broadcast(r, {type: 'join', from: peer.id, peer: publicPeer(peer)}, peer.id);
    // A participant who never opens their event stream (closed tab mid-join) is removed rather than kept forever.
    setTimeout(() => { if (!peer.stream && rooms.get(roomId)?.peers.get(peer.id) === peer) leave(roomId, peer.id); }, 30000).unref();
    return json(200, {peer: peer.id, token: peer.token, name, peers: others, chat: r.chat, board: r.board, max: MAX_PEERS});
  }

  if (pathname === '/api/meet/events' && req.method === 'GET') {
    const roomId = url.searchParams.get('room') || '', r = rooms.get(roomId), peer = r?.peers.get(url.searchParams.get('peer') || '');
    if (!peer || peer.token !== url.searchParams.get('token')) return json(403, {error: 'not_joined'});
    res.writeHead(200, {'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
    peer.stream?.end();
    peer.stream = res;
    res.write(': connected\n\n');
    for (const message of peer.pending.splice(0)) deliver(peer, message);
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT);
    // The response closes when the connection dies (tab closed, browser crashed, network lost): the participant leaves.
    const gone = () => { clearInterval(beat); if (peer.stream === res) { peer.stream = null; leave(roomId, peer.id); } };
    res.on('close', gone);
    res.on('error', gone);
    return;
  }

  if (pathname === '/api/meet/send' && req.method === 'POST') {
    let body; try { body = await readJson(req); } catch (e) { return json(e.status || 400, {error: 'bad_request'}); }
    const r = rooms.get(body.room), peer = r?.peers.get(body.peer);
    if (!peer || peer.token !== body.token) return json(403, {error: 'not_joined'});
    const message = {type: body.type, from: peer.id};
    switch (body.type) {
      // WebRTC set-up goes to one participant only.
      case 'signal': {
        const target = r.peers.get(body.to);
        if (!target) return json(404, {error: 'no_peer'});
        deliver(target, {...message, data: body.data});
        return json(200, {ok: true});
      }
      case 'chat': {
        const text = clean(body.text, 2000);
        if (!text) return json(400, {error: 'empty'});
        const entry = {id: crypto.randomUUID().slice(0, 8), from: peer.id, name: peer.name, text, at: Date.now()};
        r.chat.push(entry); if (r.chat.length > MAX_CHAT) r.chat.shift();
        broadcast(r, {...message, entry});
        return json(200, {ok: true, entry});
      }
      case 'state': {
        const s = body.state || {};
        peer.state = {mic: !!s.mic, cam: !!s.cam, hand: !!s.hand, screen: !!s.screen};
        broadcast(r, {...message, state: peer.state}, peer.id);
        return json(200, {ok: true});
      }
      case 'board': {
        if (!applyBoard(r, body.op || {})) return json(400, {error: 'bad_board'});
        broadcast(r, {...message, op: body.op}, peer.id);
        return json(200, {ok: true});
      }
      case 'reaction': {
        broadcast(r, {...message, emoji: clean(body.emoji, 8)}, peer.id);
        return json(200, {ok: true});
      }
      case 'leave': leave(body.room, peer.id); return json(200, {ok: true});
      default: return json(400, {error: 'bad_type'});
    }
  }
  return json(404, {error: 'not_found'});
}

module.exports = {handleMeeting, rooms, MAX_PEERS};
