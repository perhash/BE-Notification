import express from 'express';
import { getAnalytics, getReportData } from '../controllers/reportsController.js';

const router = express.Router();

// GET /api/reports/analytics?period=daily|weekly|monthly|yearly|alltime&entity=all|orders|customers|riders
router.get('/analytics', getAnalytics);

// GET /api/reports/data?period=daily|weekly|monthly|yearly|alltime&type=orders|customers|riders&startDate=&endDate=
router.get('/data', getReportData);

export default router;

