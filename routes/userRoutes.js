import { Router } from "express";
import { signUp, signIn, googleSignIn } from "../controllers/userController.js";

const router = Router();

router.post("/signup", signUp);
router.post("/signin", signIn);
router.post("/auth/google", googleSignIn);

export default router;
