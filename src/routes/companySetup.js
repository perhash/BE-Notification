import express from 'express';
import {
  getCompanySetup,
  createCompanySetup,
  updateCompanySetup
} from '../controllers/companySetupController.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication and ADMIN role
router.use(authenticateToken);
router.use(requireRole(['ADMIN']));

// GET /api/company-setup
router.get('/', getCompanySetup);

// POST /api/company-setup
router.post('/', createCompanySetup);

// PUT /api/company-setup/:id
router.put('/:id', updateCompanySetup);

export default router;

