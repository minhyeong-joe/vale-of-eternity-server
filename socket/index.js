/**
 * Registers all Socket.IO event handlers on the given server instance.
 * @param {import("socket.io").Server} io
 */
export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on("disconnect", (reason) => {
      console.log(`[socket] disconnected: ${socket.id} — reason: ${reason}`);
    });
  });
}
