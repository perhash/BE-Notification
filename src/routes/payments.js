import express from 'express';
import { getAllPayments, updatePaymentStatus } from '../controllers/paymentController.js';

const router = express.Router();

// GET /api/payments
router.get('/', getAllPayments);

// PATCH /api/payments/:id
router.patch('/:id', updatePaymentStatus);

export default router;
