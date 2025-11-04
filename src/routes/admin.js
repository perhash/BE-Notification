import express from 'express';
import {
  getAdminProfile,
  updateAdminProfile,
  updateAdminPassword
} from '../controllers/adminController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authenticateToken);
router.use(requireRole(['ADMIN']));

// GET /api/admin/profile
router.get('/profile', getAdminProfile);

// PATCH /api/admin/profile
router.patch('/profile', updateAdminProfile);

// PATCH /api/admin/profile/password
router.patch('/profile/password', updateAdminPassword);

export default router;


