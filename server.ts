import express from 'express';
import { createServer as createViteServer } from 'vite';
import { Server } from 'socket.io';
import http from 'http';
import os from 'os';
import { startHardwareMonitor, getHardwareSnapshot } from './services/hardwareMonitor';

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? false // Disable completely, serving from same origin
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Track connected users
  const users = new Map<string, string>(); // socketId -> username
  const activeCalls = new Map<string, string>(); // callerId -> calleeId

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('register', (username: string) => {
      users.set(socket.id, username);
      console.log(`User registered: ${username} (${socket.id})`);
      io.emit('users_update', Array.from(users.values()));
    });

    socket.on('start_call', ({ targetUser }: { targetUser: string }) => {
      const callerName = users.get(socket.id);
      if (!callerName) return;

      // Find target socket
      let targetSocketId = null;
      for (const [id, name] of users.entries()) {
        if (name === targetUser) {
          targetSocketId = id;
          break;
        }
      }

      if (targetSocketId) {
        activeCalls.set(socket.id, targetSocketId);
        activeCalls.set(targetSocketId, socket.id);
        io.to(targetSocketId).emit('incoming_call', { caller: callerName });
        socket.emit('call_started', { target: targetUser });
      } else {
        socket.emit('call_error', { message: `Usuario ${targetUser} no encontrado.` });
      }
    });

    socket.on('send_translated_message', ({ message }: { message: string }) => {
      const targetSocketId = activeCalls.get(socket.id);
      if (targetSocketId) {
        const senderName = users.get(socket.id);
        io.to(targetSocketId).emit('receive_translated_message', { sender: senderName, message });
      } else {
        socket.emit('call_error', { message: 'No estás en una llamada activa.' });
      }
    });

    socket.on('end_call', () => {
      const targetSocketId = activeCalls.get(socket.id);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
        activeCalls.delete(targetSocketId);
      }
      activeCalls.delete(socket.id);
      socket.emit('call_ended');
    });

    socket.on('disconnect', () => {
      console.log('User disconnected:', socket.id);
      const targetSocketId = activeCalls.get(socket.id);
      if (targetSocketId) {
        io.to(targetSocketId).emit('call_ended');
        activeCalls.delete(targetSocketId);
      }
      activeCalls.delete(socket.id);
      users.delete(socket.id);
      io.emit('users_update', Array.from(users.values()));
    });
  });

  // Initialize hardware monitoring engine and real-time Socket.io broadcaster
  startHardwareMonitor(io, 1000);

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/system-metrics', (req, res) => {
    const snapshot = getHardwareSnapshot();

    res.json({
      ...snapshot,
      serverReceivedAt: Date.now(),
      clientPingId: req.query.pingId || null,
      uptime: snapshot.serverUptimeSec,
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*all', (req, res) => {
      res.sendFile(process.cwd() + '/dist/index.html');
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
