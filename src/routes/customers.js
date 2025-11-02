import express from 'express';
import { 
  getAllCustomers, 
  getCustomerById, 
  createCustomer, 
  updateCustomer, 
  updateCustomerStatus 
} from '../controllers/customerController.js';

const router = express.Router();

// GET /api/customers
router.get('/', getAllCustomers);

// GET /api/customers/:id
router.get('/:id', getCustomerById);

// POST /api/customers
router.post('/', createCustomer);

// PUT /api/customers/:id
router.put('/:id', updateCustomer);

// PATCH /api/customers/:id/status
router.patch('/:id/status', updateCustomerStatus);

export default router;
