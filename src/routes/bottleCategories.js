import express from 'express';
import {
  getBottleCategories,
  createBottleCategory,
  updateBottleCategory,
  deleteBottleCategory
} from '../controllers/bottleCategoryController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authenticateToken);
router.use(requireRole(['ADMIN']));

// GET /api/bottle-categories?companySetupId=xxx
router.get('/', getBottleCategories);

// POST /api/bottle-categories
router.post('/', createBottleCategory);

// PUT /api/bottle-categories/:id
router.put('/:id', updateBottleCategory);

// DELETE /api/bottle-categories/:id
router.delete('/:id', deleteBottleCategory);

export default router;

