const pendingDisconnects = new Map();

const GRACE_PERIOD_MS = 60_000;

export function scheduleDisconnect(userId, roomId, onExpire) {
	cancelDisconnect(userId); // clear stale timer if any
	const timer = setTimeout(() => {
		pendingDisconnects.delete(userId);
		onExpire();
	}, GRACE_PERIOD_MS);
	pendingDisconnects.set(userId, { timer, roomId });
}

export function cancelDisconnect(userId) {
	const entry = pendingDisconnects.get(userId);
	if (!entry) return null;
	clearTimeout(entry.timer);
	pendingDisconnects.delete(userId);
	return entry;
}
