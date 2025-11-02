import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { formatPktDate } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Get all riders
export const getAllRiders = async (req, res) => {
  try {
    const riders = await prisma.riderProfile.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: { email: true, phone: true }
        },
        orders: {
          where: {
            status: {
              in: ['ASSIGNED', 'IN_PROGRESS', 'DELIVERED']
            }
          },
          include: {
            customer: {
              select: { name: true, phone: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedRiders = riders.map(rider => ({
      id: rider.id,
      name: rider.name,
      phone: rider.phone,
      email: rider.user.email,
      isActive: rider.isActive,
      totalDeliveries: rider.orders.filter(o => o.status === 'DELIVERED').length,
      pendingDeliveries: rider.orders.filter(o => o.status === 'ASSIGNED' || o.status === 'IN_PROGRESS').length,
      currentOrders: rider.orders.filter(o => o.status === 'ASSIGNED' || o.status === 'IN_PROGRESS').map(order => ({
        id: `#${order.id.slice(-4)}`,
        customer: order.customer.name,
        phone: order.customer.phone,
        amount: parseFloat(order.totalAmount),
        status: order.status.toLowerCase()
      })),
      createdAt: formatPktDate(rider.createdAt)
    }));

    res.json({
      success: true,
      data: formattedRiders
    });
  } catch (error) {
    console.error('Error fetching riders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch riders',
      error: error.message
    });
  }
};

// Get rider by ID
export const getRiderById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const rider = await prisma.riderProfile.findUnique({
      where: { id },
      include: {
        user: true,
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            customer: {
              select: { name: true, phone: true }
            }
          }
        }
      }
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    // Format dates in PKT for orders
    const formattedRider = {
      ...rider,
      createdAt: formatPktDate(rider.createdAt),
      orders: rider.orders.map(order => ({
        ...order,
        createdAt: formatPktDate(order.createdAt),
        deliveredAt: order.deliveredAt ? formatPktDate(order.deliveredAt) : null,
        updatedAt: formatPktDate(order.updatedAt)
      }))
    };

    res.json({
      success: true,
      data: formattedRider
    });
  } catch (error) {
    console.error('Error fetching rider:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rider',
      error: error.message
    });
  }
};

// Get rider dashboard data
export const getRiderDashboard = async (req, res) => {
  try {
    const { riderId } = req.params;
    
    // Fetch all orders for this rider (no date filter to ensure immediacy)
    const riderOrders = await prisma.order.findMany({
      where: {
        riderId
      },
      include: {
        customer: {
          select: { name: true, phone: true, houseNo: true, streetNo: true, area: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const completedDeliveries = riderOrders.filter(order => order.status === 'DELIVERED');
    const assignedDeliveries = riderOrders.filter(order => order.status === 'ASSIGNED' || order.status === 'IN_PROGRESS');

    const formattedAssigned = assignedDeliveries.map(delivery => ({
      id: `#${delivery.id.slice(-4)}`,
      originalId: delivery.id,
      customer: delivery.customer.name,
      phone: delivery.customer.phone,
      address: `${delivery.customer.houseNo || ''} ${delivery.customer.streetNo || ''} ${delivery.customer.area || ''}`.trim(),
      bottles: delivery.numberOfBottles,
      amount: parseFloat(delivery.totalAmount),
      paidAmount: parseFloat(delivery.paidAmount || 0),
      currentOrderAmount: parseFloat(delivery.currentOrderAmount || 0),
      priority: delivery.priority.toLowerCase(),
      paymentStatus: delivery.paymentStatus,
      createdAt: delivery.createdAt
    }));

    const formattedCompleted = completedDeliveries.map(delivery => ({
      id: `#${delivery.id.slice(-4)}`,
      originalId: delivery.id,
      customer: delivery.customer.name,
      phone: delivery.customer.phone,
      address: `${delivery.customer.houseNo || ''} ${delivery.customer.streetNo || ''} ${delivery.customer.area || ''}`.trim(),
      bottles: delivery.numberOfBottles,
      amount: parseFloat(delivery.totalAmount),
      paidAmount: parseFloat(delivery.paidAmount),
      currentOrderAmount: parseFloat(delivery.currentOrderAmount),
      priority: delivery.priority.toLowerCase(),
      paymentStatus: delivery.paymentStatus,
      createdAt: delivery.createdAt
    }));

    res.json({
      success: true,
      data: {
        assignedDeliveries: formattedAssigned,
        completedDeliveries: formattedCompleted,
        stats: {
          totalToday: riderOrders.length,
          completed: completedDeliveries.length,
          pending: assignedDeliveries.length
        }
      }
    });
  } catch (error) {
    console.error('Error fetching rider dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch rider dashboard',
      error: error.message
    });
  }
};

// Create new rider
export const createRider = async (req, res) => {
  try {
    const { name, phone, email, password } = req.body;

    // Validate required fields
    if (!name || !phone || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required'
      });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Use transaction to create both User and RiderProfile
    const result = await prisma.$transaction(async (tx) => {
      // Create User account
      const user = await tx.user.create({
        data: {
          email,
          phone,
          password: hashedPassword,
          role: 'RIDER',
          isActive: true
        }
      });

      // Create RiderProfile
      const riderProfile = await tx.riderProfile.create({
        data: {
          userId: user.id,
          name,
          phone,
          isActive: true
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              role: true,
              isActive: true
            }
          }
        }
      });

      return riderProfile;
    });

    res.status(201).json({
      success: true,
      data: {
        id: result.id,
        name: result.name,
        phone: result.phone,
        email: result.user.email,
        isActive: result.isActive,
        user: result.user,
        createdAt: result.createdAt
      },
      message: 'Rider created successfully'
    });

  } catch (error) {
    console.error('Error creating rider:', error);
    
    // Handle specific Prisma errors
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0];
      return res.status(400).json({
        success: false,
        message: `${field === 'email' ? 'Email' : 'Phone number'} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create rider',
      error: error.message
    });
  }
};

// Update rider
export const updateRider = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, isActive } = req.body;

    // Validate required fields
    if (!name || !phone || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name, phone, and email are required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Use transaction to update both User and RiderProfile
    const result = await prisma.$transaction(async (tx) => {
      // Find the rider profile first
      const riderProfile = await tx.riderProfile.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!riderProfile) {
        throw new Error('Rider not found');
      }

      // Update User account
      const updatedUser = await tx.user.update({
        where: { id: riderProfile.userId },
        data: {
          email,
          phone,
          isActive: isActive !== undefined ? isActive : true
        }
      });

      // Update RiderProfile
      const updatedRiderProfile = await tx.riderProfile.update({
        where: { id },
        data: {
          name,
          phone,
          isActive: isActive !== undefined ? isActive : true
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              role: true,
              isActive: true
            }
          }
        }
      });

      return updatedRiderProfile;
    });

    res.json({
      success: true,
      data: {
        id: result.id,
        name: result.name,
        phone: result.phone,
        email: result.user.email,
        isActive: result.isActive,
        user: result.user,
        updatedAt: result.updatedAt
      },
      message: 'Rider updated successfully'
    });

  } catch (error) {
    console.error('Error updating rider:', error);
    
    if (error.message === 'Rider not found') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    // Handle specific Prisma errors
    if (error.code === 'P2002') {
      const field = error.meta?.target?.[0];
      return res.status(400).json({
        success: false,
        message: `${field === 'email' ? 'Email' : 'Phone number'} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update rider',
      error: error.message
    });
  }
};

// Update rider status (activate/deactivate)
export const updateRiderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean value'
      });
    }

    // Use transaction to update both User and RiderProfile
    const result = await prisma.$transaction(async (tx) => {
      // Find the rider profile first
      const riderProfile = await tx.riderProfile.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!riderProfile) {
        throw new Error('Rider not found');
      }

      // Update User account status
      await tx.user.update({
        where: { id: riderProfile.userId },
        data: { isActive }
      });

      // Update RiderProfile status
      const updatedRiderProfile = await tx.riderProfile.update({
        where: { id },
        data: { isActive },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              role: true,
              isActive: true
            }
          }
        }
      });

      return updatedRiderProfile;
    });

    res.json({
      success: true,
      data: {
        id: result.id,
        name: result.name,
        phone: result.phone,
        email: result.user.email,
        isActive: result.isActive,
        user: result.user
      },
      message: `Rider ${isActive ? 'activated' : 'deactivated'} successfully`
    });

  } catch (error) {
    console.error('Error updating rider status:', error);
    
    if (error.message === 'Rider not found') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update rider status',
      error: error.message
    });
  }
};

// Delete rider (soft delete - set isActive to false)
export const deleteRider = async (req, res) => {
  try {
    const { id } = req.params;

    // Use transaction to soft delete both User and RiderProfile
    const result = await prisma.$transaction(async (tx) => {
      // Find the rider profile first
      const riderProfile = await tx.riderProfile.findUnique({
        where: { id },
        include: { user: true }
      });

      if (!riderProfile) {
        throw new Error('Rider not found');
      }

      // Check if rider has any active orders
      const activeOrders = await tx.order.count({
        where: {
          riderId: id,
          status: {
            in: ['ASSIGNED', 'IN_PROGRESS']
          }
        }
      });

      if (activeOrders > 0) {
        throw new Error('Cannot delete rider with active orders');
      }

      // Soft delete User account
      await tx.user.update({
        where: { id: riderProfile.userId },
        data: { isActive: false }
      });

      // Soft delete RiderProfile
      const deletedRiderProfile = await tx.riderProfile.update({
        where: { id },
        data: { isActive: false },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              phone: true,
              role: true,
              isActive: true
            }
          }
        }
      });

      return deletedRiderProfile;
    });

    res.json({
      success: true,
      data: {
        id: result.id,
        name: result.name,
        phone: result.phone,
        email: result.user.email,
        isActive: result.isActive
      },
      message: 'Rider deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting rider:', error);
    
    if (error.message === 'Rider not found') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    if (error.message === 'Cannot delete rider with active orders') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete rider with active orders. Please reassign or complete the orders first.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to delete rider',
      error: error.message
    });
  }
};
