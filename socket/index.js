import jwt from "jsonwebtoken";

import {
	handleRoomCreate,
	handleRoomJoin,
	handleRoomLeave,
	handleRoomUpdate,
} from "./handlers/room.js";
import { handleLobbyRooms } from "./handlers/lobby.js";
import {
	getRoomBySocketId,
	getRoomByUserId,
	updatePlayerSocketId,
	setPlayerConnected,
	removePlayer,
	toRoomInfo,
	toRoomDetail,
} from "./store/rooms.js";
import { scheduleDisconnect, cancelDisconnect } from "./store/sessions.js";
import { LobbyEvents, RoomEvents, GameEvents } from "./contracts.js";
import {
	handleGameStart,
	handleHuntPick,
	handleSell,
	handleTame,
	handleSummon,
	handleRemove,
	handleActivate,
	handleRespond,
	handleEndTurn,
} from "./handlers/game.js";
import { getGame, deleteGame, toClientState } from "./store/game.js";

export function registerSocketHandlers(io) {
	// check token for username and userId
	io.use((socket, next) => {
		const { token } = socket.handshake.auth;
		if (!token?.trim()) {
			return next(new Error("UNAUTHORIZED"));
		}
		try {
			const { userId, username } = jwt.verify(token, process.env.JWT_SECRET);
			if (!userId?.trim() || !username?.trim()) {
				return next(new Error("UNAUTHORIZED"));
			}
			socket.data.userId = userId.trim();
			socket.data.username = username.trim();
			next();
		} catch {
			return next(new Error("UNAUTHORIZED"));
		}
	});
	io.on("connection", (socket) => {
		const { userId, username } = socket.data;
		console.log(
			`[socket] connected: ${socket.id} userId: ${userId} username: ${username}`,
		);
		const pending = cancelDisconnect(userId);

		if (pending) {
			const restored = updatePlayerSocketId(pending.roomId, userId, socket.id);

			if (restored) {
				socket.join(pending.roomId);
				const room = getRoomByUserId(userId);
				if (room) {
					const roomDetail = toRoomDetail(room);
					io.to(pending.roomId).emit(RoomEvents.JOINED, { roomDetail });
					socket.emit(RoomEvents.RESTORED, { roomDetail });
				}
				// Re-emit game state if an active game exists in this room
				const gs = getGame(pending.roomId);
				if (gs) {
					socket.emit(GameEvents.STATE, toClientState(gs, userId));
				}
				console.log(
					`[socket] Reconnected within grace period: userId: ${userId} → room: ${pending.roomId}`,
				);
			} else {
				// Room no longer exists or player is kicked out
				socket.join("lobby");
			}
		} else {
			socket.join("lobby");
		}

		socket.on(LobbyEvents.GET_ROOMS, () => handleLobbyRooms(io, socket));
		socket.on(RoomEvents.CREATE, (payload) =>
			handleRoomCreate(io, socket, payload),
		);
		socket.on(RoomEvents.JOIN, (payload) =>
			handleRoomJoin(io, socket, payload),
		);
		socket.on(RoomEvents.LEAVE, (payload) =>
			handleRoomLeave(io, socket, payload),
		);
		socket.on(RoomEvents.UPDATE, (payload) =>
			handleRoomUpdate(io, socket, payload),
		);

		// Game events
		socket.on(GameEvents.START, () => handleGameStart(io, socket));
		socket.on(GameEvents.HUNT_PICK, (payload) =>
			handleHuntPick(io, socket, payload),
		);
		socket.on(GameEvents.SELL, (payload) => handleSell(io, socket, payload));
		socket.on(GameEvents.TAME, (payload) => handleTame(io, socket, payload));
		socket.on(GameEvents.SUMMON, (payload) =>
			handleSummon(io, socket, payload),
		);
		socket.on(GameEvents.REMOVE, (payload) =>
			handleRemove(io, socket, payload),
		);
		socket.on(GameEvents.ACTIVATE, (payload) =>
			handleActivate(io, socket, payload),
		);
		socket.on(GameEvents.RESPOND, (payload) =>
			handleRespond(io, socket, payload),
		);
		socket.on(GameEvents.END_TURN, () => handleEndTurn(io, socket));

		// Re-send game state on client request (e.g. page refresh race condition)
		socket.on(GameEvents.REQUEST_STATE, () => {
			const room = getRoomByUserId(userId);
			if (!room) return;
			const gs = getGame(room.id);
			if (gs) {
				socket.emit(GameEvents.STATE, toClientState(gs, userId));
			}
			socket.emit(RoomEvents.JOINED, { roomDetail: toRoomDetail(room) });
		});

		socket.on("disconnect", (reason) => {
			console.log(
				`[socket] disconnected: ${socket.id} userId: ${userId} username: ${username} — reason: ${reason}`,
			);

			const room = getRoomBySocketId(socket.id);
			// Player was only in the lobby — no grace period needed
			if (!room) return;

			const roomId = room.id;
			const socketId = socket.id; // captured for the timer closure

			// Mark the player as temporarily disconnected in the store
			setPlayerConnected(roomId, userId, false);

			// Tell the remaining room members so they can show a UI indicator
			io.to(roomId).emit(RoomEvents.PLAYER_RECONNECTING, { userId, username });

			console.log(
				`[socket] Grace period started for userId: ${userId} in room: ${roomId}`,
			);

			scheduleDisconnect(userId, roomId, () => {
				// Grace period elapsed with no reconnect — treat as a normal leave
				console.log(
					`[socket] Grace period expired for userId: ${userId}, removing from room: ${roomId}`,
				);

				const { room: updatedRoom, deleted } = removePlayer(roomId, socketId);

				if (deleted) {
					deleteGame(roomId); // clean up any in-progress game state
					io.to("lobby").emit(LobbyEvents.ROOM_REMOVED, roomId);
					console.log(`[room] Room ${roomId} removed — last player timed out`);
				} else if (updatedRoom) {
					// End any in-progress game — player permanently left after grace period
					const activeGame = getGame(roomId);
					if (activeGame && activeGame.phase !== "finished") {
						deleteGame(roomId);
						updatedRoom.status = "waiting";
						io.to(roomId).emit(GameEvents.ENDED, {
							reason: "player_left",
							username,
						});
						console.log(
							`[game] Game in room ${roomId} ended — ${username} timed out`,
						);
					}
					// Mirror the voluntary-leave broadcast so clients handle it identically
					io.to(roomId).emit(RoomEvents.LEFT, {
						roomId,
						roomDetail: toRoomDetail(updatedRoom),
					});
					io.to("lobby").emit(
						LobbyEvents.ROOM_UPDATED,
						toRoomInfo(updatedRoom),
					);
				}
			});
		});
	});
}
