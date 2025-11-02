import express from 'express';
import { login, verifyToken, updatePassword } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// POST /api/auth/login
router.post('/login', login);

// GET /api/auth/verify
router.get('/verify', verifyToken);

// POST /api/auth/update-password
router.post('/update-password', authenticateToken, updatePassword);

export default router;
