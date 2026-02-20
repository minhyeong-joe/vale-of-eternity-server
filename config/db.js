import mongoose from "mongoose";

const connectDB = async () => {
    const conn_string = `mongodb+srv://${process.env.MONGO_DB_USERNAME}:${encodeURIComponent(process.env.MONGO_DB_PASSWORD)}@${process.env.MONGO_DB_URI}/${process.env.MONGO_DB_APP_NAME}?retryWrites=true&w=majority`;
    try {
        const conn = await mongoose.connect(conn_string);
        console.log(`MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
};

export default connectDB;