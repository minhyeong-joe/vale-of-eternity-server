import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

import User from "../models/User.js";

// Google SSO handler
export async function googleSignIn(req, res) {
	const { idToken } = req.body;
	if (!idToken) {
		return res.status(400).json({ message: "Missing Google ID token" });
	}
	try {
		// Verify Google token
		const googleRes = await fetch(
			`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
		);
		if (!googleRes.ok) {
			return res.status(401).json({ message: "Invalid Google token" });
		}
		const googleData = await googleRes.json();
		const { email, name, sub } = googleData;
		if (!email) {
			return res.status(400).json({ message: "Google token missing email" });
		}

		// Upsert user by email
		let user = await User.findOne({ email });
		if (!user) {
			// Use Google sub as username fallback if needed
			const username = name || email.split("@")[0] || sub;
			user = new User({
				username,
				email,
				password: null,
			});
			await user.save();
		}

		// Issue app JWT
		const token = jwt.sign(
			{ userId: user._id.toString(), username: user.username },
			process.env.JWT_SECRET,
			{ expiresIn: "4h" },
		);

		res.status(200).json({
			message: "Google sign in successful",
			data: {
				email: user.email,
				client_token: token,
			},
		});
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
}

const HASH_SALT = 10;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

export async function signUp(req, res) {
	console.log("[userController] signUp called with body:", req.body);
	const { username, email, password } = req.body;
	try {
		if (!PASSWORD_REGEX.test(password)) {
			return res.status(400).json({
				message:
					"Password must be at least 8 characters and include at least one uppercase letter, one lowercase letter, and one number",
			});
		}

		// Check if email already exists
		const existingEmail = await User.findOne({ email });
		if (existingEmail) {
			return res.status(400).json({ message: "Email already in use" });
		}

		// Check if username already exists
		const existingUsername = await User.findOne({ username });
		if (existingUsername) {
			return res.status(400).json({ message: "Username already in use" });
		}

		const hashedPassword = await bcrypt.hash(password, HASH_SALT);
		const newUser = new User({ username, email, password: hashedPassword });
		await newUser.save();

		res.status(201).json({ message: "User created successfully" });
	} catch (error) {
		// Mongoose validation error (username length, email format)
		if (error.name === "ValidationError") {
			const messages = Object.values(error.errors).map((e) => e.message);
			return res.status(400).json({ message: messages.join(", ") });
		}
		res.status(500).json({ message: "Server error" });
	}
}

export async function signIn(req, res) {
	const { username, password } = req.body;
	try {
		const user = await User.findOne({ username });
		if (!user) {
			return res
				.status(400)
				.json({ message: "Incorrect username or password" });
		}
		const isMatch = await bcrypt.compare(password, user.password);
		if (!isMatch) {
			return res
				.status(400)
				.json({ message: "Incorrect username or password" });
		}

		// Update lastSignIn timestamp
		user.lastSignIn = new Date();
		await user.save();

		const token = jwt.sign(
			{ userId: user._id.toString(), username: user.username },
			process.env.JWT_SECRET,
			{ expiresIn: "4h" },
		);

		res.status(200).json({
			message: "Sign in successful",
			data: {
				email: user.email,
				client_token: token,
			},
		});
	} catch (error) {
		res.status(500).json({ message: "Server error" });
	}
}
