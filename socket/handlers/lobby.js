import { getAllRooms, toRoomInfo } from '../store/rooms.js';
import { LobbyEvents } from '../contracts.js';

/**
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
export function handleLobbyRooms(io, socket) {
  const roomList = getAllRooms().map(toRoomInfo);
  socket.emit(LobbyEvents.ROOMS, roomList);
}
