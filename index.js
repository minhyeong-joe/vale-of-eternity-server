import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import corsOptions from "./config/cors.js";
import connectDB from "./config/db.js";
import { registerSocketHandlers } from "./socket/index.js";
import userRoutes from "./routes/userRoutes.js";

const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

// user auth routes
app.use("/api/users", userRoutes);
app.get("/api/health", (req, res) => {
	res.status(200).json({ message: "Server is healthy" });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
	cors: corsOptions,
});

registerSocketHandlers(io);

await connectDB();

httpServer.listen(PORT, () => {
	console.log(`[server] listening on port ${PORT}`);
});
