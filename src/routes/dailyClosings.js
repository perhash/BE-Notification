import express from 'express';
import { getDailyClosingSummary, saveDailyClosing, getAllDailyClosings } from '../controllers/dailyClosingController.js';

const router = express.Router();

// GET /api/daily-closings/summary - Get today's summary (for preview before closing)
router.get('/summary', getDailyClosingSummary);

// GET /api/daily-closings - Get all daily closings
router.get('/', getAllDailyClosings);

// POST /api/daily-closings - Create or update daily closing
router.post('/', saveDailyClosing);

export default router;

