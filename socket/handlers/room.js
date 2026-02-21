import { createRoom, getRoom, addPlayer, removePlayer, updateRoom, toRoomInfo, toRoomDetail } from '../store/rooms.js';
import { LobbyEvents, RoomEvents } from '../contracts.js';

/**
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 * @param {import("../contracts.js").RoomCreatePayload} payload
 */
export function handleRoomCreate(io, socket, payload) {
  const { name, pace, isPrivate, password, maxPlayers } = payload;
  const { userId, username } = socket.data;

  if (!name?.trim()) {
    return socket.emit(RoomEvents.ERROR, {
      code: 'INVALID_PAYLOAD',
      message: 'name is required',
    });
  }

  const room = createRoom(socket.id, userId, username, {
    name: name.trim(),
    pace,
    isPrivate,
    password,
    maxPlayers,
  });

  socket.leave('lobby');
  socket.join(room.id);

  socket.emit(RoomEvents.JOINED, { roomDetail: toRoomDetail(room) });
  io.to('lobby').emit(LobbyEvents.ROOM_ADDED, toRoomInfo(room));

  console.log(`[room] ${username} (${socket.id}) created room: ${room.id} "${name}"`);
}

/**
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 * @param {import("../contracts.js").RoomJoinPayload} payload
 */
export function handleRoomJoin(io, socket, payload) {
  const { roomId, password } = payload;
  const { userId, username } = socket.data;

  const room = getRoom(roomId);
  if (!room) {
    return socket.emit(RoomEvents.ERROR, { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
  }
  if (room.status !== 'waiting') {
    return socket.emit(RoomEvents.ERROR, { code: 'GAME_IN_PROGRESS', message: 'Game already started' });
  }
  if (room.players.length >= room.maxPlayers) {
    return socket.emit(RoomEvents.ERROR, { code: 'ROOM_FULL', message: 'Room is full' });
  }
  if (room.isPrivate && room.password !== (password ?? null)) {
    return socket.emit(RoomEvents.ERROR, { code: 'WRONG_PASSWORD', message: 'Incorrect password' });
  }

  const result = addPlayer(roomId, socket.id, userId, username);
  if (!result) {
    return socket.emit(RoomEvents.ERROR, { code: 'JOIN_FAILED', message: 'Could not join room' });
  }

  socket.leave('lobby');
  socket.join(roomId);

  io.to(roomId).emit(RoomEvents.JOINED, { roomDetail: toRoomDetail(room) });
  io.to('lobby').emit(LobbyEvents.ROOM_UPDATED, toRoomInfo(room));

  console.log(`[room] ${username} (${socket.id}) joined room: ${roomId}`);
}

/**
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 * @param {import("../contracts.js").RoomLeavePayload} payload
 */
export function handleRoomLeave(io, socket, payload) {
  const { roomId } = payload;
  const { userId, username } = socket.data;

  const { room, deleted } = removePlayer(roomId, socket.id);
  if (!room) {
    return socket.emit(RoomEvents.ERROR, { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
  }

  socket.leave(roomId);
  socket.join('lobby');

  if (deleted) {
    socket.emit(RoomEvents.LEFT, { roomId });
    io.to('lobby').emit(LobbyEvents.ROOM_REMOVED, roomId);
    console.log(`[room] Room ${roomId} removed (empty)`);
  } else {
    socket.emit(RoomEvents.LEFT, { roomId });
    io.to(roomId).emit(RoomEvents.LEFT, { roomId, roomDetail: toRoomDetail(room) });
    io.to('lobby').emit(LobbyEvents.ROOM_UPDATED, toRoomInfo(room));
    console.log(`[room] ${username} (userId: ${userId}) left room: ${roomId}`);
  }
}

/**
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 * @param {import("../contracts.js").RoomUpdatePayload} payload
 */
export function handleRoomUpdate(io, socket, payload) {
  const { roomId, name, pace, isPrivate, maxPlayers, password } = payload;
  const { userId, username } = socket.data;

  const room = getRoom(roomId);
  if (!room) {
    return socket.emit(RoomEvents.ERROR, { code: 'ROOM_NOT_FOUND', message: 'Room not found' });
  }
  if (room.hostUserId !== userId) {
    return socket.emit(RoomEvents.ERROR, { code: 'NOT_HOST', message: 'Only the host can update room settings' });
  }
  if (room.status !== 'waiting') {
    return socket.emit(RoomEvents.ERROR, { code: 'GAME_IN_PROGRESS', message: 'Cannot change settings while a game is in progress' });
  }
  if (maxPlayers !== undefined && maxPlayers < room.players.length) {
    return socket.emit(RoomEvents.ERROR, {
      code: 'MAX_PLAYERS_TOO_LOW',
      message: `maxPlayers cannot be less than the current player count (${room.players.length})`,
    });
  }

  const clampedMaxPlayers = maxPlayers !== undefined
    ? Math.min(Math.max(Number(maxPlayers), 2), 4)
    : undefined;

  updateRoom(roomId, { name: name?.trim(), pace, isPrivate, maxPlayers: clampedMaxPlayers, password });

  io.to(roomId).emit(RoomEvents.UPDATED, { roomDetail: toRoomDetail(room) });
  io.to('lobby').emit(LobbyEvents.ROOM_UPDATED, toRoomInfo(room));

  console.log(`[room] ${username} (userId: ${userId}) updated room: ${roomId}`);
}
