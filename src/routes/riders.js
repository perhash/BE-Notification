import express from 'express';
import { 
  getAllRiders, 
  getRiderById, 
  getRiderDashboard, 
  createRider, 
  updateRider, 
  updateRiderStatus, 
  deleteRider 
} from '../controllers/riderController.js';

const router = express.Router();

// GET /api/riders
router.get('/', getAllRiders);

// POST /api/riders
router.post('/', createRider);

// GET /api/riders/:id
router.get('/:id', getRiderById);

// PUT /api/riders/:id
router.put('/:id', updateRider);

// PATCH /api/riders/:id/status
router.patch('/:id/status', updateRiderStatus);

// DELETE /api/riders/:id
router.delete('/:id', deleteRider);

// GET /api/riders/:riderId/dashboard
router.get('/:riderId/dashboard', getRiderDashboard);

export default router;
