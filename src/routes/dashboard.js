import express from 'express';
import { getDashboardStats, getRecentActivities } from '../controllers/dashboardController.js';

const router = express.Router();

// GET /api/dashboard/stats
router.get('/stats', getDashboardStats);

// GET /api/dashboard/activities
router.get('/activities', getRecentActivities);

export default router;
