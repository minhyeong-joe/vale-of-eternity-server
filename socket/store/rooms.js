import { randomUUID } from 'crypto';

/**
 * Internal room shape:
 * {
 *   id:           string,
 *   name:         string,
 *   hostSocketId: string,
 *   pace:         'chill' | 'slow' | 'fast',
 *   isPrivate:    boolean,
 *   password:     string | null,
 *   maxPlayers:   number,
 *   status:       'waiting' | 'in-progress' | 'finished',
 *   players:      Array<{ socketId: string, userId: string, username: string }>,
 * }
 */

/** @type {Map<string, object>} */
const rooms = new Map();

/**
 * @param {string} hostSocketId
 * @param {string} userId
 * @param {string} username
 * @param {{ name: string, pace?: string, isPrivate?: boolean, password?: string, maxPlayers?: number }} options
 */
export function createRoom(hostSocketId, userId, username, { name, pace, isPrivate, password, maxPlayers }) {
  const id = randomUUID();
  const room = {
    id,
    name,
    hostSocketId,
    hostUserId: userId,
    hostUsername: username,
    pace: pace ?? 'chill',
    isPrivate: isPrivate ?? false,
    password: password ?? null,
    maxPlayers: Math.min(Math.max(Number(maxPlayers) || 4, 2), 4),
    status: 'waiting',
    players: [{ socketId: hostSocketId, userId, username }],
  };
  rooms.set(id, room);
  return room;
}

/** @param {string} roomId */
export function getRoom(roomId) {
  return rooms.get(roomId);
}

/** @returns {object[]} */
export function getAllRooms() {
  return [...rooms.values()];
}

/**
 * @param {string} roomId
 * @param {string} socketId
 * @param {string} userId
 * @param {string} username
 * @returns {{ room: object } | null}
 */
export function addPlayer(roomId, socketId, userId, username) {
  const room = rooms.get(roomId);
  if (!room) return null;
  if (room.players.length >= room.maxPlayers) return null;
  if (room.status !== 'waiting') return null;
  if (room.players.some(p => p.userId === userId)) return null;

  room.players.push({ socketId, userId, username });
  return { room };
}

/**
 * Removes a player from their room. Deletes the room if it becomes empty.
 * Promotes the next player to host if the host left.
 * @param {string} roomId
 * @param {string} socketId
 * @returns {{ room: object, deleted: boolean }}
 */
export function removePlayer(roomId, socketId) {
  const room = rooms.get(roomId);
  if (!room) return { room: null, deleted: false };

  room.players = room.players.filter(p => p.socketId !== socketId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return { room, deleted: true };
  }

  // Promote first remaining player to host if host left
  if (room.hostSocketId === socketId) {
    room.hostSocketId = room.players[0].socketId;
    room.hostUserId = room.players[0].userId;
    room.hostUsername = room.players[0].username;
  }

  return { room, deleted: false };
}

/**
 * Updates room settings. Applies only the fields that are explicitly provided.
 * Validation (host check, game status, maxPlayers bounds) is the caller's responsibility.
 * @param {string} roomId
 * @param {{ name?: string, pace?: string, isPrivate?: boolean, maxPlayers?: number, password?: string|null }} updates
 * @returns {object|null}
 */
export function updateRoom(roomId, { name, pace, isPrivate, maxPlayers, password }) {
  const room = rooms.get(roomId);
  if (!room) return null;

  if (name      !== undefined) room.name      = name;
  if (pace      !== undefined) room.pace      = pace;
  if (isPrivate !== undefined) room.isPrivate = isPrivate;
  if (maxPlayers !== undefined) room.maxPlayers = maxPlayers;
  if (password  !== undefined) room.password  = password ?? null;

  return room;
}

/** @param {string} socketId */
export function getRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

/**
 * Converts internal room to the RoomInfo shape shared with the client (lobby use).
 * @param {object} room
 * @returns {object}
 */
export function toRoomInfo(room) {
  return {
    id:             room.id,
    name:           room.name,
    hostUserId:     room.hostUserId,
    hostUsername:   room.hostUsername,
    pace:           room.pace,
    isPrivate:      room.isPrivate,
    maxPlayers:     room.maxPlayers,
    currentPlayers: room.players.length,
    status:         room.status,
  };
}

/**
 * Converts internal room to the full RoomDetail shape (includes player list).
 * @param {object} room
 * @returns {object}
 */
export function toRoomDetail(room) {
  return {
    ...toRoomInfo(room),
    players: room.players.map(({ userId, username }) => ({ userId, username })),
  };
}
