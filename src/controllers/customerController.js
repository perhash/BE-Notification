import { PrismaClient } from '@prisma/client';
import { handleDatabaseError } from '../middleware/errorHandler.js';
import { formatPktDate } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Get all customers
export const getAllCustomers = async (req, res) => {
  try {
    const { status, q } = req.query;
    
    // Build where clause based on status filter
    let whereClause = {};
    if (status === 'active') {
      whereClause = { isActive: true };
    } else if (status === 'inactive') {
      whereClause = { isActive: false };
    }
    if (q) {
      const term = q.toString();
      whereClause = {
        AND: [
          whereClause,
          {
            OR: [
              { name: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term } },
              { whatsapp: { contains: term } },
              { houseNo: { contains: term, mode: 'insensitive' } }
            ]
          }
        ]
      };
    }
    // If no status filter, return all customers
    
    const customers = await prisma.customer.findMany({
      where: whereClause,
      include: {
        orders: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedCustomers = customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      houseNo: customer.houseNo,
      streetNo: customer.streetNo,
      area: customer.area,
      city: customer.city,
      bottleCount: customer.bottleCount,
      avgDaysToRefill: customer.avgDaysToRefill,
      address: `${customer.houseNo || ''} ${customer.streetNo || ''} ${customer.area || ''} ${customer.city || ''}`.trim(),
      currentBalance: parseFloat(customer.currentBalance),
      isActive: customer.isActive,
      totalOrders: customer.orders.length,
      lastOrder: customer.orders[0] ? {
        id: `#${customer.orders[0].id.slice(-4)}`,
        amount: parseFloat(customer.orders[0].totalAmount),
        status: customer.orders[0].status.toLowerCase(),
        date: formatPktDate(customer.orders[0].createdAt)
      } : null,
      createdAt: formatPktDate(customer.createdAt)
    }));

    res.json({
      success: true,
      data: formattedCustomers
    });
  } catch (error) {
    return handleDatabaseError(error, req, res);
  }
};

// Get customer by ID
export const getCustomerById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            rider: {
              select: { name: true, phone: true }
            }
          }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Format the customer data with order statistics
    const formattedCustomer = {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      whatsapp: customer.whatsapp,
      houseNo: customer.houseNo,
      streetNo: customer.streetNo,
      area: customer.area,
      city: customer.city,
      bottleCount: customer.bottleCount,
      avgDaysToRefill: customer.avgDaysToRefill,
      address: `${customer.houseNo || ''} ${customer.streetNo || ''} ${customer.area || ''} ${customer.city || ''}`.trim(),
      currentBalance: parseFloat(customer.currentBalance),
      isActive: customer.isActive,
      createdAt: formatPktDate(customer.createdAt),
      updatedAt: formatPktDate(customer.updatedAt),
      orders: customer.orders.map(order => ({
        id: order.id,
        orderId: `#${order.id.slice(-4)}`,
        status: order.status.toLowerCase(),
        priority: order.priority.toLowerCase(),
        totalAmount: parseFloat(order.totalAmount),
        paidAmount: parseFloat(order.paidAmount),
        paymentStatus: order.paymentStatus.toLowerCase(),
        paymentMethod: order.paymentMethod.toLowerCase(),
        rider: order.rider ? {
          name: order.rider.name,
          phone: order.rider.phone
        } : null,
        notes: order.notes,
        createdAt: formatPktDate(order.createdAt),
        deliveredAt: order.deliveredAt ? formatPktDate(order.deliveredAt) : null
      })),
      stats: {
        totalOrders: customer.orders.length,
        completedOrders: customer.orders.filter(o => o.status === 'DELIVERED').length,
        pendingOrders: customer.orders.filter(o => o.status === 'PENDING' || o.status === 'ASSIGNED').length,
        totalSpent: customer.orders.reduce((sum, order) => sum + parseFloat(order.totalAmount), 0),
        averageOrderValue: customer.orders.length > 0 ? 
          customer.orders.reduce((sum, order) => sum + parseFloat(order.totalAmount), 0) / customer.orders.length : 0
      }
    };

    res.json({
      success: true,
      data: formattedCustomer
    });
  } catch (error) {
    return handleDatabaseError(error, req, res);
  }
};

// Create new customer
export const createCustomer = async (req, res) => {
  try {
    const { name, phone, whatsapp, houseNo, streetNo, area, city, bottleCount, avgDaysToRefill } = req.body;

    const customer = await prisma.customer.create({
      data: {
        name,
        phone,
        whatsapp: whatsapp || null,
        houseNo,
        streetNo,
        area,
        city,
        bottleCount: bottleCount || 0,
        avgDaysToRefill: avgDaysToRefill || null
      }
    });

    res.status(201).json({
      success: true,
      data: customer,
      message: 'Customer created successfully'
    });
  } catch (error) {
    console.log('Customer creation error:', error);
    console.log('Error code:', error.code);
    console.log('Error message:', error.message);
    return handleDatabaseError(error, req, res);
  }
};

// Update customer status (activate/deactivate)
export const updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const customer = await prisma.customer.update({
      where: { id },
      data: { isActive }
    });

    res.json({
      success: true,
      data: customer,
      message: `Customer ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    return handleDatabaseError(error, req, res);
  }
};

// Update customer information
export const updateCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, whatsapp, houseNo, streetNo, area, city, bottleCount, avgDaysToRefill } = req.body;

    const customer = await prisma.customer.update({
      where: { id },
      data: {
        name,
        phone,
        whatsapp: whatsapp || null,
        houseNo,
        streetNo,
        area,
        city,
        bottleCount: bottleCount || 0,
        avgDaysToRefill: avgDaysToRefill || null
      }
    });

    res.json({
      success: true,
      data: customer,
      message: 'Customer updated successfully'
    });
  } catch (error) {
    return handleDatabaseError(error, req, res);
  }
};
