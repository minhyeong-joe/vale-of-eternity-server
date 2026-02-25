import cors from "cors";
import "dotenv/config";

const CLIENT_BASE_URL = process.env.CLIENT_BASE_URL;

const corsOptions = {
	origin: CLIENT_BASE_URL,
	methods: ["GET", "POST"],
};

export default corsOptions;
