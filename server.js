const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// ─── Serve static frontend ───
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory store ───
// socketUsers: socket.id → { username, roomId }
// roomUsers:   roomId   → Set of socket.ids
const socketUsers = new Map();
const roomUsers   = new Map();

function getRoomUserList(roomId) {
  const ids = roomUsers.get(roomId) || new Set();
  return [...ids].map(id => {
    const u = socketUsers.get(id);
    return u ? { socketId: id, username: u.username } : null;
  }).filter(Boolean);
}

// ─── Socket.io logic ───
io.on('connection', (socket) => {
  console.log(`[+] Connected: ${socket.id}`);

  // ── JOIN ROOM ──
  socket.on('join_room', ({ roomId, username }) => {
    if (!roomId || !username) return;

    roomId   = roomId.trim();
    username = username.trim().slice(0, 20);

    // Leave any previous room first (handles reconnects)
    const prev = socketUsers.get(socket.id);
    if (prev) {
      leaveRoom(socket, prev.roomId);
    }

    // Register user
    socketUsers.set(socket.id, { username, roomId });

    if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Set());
    roomUsers.get(roomId).add(socket.id);

    socket.join(roomId);

    console.log(`  [room:${roomId}] ${username} joined (${socket.id})`);

    // Tell the room someone joined
    socket.to(roomId).emit('user_joined', { username });

    // Send updated user list to EVERYONE in the room
    io.to(roomId).emit('room_users', getRoomUserList(roomId));
  });

  // ── SEND MESSAGE ──
  socket.on('send_message', ({ roomId, message, username, selfDestruct }) => {
    if (!roomId || !message) return;

    roomId  = roomId.trim();
    message = message.slice(0, 2000);

    const payload = {
      username,
      message,
      selfDestruct: !!selfDestruct,
      ts: Date.now(),
    };

    // Relay to everyone else in the room (NOT the sender — sender already shows it locally)
    socket.to(roomId).emit('receive_message', payload);

    console.log(`  [room:${roomId}] <${username}> ${message.slice(0, 60)}`);
  });

  // ── TYPING ──
  socket.on('typing', ({ roomId, username }) => {
    if (!roomId) return;
    socket.to(roomId.trim()).emit('user_typing', { username });
  });

  // ── PING ──
  socket.on('ping_room', ({ roomId, username }) => {
    if (!roomId) return;
    socket.to(roomId.trim()).emit('room_ping', { username });
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    const user = socketUsers.get(socket.id);
    if (user) {
      leaveRoom(socket, user.roomId);
      console.log(`[-] Disconnected: ${user.username} (${socket.id})`);
    }
  });

  // ── LEAVE ROOM ──
  socket.on('leave_room', () => {
    const user = socketUsers.get(socket.id);
    if (user) leaveRoom(socket, user.roomId);
  });
});

function leaveRoom(socket, roomId) {
  const user = socketUsers.get(socket.id);
  if (!user) return;

  socket.leave(roomId);

  const set = roomUsers.get(roomId);
  if (set) {
    set.delete(socket.id);
    if (set.size === 0) roomUsers.delete(roomId);
  }

  socketUsers.delete(socket.id);

  // Notify room
  socket.to(roomId).emit('user_left', { username: user.username });
  io.to(roomId).emit('room_users', getRoomUserList(roomId));
}

// ─── Health check (Replit / Railway) ───
app.get('/health', (_, res) => res.json({ status: 'ok', rooms: roomUsers.size }));

// ─── Start ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🔐 CipherRoom server running on port ${PORT}`);
  console.log(`   http://localhost:${PORT}\n`);
});
