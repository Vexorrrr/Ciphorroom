# 🔐 CipherRoom — Real-Time E2EE Chat

A real-time, end-to-end encrypted anonymous chat app.
Users join rooms by sharing an IP-style Room ID (e.g. `877.199.8.7`).

## Tech Stack
- **Backend:** Node.js + Express + Socket.io
- **Frontend:** Vanilla HTML/CSS/JS
- **Encryption:** Web Crypto API (AES-256-GCM, PBKDF2 key derivation)

## File Structure
```
cipherroom/
├── server.js          ← Node.js backend (Socket.io)
├── package.json
└── public/
    ├── index.html     ← UI shell
    └── script.js      ← Frontend logic + E2EE + socket events
```

---

## Run Locally

```bash
npm install
npm start
# Open http://localhost:3000 in two tabs
# Enter the same Room ID in both → you're connected!
```

---

## Deploy to Replit

1. Create a new **Node.js** Repl
2. Upload all files (keep the `public/` folder structure)
3. In `package.json`, make sure `"main": "server.js"` and `"start": "node server.js"`
4. Click **Run** — Replit auto-assigns a port via `process.env.PORT`
5. Share the Replit URL + a Room ID with friends

---

## Deploy to Railway

```bash
# Connect your GitHub repo, then:
railway up
# Railway auto-detects Node.js and uses process.env.PORT
```

## Deploy to Render

- New Web Service → connect repo
- Build command: `npm install`
- Start command: `node server.js`
- Render sets `PORT` automatically

---

## How E2EE Works

1. When you join a room, the client derives an **AES-256-GCM key** from the Room ID using PBKDF2 (100,000 iterations).
2. Every message is **encrypted on your device** before being sent to the server.
3. The server sees only **ciphertext** — it never has access to the Room ID key.
4. Recipients decrypt messages locally using the same derived key.
5. Two people in the same room automatically share the same key (derived identically from the same Room ID).

> ⚠️ Note: This model uses a **room-shared key** (symmetric). For maximum security in production, use a Diffie-Hellman key exchange per user pair.

---

## Socket Events

| Event | Direction | Payload |
|---|---|---|
| `join_room` | client → server | `{ roomId, username }` |
| `send_message` | client → server | `{ roomId, message (cipher), username, selfDestruct }` |
| `receive_message` | server → client | `{ message (cipher), username, ts, selfDestruct }` |
| `room_users` | server → client | `[{ socketId, username }]` |
| `user_joined` | server → client | `{ username }` |
| `user_left` | server → client | `{ username }` |
| `typing` | client → server | `{ roomId, username }` |
| `user_typing` | server → client | `{ username }` |
| `ping_room` | client → server | `{ roomId, username }` |
| `room_ping` | server → client | `{ username }` |
| `leave_room` | client → server | — |
