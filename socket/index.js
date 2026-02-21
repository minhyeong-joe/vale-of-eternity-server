import { handleRoomCreate, handleRoomJoin, handleRoomLeave, handleRoomUpdate } from './handlers/room.js';
import { handleLobbyRooms } from './handlers/lobby.js';
import { getRoomBySocketId, removePlayer, toRoomInfo } from './store/rooms.js';
import { LobbyEvents, RoomEvents } from './contracts.js';

export function registerSocketHandlers(io) {
  // Middleware: require userId + username on every connection
  io.use((socket, next) => {
    const { userId, username } = socket.handshake.auth;
    if (!userId?.trim() || !username?.trim()) {
      return next(new Error('UNAUTHORIZED'));
    }
    socket.data.userId = userId.trim();
    socket.data.username = username.trim();
    next();
  });

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id} userId: ${socket.data.userId} username: ${socket.data.username}`);

    // All sockets start in the lobby channel until they join a game room
    socket.join('lobby');

    socket.on(LobbyEvents.GET_ROOMS, () => handleLobbyRooms(io, socket));
    socket.on(RoomEvents.CREATE, (payload) => handleRoomCreate(io, socket, payload));
    socket.on(RoomEvents.JOIN, (payload) => handleRoomJoin(io, socket, payload));
    socket.on(RoomEvents.LEAVE, (payload) => handleRoomLeave(io, socket, payload));
    socket.on(RoomEvents.UPDATE, (payload) => handleRoomUpdate(io, socket, payload));

    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected: ${socket.id} userId: ${socket.data.userId} username: ${socket.data.username} — reason: ${reason}`);

      // Clean up any room the socket was in
      const room = getRoomBySocketId(socket.id);
      if (room) {
        const { room: updatedRoom, deleted } = removePlayer(room.id, socket.id);
        if (deleted) {
          io.to('lobby').emit(LobbyEvents.ROOM_REMOVED, room.id);
          console.log(`[room] Room ${room.id} removed (host disconnected)`);
        } else if (updatedRoom) {
          io.to('lobby').emit(LobbyEvents.ROOM_UPDATED, toRoomInfo(updatedRoom));
        }
      }
    });
  });
}
