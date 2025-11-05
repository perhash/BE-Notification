import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getAllOrders, getOrderById, createOrder, updateOrderStatus, updateOrder, deliverOrder, cancelOrder, completeWalkInOrder, clearBill, amendOrder } from '../controllers/orderController.js';

const router = express.Router();

// Protect all order routes
router.use(authenticateToken);

// GET /api/orders
router.get('/', getAllOrders);

// GET /api/orders/:id
router.get('/:id', getOrderById);

// POST /api/orders
router.post('/', createOrder);

// PATCH /api/orders/:id/status
router.patch('/:id/status', updateOrderStatus);

// PUT /api/orders/:id
router.put('/:id', updateOrder);

// POST /api/orders/:id/deliver
router.post('/:id/deliver', deliverOrder);

// POST /api/orders/:id/cancel
router.post('/:id/cancel', cancelOrder);

// POST /api/orders/:id/complete-walkin
router.post('/:id/complete-walkin', completeWalkInOrder);

// POST /api/orders/clear-bill
router.post('/clear-bill', clearBill);

// POST /api/orders/:id/amend
router.post('/:id/amend', amendOrder);

export default router;
