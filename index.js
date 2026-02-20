import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import connectDB from "./config/db.js";
import { registerSocketHandlers } from "./socket/index.js";
import userRoutes from "./routes/userRoutes.js";

const PORT = process.env.PORT || 3000;
const CLIENT_BASE_URL = process.env.CLIENT_BASE_URL;

const app = express();

app.use(cors({ origin: CLIENT_BASE_URL }));
app.use(express.json());

// user auth routes
app.use('/api/users', userRoutes);

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: CLIENT_BASE_URL,
    methods: ["GET", "POST"],
  },
});

registerSocketHandlers(io);

await connectDB();

httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
