import { PrismaClient } from '@prisma/client';
import { formatPktDate } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Get all payments
export const getAllPayments = async (req, res) => {
  try {
    const { status } = req.query;
    
    const whereClause = status && status !== 'all' ? { paymentStatus: status.toUpperCase() } : {};
    
    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        customer: {
          select: { name: true, phone: true }
        },
        rider: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedPayments = orders.map(order => ({
      id: order.id,
      orderId: `#${order.id.slice(-4)}`,
      customer: order.customer.name,
      phone: order.customer.phone,
      rider: order.rider?.name || 'Not assigned',
      totalAmount: parseFloat(order.totalAmount),
      paidAmount: parseFloat(order.paidAmount),
      paymentStatus: order.paymentStatus.toLowerCase(),
      paymentMethod: order.paymentMethod.toLowerCase(),
      createdAt: formatPktDate(order.createdAt),
      deliveredAt: order.deliveredAt ? formatPktDate(order.deliveredAt) : null
    }));

    res.json({
      success: true,
      data: formattedPayments
    });
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payments',
      error: error.message
    });
  }
};

// Update payment status
export const updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentStatus, paidAmount, paymentMethod, paymentNotes } = req.body;

    const order = await prisma.order.update({
      where: { id },
      data: {
        paymentStatus: paymentStatus.toUpperCase(),
        paidAmount: parseFloat(paidAmount),
        paymentMethod: paymentMethod.toUpperCase(),
        paymentNotes
      },
      include: {
        customer: true,
        rider: true
      }
    });

    res.json({
      success: true,
      data: order,
      message: 'Payment status updated successfully'
    });
  } catch (error) {
    console.error('Error updating payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment',
      error: error.message
    });
  }
};
