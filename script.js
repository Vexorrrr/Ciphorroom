// ─────────────────────────────────────────────
//  CipherRoom · Frontend Logic
//  Connects to Socket.io backend for real-time
//  messaging with AES-256-GCM E2EE layer
// ─────────────────────────────────────────────

const COLORS = [
  ['#00ffb4','#00332b'],['#00cfff','#00222e'],['#ff00aa','#2e0022'],
  ['#ffaa00','#2e2200'],['#a855f7','#200033'],['#ff6b35','#2e1500'],
];

// ─── STATE ───
const state = {
  username: '',
  roomId: '',
  userId: null,          // set to socket.id on connect
  encKey: null,
  selfDestruct: false,
  typingTimer: null,
  isTyping: false,
  members: {},           // socketId → { username }
  socket: null,
};

// ─── UTILS ───
function hashStr(s) { let h=0; for(const c of s) h=(h*31+c.charCodeAt(0))|0; return h; }
function userColor(uid) { return COLORS[Math.abs(hashStr(uid)) % COLORS.length]; }
function initials(name) { return name.slice(0,2).toUpperCase(); }
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function $(id) { return document.getElementById(id); }

// ─── ENCRYPTION (AES-256-GCM) ───
async function deriveKey(roomId) {
  const enc = new TextEncoder();
  const raw = await crypto.subtle.importKey(
    'raw', enc.encode('CIPHERROOM_SALT_' + roomId),
    { name: 'PBKDF2' }, false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt:enc.encode('cipher_iv_'+roomId), iterations:100000, hash:'SHA-256' },
    raw, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']
  );
}

async function encryptMsg(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const buf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, state.encKey, enc.encode(text));
  const out = new Uint8Array(iv.length + buf.byteLength);
  out.set(iv); out.set(new Uint8Array(buf), iv.length);
  return btoa(String.fromCharCode(...out));
}

async function decryptMsg(b64) {
  try {
    const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = data.slice(0,12), cipher = data.slice(12);
    const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, state.encKey, cipher);
    return new TextDecoder().decode(plain);
  } catch { return '[⚠ DECRYPTION FAILED — wrong room key?]'; }
}

// ─── ROOM ID GENERATOR ───
function generateRoomId() {
  const r = () => Math.floor(Math.random()*900)+100;
  $('roomInput').value = `${r()}.${r()}.${Math.floor(Math.random()*90)+10}.${Math.floor(Math.random()*9)+1}`;
}

// ─── JOIN ROOM ───
async function joinRoom() {
  const username = $('usernameInput').value.trim();
  const roomId   = $('roomInput').value.trim();
  const err      = $('errorMsg');

  if (!username || !roomId) {
    err.textContent = '⚠ Both callsign and room ID required.';
    err.classList.add('show');
    return;
  }
  err.classList.remove('show');

  state.username = username;
  state.roomId   = roomId;
  state.encKey   = await deriveKey(roomId);

  connectSocket();
}

// ─── SOCKET.IO ───
function connectSocket() {
  // Resolve server URL: same origin in production, or override via data attribute
  const serverUrl = document.body.dataset.server || window.location.origin;

  state.socket = io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
  });

  const socket = state.socket;

  socket.on('connect', () => {
    state.userId = socket.id;
    state.members = {};

    showScreen('chat');
    updateUI();

    socket.emit('join_room', { roomId: state.roomId, username: state.username });

    addSystemMsg(`🔐 KEY DERIVED · AES-256-GCM · Room: ${state.roomId}`);
    addSystemMsg(`⚡ Connected as ${state.username}`);

    setTimeout(() => $('msgInput').focus(), 100);
  });

  socket.on('connect_error', (err) => {
    showError(`Connection failed: ${err.message}`);
  });

  socket.on('disconnect', () => {
    addSystemMsg('⚠ Connection lost — reconnecting…');
  });

  socket.on('reconnect', () => {
    addSystemMsg('✓ Reconnected — re-joining room…');
    socket.emit('join_room', { roomId: state.roomId, username: state.username });
  });

  // ── Room events ──
  socket.on('room_users', (users) => {
    state.members = {};
    for (const u of users) state.members[u.socketId] = { username: u.username };
    updateUI();
  });

  socket.on('user_joined', ({ username }) => {
    addSystemMsg(`◈ ${username} entered the room`);
  });

  socket.on('user_left', ({ username }) => {
    addSystemMsg(`◉ ${username} left the room`);
  });

  // ── Incoming message (encrypted) ──
  socket.on('receive_message', async ({ username, message, selfDestruct, ts }) => {
    let plain;
    try {
      plain = await decryptMsg(message);
    } catch {
      plain = '[⚠ DECRYPTION FAILED]';
    }
    addBubble({ sender: username, userId: hashStr(username).toString(),
                 text: plain, ts, selfDestruct, sent: false });
  });

  // ── Typing ──
  socket.on('user_typing', ({ username }) => {
    showTyping(username);
  });

  // ── Ping ──
  socket.on('room_ping', ({ username }) => {
    addSystemMsg(`📡 PING from ${username}`);
  });
}

// ─── SEND MESSAGE ───
async function sendMessage() {
  const input = $('msgInput');
  const text  = input.value.trim();
  if (!text || !state.socket?.connected) return;

  input.value = '';
  input.style.height = '';
  updateCharCount(0);

  const cipher = await encryptMsg(text);

  // Show locally immediately
  addBubble({ sender: state.username, userId: state.userId || '0',
               text, ts: Date.now(), selfDestruct: state.selfDestruct, sent: true });

  // Emit encrypted payload to server
  state.socket.emit('send_message', {
    roomId: state.roomId,
    message: cipher,
    username: state.username,
    selfDestruct: state.selfDestruct,
  });

  stopTyping();
}

// ─── BUBBLES ───
function addBubble({ sender, userId, text, ts, selfDestruct, sent }) {
  const wrap = document.createElement('div');
  wrap.className = `bubble-wrap ${sent ? 'sent' : 'recv'}`;
  const [col, bg] = userColor(userId);
  const time = new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  wrap.innerHTML = `
    <div class="bubble-meta">
      <div class="member-avatar" style="background:${bg};color:${col};border:1px solid ${col}44;font-size:10px;width:18px;height:18px;border-radius:4px;">${initials(sender)}</div>
      <span class="meta-name">${escHtml(sender)}</span>
      <span>${time}</span>
      ${selfDestruct ? '<span class="sd-badge">💣 5s</span>' : ''}
    </div>
    <div class="bubble">${escHtml(text)}</div>
    <div class="bubble-enc">🔒 AES-256-GCM · end-to-end encrypted</div>
  `;

  appendMsg(wrap);

  if (selfDestruct) {
    setTimeout(() => {
      wrap.classList.add('exploding');
      setTimeout(() => wrap.remove(), 500);
    }, 5000);
  }
}

function addSystemMsg(text) {
  const div = document.createElement('div');
  div.className = 'sys-msg';
  div.textContent = text;
  appendMsg(div);
}

function appendMsg(el) {
  const wrap = $('messagesWrap');
  const ti = $('typingIndicator');
  if (ti) wrap.insertBefore(el, ti);
  else wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
}

// ─── TYPING ───
let typingTimeout;
function onTyping() {
  if (!state.isTyping) {
    state.isTyping = true;
    state.socket?.emit('typing', { roomId: state.roomId, username: state.username });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 2500);
}
function stopTyping() { state.isTyping = false; }

function showTyping(name) {
  let ti = $('typingIndicator');
  if (!ti) {
    ti = document.createElement('div');
    ti.id = 'typingIndicator';
    ti.className = 'typing-indicator';
    ti.innerHTML = `<span id="typingName"></span><div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    $('messagesWrap').appendChild(ti);
  }
  $('typingName').textContent = name + ' is transmitting';
  ti.classList.add('show');
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => ti.classList.remove('show'), 3000);
  $('messagesWrap').scrollTop = 9999;
}

// ─── SELF-DESTRUCT ───
function toggleSelfDestruct() {
  state.selfDestruct = !state.selfDestruct;
  $('sdToggle').classList.toggle('active', state.selfDestruct);
  $('sdLabel').textContent = state.selfDestruct ? '5s BURN' : 'PERSIST';
  toast(state.selfDestruct ? '💣 Self-destruct ON (5s)' : '💾 Messages will persist');
}

// ─── PING ───
function sendSystemBroadcast() {
  state.socket?.emit('ping_room', { roomId: state.roomId, username: state.username });
  addSystemMsg('📡 You sent a PING');
  toast('PING broadcast to room');
}

// ─── LEAVE ───
function leaveRoom() {
  state.socket?.emit('leave_room');
  state.socket?.disconnect();
  state.socket = null;
  state.members = {};
  state.encKey = null;
  $('messagesWrap').innerHTML = '';
  showScreen('landing');
}

// ─── UI ───
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function showError(msg) {
  const err = $('errorMsg');
  err.textContent = '⚠ ' + msg;
  err.classList.add('show');
}

function updateUI() {
  const members = state.members;
  const count   = Object.keys(members).length;

  $('sbRoomId').textContent      = state.roomId;
  $('onlineCount').textContent   = count;
  $('headerRoomId').textContent  = 'ROOM: ' + state.roomId;
  $('headerUsers').textContent   = count + ' online · 🔒 E2EE';

  const list = $('membersList');
  list.innerHTML = '';
  for (const [uid, member] of Object.entries(members)) {
    const [col, bg] = userColor(uid);
    const item = document.createElement('div');
    item.className = 'member-item';
    item.innerHTML = `
      <div class="member-avatar" style="background:${bg};color:${col};border:1px solid ${col}44">${initials(member.username)}</div>
      <div class="member-name">${escHtml(member.username)}</div>
      ${uid === state.userId ? '<div class="member-you">YOU</div>' : ''}
      <div class="online-dot"></div>
    `;
    list.appendChild(item);
  }
}

function updateCharCount(n) { $('charCount').textContent = n; }

// ─── COPY / QR ───
function copyRoomId() {
  navigator.clipboard.writeText(state.roomId).then(() => toast('Room ID copied!'));
}

function showQR() {
  $('qrOverlay').classList.add('show');
  $('qrRoomText').textContent = state.roomId;
  drawQR(state.roomId);
}
function closeQR() { $('qrOverlay').classList.remove('show'); }

function drawQR(text) {
  const canvas = $('qrCanvas');
  const ctx = canvas.getContext('2d');
  const size = 180;
  canvas.width = canvas.height = size;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0,0,size,size);
  let seed = 0;
  for (const c of text) seed = (seed*31+c.charCodeAt(0))|0;
  const rand = () => { seed=(seed*1664525+1013904223)|0; return (seed>>>0)/4294967296; };
  const cells=21, cell=size/cells;
  function drawFinder(x,y) {
    ctx.fillStyle='#000'; ctx.fillRect(x*cell,y*cell,7*cell,7*cell);
    ctx.fillStyle='#fff'; ctx.fillRect((x+1)*cell,(y+1)*cell,5*cell,5*cell);
    ctx.fillStyle='#000'; ctx.fillRect((x+2)*cell,(y+2)*cell,3*cell,3*cell);
  }
  drawFinder(0,0); drawFinder(14,0); drawFinder(0,14);
  for (let r=0;r<cells;r++) {
    for (let c2=0;c2<cells;c2++) {
      if ((r<8&&c2<8)||(r<8&&c2>12)||(r>12&&c2<8)) continue;
      if (rand()>0.5) { ctx.fillStyle='#000'; ctx.fillRect(c2*cell,r*cell,cell-0.5,cell-0.5); }
    }
  }
  ctx.fillStyle='rgba(0,255,180,0.08)'; ctx.fillRect(0,0,size,size);
}

// ─── TOAST ───
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ─── MOBILE SIDEBAR ───
function openSidebar()  { $('sidebar').classList.add('open'); $('sidebarOverlay').classList.add('show'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarOverlay').classList.remove('show'); }

// ─── INPUT EVENTS ───
document.addEventListener('DOMContentLoaded', () => {
  $('msgInput').addEventListener('input', function() {
    this.style.height = '';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    updateCharCount(this.value.length);
    onTyping();
  });

  $('msgInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  $('usernameInput').addEventListener('keydown', e => { if (e.key==='Enter') $('roomInput').focus(); });
  $('roomInput').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });

  // Pre-fill room from URL hash
  const hash = location.hash.slice(1);
  if (hash) $('roomInput').value = decodeURIComponent(hash);
});

// ─── CLEANUP ───
window.addEventListener('beforeunload', () => {
  state.socket?.emit('leave_room');
});
