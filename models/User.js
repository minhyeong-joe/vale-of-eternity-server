import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        minlength: [4, "Username must be at least 4 characters"],
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email address"],
    },
    password: { type: String, required: true },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    lastSignIn: {
        type: Date,
        default: null,
    },
});

const User = mongoose.model("User", userSchema);

export default User;
