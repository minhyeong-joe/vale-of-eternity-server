// ─── Game Events ───────────────────────────────────────────────────────────

/** @readonly */
export const GameEvents = Object.freeze({
	// ── Client → Server ──────────────────────────────────────────────────────
	/** client -> server | payload: none                   | Host starts the game */
	START: "game:start",
	/** client -> server | payload: { cardId }             | Pick a card in hunting phase */
	HUNT_PICK: "game:hunt-pick",
	/** client -> server | payload: { cardId }             | Sell a board card for stones */
	SELL: "game:sell",
	/** client -> server | payload: { cardId }             | Take board card into hand */
	TAME: "game:tame",
	/** client -> server | payload: { cardId, payment }    | Pay cost, summon card to area */
	SUMMON: "game:summon",
	/** client -> server | payload: { cardId }             | Discard summoned card, pay round cost */
	REMOVE: "game:remove",
	/** client -> server | payload: { cardId }             | Activate active effect (resolution phase) */
	ACTIVATE: "game:activate",
	/** client -> server | payload: { type, value }        | Answer pending interaction */
	RESPOND: "game:respond",
	/** client -> server | payload: none                   | End action or resolution turn */
	END_TURN: "game:end-turn",
	/** client -> server | payload: none                   | Request a fresh state snapshot (e.g. after page refresh) */
	REQUEST_STATE: "game:request-state",

	// ── Server → Client ──────────────────────────────────────────────────────
	/** server -> client | payload: ClientGameState        | Full personalized game state snapshot */
	STATE: "game:state",
	/** server -> client | payload: Partial<ClientGameState> | Partial state update */
	STATE_DELTA: "game:state-delta",
	/** server -> client | payload: InteractionPayload     | Server needs player input */
	INTERACTION: "game:interaction",
	/** server -> client | payload: { message }            | Invalid action error */
	ERROR: "game:error",
	/** server -> client | payload: { reason, username }   | Game ended mid-match (e.g. player permanently left) */
	ENDED: "game:ended",
});

// ─── Lobby Events ──────────────────────────────────────────────────────────

/** @readonly */
export const LobbyEvents = Object.freeze({
	/** client -> server | payload: none       | Request the current room list on lobby mount */
	GET_ROOMS: "lobby:rooms",
	/** server -> client | payload: RoomInfo[] | Full room list, sent in response to GET_ROOMS */
	ROOMS: "lobby:rooms",
	/** server -> client | payload: RoomInfo   | Broadcast when a new room is created */
	ROOM_ADDED: "lobby:room-added",
	/** server -> client | payload: RoomInfo   | Broadcast when a room's player count or settings change */
	ROOM_UPDATED: "lobby:room-updated",
	/** server -> client | payload: string (roomId) | Broadcast when a room is removed */
	ROOM_REMOVED: "lobby:room-removed",
});

// ─── Room Events ───────────────────────────────────────────────────────────

/** @readonly */
export const RoomEvents = Object.freeze({
	/** client -> server | payload: RoomCreatePayload  | Create a new room */
	CREATE: "room:create",
	/** client -> server | payload: RoomJoinPayload    | Join an existing room */
	JOIN: "room:join",
	/** client -> server | payload: RoomLeavePayload   | Leave the current room */
	LEAVE: "room:leave",
	/** client -> server | payload: RoomUpdatePayload  | Update room settings (host only, waiting status only) */
	UPDATE: "room:update",
	/** client -> server | payload: none               | Player is ready */
	READY: "room:ready",
	/** server -> client | payload: RoomJoinedPayload  | Sent to all room sockets when any player joins */
	JOINED: "room:joined",
	/** server -> client | payload: RoomLeftPayload    | Sent to leaving socket (no roomDetail) and remaining sockets (with roomDetail) */
	LEFT: "room:left",
	/** server -> client | payload: RoomUpdatedPayload | Broadcast to all room sockets when settings change */
	UPDATED: "room:updated",
	/** server -> client | payload: RoomErrorPayload   | Sent to the requesting socket only on error */
	ERROR: "room:error",
	/** server -> client | payload: { userId, username } | Player lost connection; 60s grace period started */
	PLAYER_RECONNECTING: "room:player-reconnecting",
	/** server -> client (reconnecting socket only) | payload: RoomRestoredPayload | Grace-period reconnect succeeded; client should navigate back to room */
	RESTORED: "room:restored",
});

// ─── JSDoc type definitions (mirrors client-side TypeScript interfaces) ────

/**
 * @typedef {'chill' | 'slow' | 'fast'} RoomPace
 * @typedef {'waiting' | 'in-progress' | 'finished'} RoomStatus
 */

/**
 * @typedef {object} RoomInfo
 * @property {string}     id
 * @property {string}     name
 * @property {string}     hostUserId
 * @property {string}     hostUsername
 * @property {RoomPace}   pace
 * @property {boolean}    isPrivate
 * @property {number}     maxPlayers
 * @property {number}     currentPlayers
 * @property {RoomStatus} status
 */

/**
 * @typedef {object} RoomPlayer
 * @property {string} userId
 * @property {string} username
 */

/**
 * @typedef {RoomInfo & { players: RoomPlayer[] }} RoomDetail
 */

// ─── Payload types ─────────────────────────────────────────────────────────

/**
 * @typedef {object} RoomCreatePayload
 * @property {string}    name
 * @property {RoomPace}  [pace]
 * @property {boolean}   [isPrivate]
 * @property {number}    [maxPlayers]
 * @property {string}    [password]
 */

/**
 * @typedef {object} RoomJoinPayload
 * @property {string} roomId
 * @property {string} [password]
 */

/**
 * @typedef {object} RoomLeavePayload
 * @property {string} roomId
 */

/**
 * @typedef {object} RoomUpdatePayload
 * @property {string}         roomId
 * @property {string}         [name]
 * @property {RoomPace}       [pace]
 * @property {boolean}        [isPrivate]
 * @property {number}         [maxPlayers]
 * @property {string|null}    [password]   - null clears the password
 */

/**
 * @typedef {object} RoomJoinedPayload
 * @property {RoomDetail} roomDetail
 */

/**
 * @typedef {object} RoomLeftPayload
 * @property {string}      roomId
 * @property {RoomDetail}  [roomDetail]   - present only on remaining-member broadcasts
 */

/**
 * @typedef {object} RoomUpdatedPayload
 * @property {RoomDetail} roomDetail
 */

/**
 * @typedef {object} RoomErrorPayload
 * @property {string} code
 * @property {string} message
 */
