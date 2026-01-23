import { PrismaClient } from '@prisma/client';
import { getPktDateRangeUtc, getPktDayStartUtc, getPktDayEndUtc, formatPktDate } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Helper function to format customer address
const formatAddress = (customer) => {
  const parts = [
    customer.houseNo,
    customer.streetNo,
    customer.area,
    customer.city
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'No address';
};

// Get all orders
export const getAllOrders = async (req, res) => {
  try {
    const { status, date, riderId, startDate, endDate, page, limit, paymentStatus } = req.query;

    const whereClause = {
      ...(status && status !== 'all' ? { status: status.toUpperCase() } : {}),
      ...(riderId ? { riderId } : {}),
      ...(paymentStatus && paymentStatus !== 'all' ? { paymentStatus: paymentStatus.toUpperCase() } : {}),
      ...(date
        ? (() => {
            const dateRange = getPktDateRangeUtc(date);
            return {
              createdAt: {
                gte: dateRange.start,
                lte: dateRange.end
              }
            };
          })()
        : {}),
      ...(startDate && endDate
        ? {
            createdAt: {
              gte: getPktDayStartUtc(startDate),
              lte: getPktDayEndUtc(endDate)
            }
          }
        : startDate
        ? {
            createdAt: {
              gte: getPktDayStartUtc(startDate)
            }
          }
        : endDate
        ? {
            createdAt: {
              lte: getPktDayEndUtc(endDate)
            }
          }
        : {})
    };

    // Calculate pagination
    const pageNum = page ? parseInt(page) : 1;
    const pageLimit = limit ? parseInt(limit) : 50;
    const skip = (pageNum - 1) * pageLimit;

    // Get total count for pagination
    const total = await prisma.order.count({ where: whereClause });

    const orders = await prisma.order.findMany({
      where: whereClause,
      include: {
        customer: {
          select: { name: true, phone: true, houseNo: true, streetNo: true, area: true, city: true }
        },
        rider: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip: skip,
      take: pageLimit
    });

    const formattedOrders = orders.map(order => ({
      originalId: order.id,
      id: `#${order.id.slice(-4)}`,
      customer: order.customer.name,
      phone: order.customer.phone,
      bottles: order.numberOfBottles,
      amount: parseFloat(order.totalAmount),
      status: order.status.toLowerCase(),
      priority: order.priority.toLowerCase(),
      rider: order.rider?.name || 'Not assigned',
      date: formatPktDate(order.createdAt),
      paid: order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUND',
      paidAmount: parseFloat(order.paidAmount),
      paymentStatus: order.paymentStatus.toLowerCase(),
      address: [order.customer.houseNo, order.customer.streetNo, order.customer.area, order.customer.city]
        .filter(Boolean).join(' ')
    }));

    res.json({
      success: true,
      data: formattedOrders,
      total: total,
      page: pageNum,
      limit: pageLimit,
      totalPages: Math.ceil(total / pageLimit)
    });
  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch orders',
      error: error.message
    });
  }
};

// Get order by ID
export const getOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        rider: true
      }
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    console.error('Error fetching order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch order',
      error: error.message
    });
  }
};

// Create new order
export const createOrder = async (req, res) => {
  try {
    const { customerId, notes, priority = 'NORMAL', numberOfBottles = 1, riderId, unitPrice, orderType = 'DELIVERY' } = req.body;

    // Validate constraints based on order type
    if (orderType === 'DELIVERY' && !riderId) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID is required for delivery orders'
      });
    }

    if (orderType === 'WALKIN' && riderId) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID should not be provided for walk-in orders'
      });
    }

    // Handle walk-in customer lookup
    let customer;
    if (customerId === 'walkin') {
      // Find the walk-in customer by name
      customer = await prisma.customer.findFirst({
        where: { name: 'Walk-in Customer' },
        select: { id: true, currentBalance: true }
      });
    } else {
      // Regular customer lookup
      customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, currentBalance: true }
      });
    }

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const customerBalance = parseFloat(customer.currentBalance);
    const currentOrderAmount = parseFloat(numberOfBottles) * parseFloat(unitPrice);
    const totalAmount = customerBalance + currentOrderAmount;

    const order = await prisma.$transaction(async (tx) => {
      // Determine initial status based on order type
      let initialStatus = 'PENDING';
      if (orderType === 'WALKIN') {
        initialStatus = 'CREATED';
      } else if (orderType === 'DELIVERY' && riderId) {
        initialStatus = 'ASSIGNED';
      }

      // Create the order with new balance tracking fields
      const newOrder = await tx.order.create({
        data: {
          customerId: customer.id, // Use the actual customer ID
          totalAmount,
          currentOrderAmount,
          customerBalance,
          notes,
          priority: priority.toUpperCase(),
          orderType: orderType.toUpperCase(),
          riderId: orderType === 'DELIVERY' ? riderId : null,
          numberOfBottles: parseInt(numberOfBottles),
          status: initialStatus
        },
        include: {
          customer: true
        }
      });

      // Update customer's current balance to the new total
      await tx.customer.update({
        where: { id: customer.id }, // Use the actual customer ID
        data: { currentBalance: totalAmount }
      });

      return newOrder;
    });

    // If assigned to a rider, create a notification for the rider's user
    if (riderId) {
      try {
        const riderProfile = await prisma.riderProfile.findUnique({
          where: { id: riderId },
          select: { userId: true, name: true }
        });

        if (riderProfile?.userId) {
          // Get full customer details for address
          const fullCustomer = await prisma.customer.findUnique({
            where: { id: order.customerId },
            select: { name: true, houseNo: true, streetNo: true, area: true, city: true }
          });

          const address = formatAddress(fullCustomer);
          const message = `${fullCustomer.name} ka order - ${order.numberOfBottles} bottle(ain), Rs ${order.totalAmount}, ${address}`;

          await prisma.notification.create({
            data: {
              userId: riderProfile.userId,
              title: 'Naya order',
              message: message,
              type: 'ORDER_ASSIGNED',
              data: {
                orderId: order.id,
                priority: order.priority,
                totalAmount: order.totalAmount,
                numberOfBottles: order.numberOfBottles,
                customer: {
                  id: order.customer.id,
                  name: order.customer.name,
                  phone: order.customer.phone
                }
              }
            }
          });

          // Send push notification
          try {
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(riderProfile.userId, {
              title: 'Naya order',
              message: message,
              data: {
                orderId: order.id,
                type: 'ORDER_ASSIGNED'
              },
              clickAction: `/rider/orders/${order.id}`
            });
          } catch (pushErr) {
            console.error('Failed to send push notification:', pushErr);
          }
        }
      } catch (notifyErr) {
        console.error('Failed to create rider notification:', notifyErr);
      }
    }

    res.status(201).json({
      success: true,
      data: order,
      message: 'Order created successfully'
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
};

// Update order status
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, riderId } = req.body;

    // Get current order to check for existing rider
    const currentOrder = await prisma.order.findUnique({
      where: { id },
      include: {
        rider: {
          select: { userId: true, id: true }
        },
        customer: true
      }
    });

    if (!currentOrder) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const oldRiderId = currentOrder.riderId;
    const oldRiderUserId = currentOrder.rider?.userId;

    // If reassigning (riderId changes), keep status as ASSIGNED
    const isReassigning = riderId && oldRiderId && riderId !== oldRiderId;
    const updateData = {};
    
    // Only update status if not reassigning
    if (status && !isReassigning) {
      updateData.status = status.toUpperCase();
    } else if (isReassigning) {
      // Keep status as ASSIGNED when reassigning
      updateData.status = 'ASSIGNED';
    }
    
    if (riderId) {
      updateData.riderId = riderId;
    }

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        rider: {
          include: {
            user: {
              select: { id: true }
            }
          }
        }
      }
    });

    // If rider is being changed (reassigned), send notifications to both riders
    if (isReassigning) {
      try {
        const address = formatAddress(order.customer);
        
        // Notify old rider that order is reassigned
        if (oldRiderUserId) {
          const oldRiderMessage = `${order.customer.name} ka order - ${order.numberOfBottles} bottle(ain), Rs ${order.totalAmount}, ab aap se hata diya gaya, ${address}`;
          
          await prisma.notification.create({
            data: {
              userId: oldRiderUserId,
              title: 'Order reassign ho gaya',
              message: oldRiderMessage,
              type: 'ORDER_REASSIGNED',
              data: {
                orderId: id,
                customer: {
                  id: order.customerId,
                  name: order.customer.name,
                  phone: order.customer.phone
                },
                numberOfBottles: order.numberOfBottles
              }
            }
          });

          // Send push notification to old rider
          try {
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(oldRiderUserId, {
              title: 'Order reassign ho gaya',
              message: oldRiderMessage,
              data: {
                orderId: id,
                type: 'ORDER_REASSIGNED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('Failed to send push notification to old rider:', pushErr);
          }
        }

        // Notify new rider that order is assigned
        if (order.rider?.user?.id) {
          const newRiderMessage = `${order.customer.name} ka order - ${order.numberOfBottles} bottle(ain), Rs ${order.totalAmount}, ${address}`;
          
          await prisma.notification.create({
            data: {
              userId: order.rider.user.id,
              title: 'Naya order',
              message: newRiderMessage,
              type: 'ORDER_ASSIGNED',
              data: {
                orderId: id,
                priority: order.priority,
                totalAmount: order.totalAmount,
                numberOfBottles: order.numberOfBottles,
                customer: {
                  id: order.customerId,
                  name: order.customer.name,
                  phone: order.customer.phone
                }
              }
            }
          });

          // Send push notification to new rider
          try {
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(order.rider.user.id, {
              title: 'Naya order',
              message: newRiderMessage,
              data: {
                orderId: id,
                type: 'ORDER_ASSIGNED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('Failed to send push notification to new rider:', pushErr);
          }
        }
      } catch (notifyErr) {
        console.error('Failed to create rider notifications:', notifyErr);
        // Continue even if notifications fail
      }
    } else if (riderId && !oldRiderId) {
      // First time assignment - notify new rider
      try {
        if (order.rider?.user?.id) {
          const address = formatAddress(order.customer);
          const message = `${order.customer.name} ka order - ${order.numberOfBottles} bottle(ain), Rs ${order.totalAmount}, ${address}`;
          
          await prisma.notification.create({
            data: {
              userId: order.rider.user.id,
              title: 'Naya order',
              message: message,
              type: 'ORDER_ASSIGNED',
              data: {
                orderId: id,
                priority: order.priority,
                totalAmount: order.totalAmount,
                numberOfBottles: order.numberOfBottles,
                customer: {
                  id: order.customerId,
                  name: order.customer.name,
                  phone: order.customer.phone
                }
              }
            }
          });

          // Send push notification
          try {
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(order.rider.user.id, {
              title: 'Naya order',
              message: message,
              data: {
                orderId: id,
                type: 'ORDER_ASSIGNED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('Failed to send push notification:', pushErr);
          }
        }
      } catch (notifyErr) {
        console.error('Failed to create rider notification:', notifyErr);
      }
    }

    res.json({
      success: true,
      data: order,
      message: 'Order updated successfully'
    });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order',
      error: error.message
    });
  }
};

// Complete walk-in order with immediate payment
export const completeWalkInOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentAmount = 0, paymentMethod = 'CASH', notes } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.orderType !== 'WALKIN') {
      return res.status(400).json({ success: false, message: 'This endpoint is only for walk-in orders' });
    }

    if (order.status !== 'CREATED') {
      return res.status(400).json({ success: false, message: 'Order is not in CREATED status' });
    }

    const total = parseFloat(order.totalAmount);
    const paid = parseFloat(paymentAmount);
    const remaining = total - paid;

    // Determine payment status
    let paymentStatus = 'NOT_PAID';
    if (paid === 0) paymentStatus = 'NOT_PAID';
    else if (paid < 0) paymentStatus = 'REFUND';
    else if (paid > 0 && paid < total) paymentStatus = 'PARTIAL';
    else if (paid === total) paymentStatus = 'PAID';
    else if (paid > total) paymentStatus = 'OVERPAID';

    // Calculate receivable and payable
    let receivable = 0;
    let payable = 0;
    if (remaining > 0) {
      receivable = remaining;
    } else if (remaining < 0) {
      payable = Math.abs(remaining);
    }

    // Calculate new customer balance: current balance - paid amount
    const newCustomerBalance = parseFloat(order.customer.currentBalance) - paid;

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          paidAmount: paid,
          paymentStatus,
          paymentMethod,
          paymentNotes: notes || null,
          receivable,
          payable,
          deliveredAt: new Date()
        },
        include: {
          customer: true,
          rider: true
        }
      });

      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: newCustomerBalance }
      });

      return updatedOrder;
    });

    return res.json({ success: true, data: updated, message: 'Walk-in order completed successfully' });
  } catch (error) {
    console.error('Error completing walk-in order:', error);
    return res.status(500).json({ success: false, message: 'Failed to complete walk-in order', error: error.message });
  }
};

// Rider enroute order - create and immediately mark as delivered with full payment
export const createEnrouteOrder = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    if (!userId || userRole !== 'RIDER') {
      return res.status(403).json({
        success: false,
        message: 'Only riders can create enroute orders'
      });
    }

    const { customerId, numberOfBottles = 1, unitPrice, notes, paymentAmount, paymentMethod = 'CASH', priority = 'NORMAL' } = req.body;

    if (!customerId || !unitPrice) {
      return res.status(400).json({
        success: false,
        message: 'customerId and unitPrice are required'
      });
    }

    // Find rider profile and check permission
    const riderProfile = await prisma.riderProfile.findFirst({
      where: { userId, isActive: true },
      include: { user: true }
    });

    if (!riderProfile) {
      return res.status(404).json({
        success: false,
        message: 'Rider profile not found'
      });
    }

    if (!riderProfile.canCreateOrders) {
      return res.status(403).json({
        success: false,
        message: 'You are not allowed to create orders'
      });
    }

    // Handle walk-in customer lookup (reuse same logic)
    let customer;
    if (customerId === 'walkin') {
      customer = await prisma.customer.findFirst({
        where: { name: 'Walk-in Customer' },
        select: { id: true, currentBalance: true, name: true }
      });
    } else {
      customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, currentBalance: true, name: true }
      });
    }

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const bottles = parseInt(numberOfBottles);
    const price = parseFloat(unitPrice);
    const orderAmount = bottles * price;

    // Enroute orders must be fully paid
    const paid = paymentAmount !== undefined && paymentAmount !== null
      ? parseFloat(paymentAmount)
      : orderAmount;

    if (isNaN(paid) || paid <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Enroute order must have a positive paid amount'
      });
    }

    if (paid !== orderAmount) {
      return res.status(400).json({
        success: false,
        message: 'Enroute order must be fully paid (paid amount must equal order amount)'
      });
    }

    const customerBalanceSnapshot = parseFloat(customer.currentBalance);
    const totalAmount = customerBalanceSnapshot + orderAmount;

    const updatedOrder = await prisma.$transaction(async (tx) => {
      // Create base ENROUTE order
      const order = await tx.order.create({
        data: {
          customerId: customer.id,
          riderId: riderProfile.id,
          orderType: 'ENROUTE',
          status: 'DELIVERED',
          numberOfBottles: bottles,
          currentOrderAmount: orderAmount,
          customerBalance: customerBalanceSnapshot,
          totalAmount: totalAmount,
          paidAmount: paid,
          paymentStatus: 'PAID',
          paymentMethod: paymentMethod.toUpperCase(),
          paymentNotes: notes || null,
          receivable: 0,
          payable: 0,
          priority: priority.toUpperCase(),
          notes,
          deliveredAt: new Date()
        },
        include: {
          customer: true,
          rider: true
        }
      });

      // Update customer balance after payment (same as deliverOrder: currentBalance - paid)
      const newCustomerBalance = customerBalanceSnapshot - paid;
      await tx.customer.update({
        where: { id: customer.id },
        data: { currentBalance: newCustomerBalance }
      });

      return order;
    });

    // Notify all admins about enroute order
    try {
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true }
      });

      const adminUserIds = [];
      const message = `${riderProfile.name} ne ek enroute order create kia or deliver kar dia hai - ${updatedOrder.numberOfBottles} bottle(ain), Rs ${updatedOrder.paidAmount}`;

      for (const adminUser of adminUsers) {
        adminUserIds.push(adminUser.id);
        await prisma.notification.create({
          data: {
            userId: adminUser.id,
            title: 'Enroute order complete ho gaya',
            message: message,
            type: 'ORDER_DELIVERED',
            data: {
              orderId: updatedOrder.id,
              rider: {
                id: riderProfile.id,
                name: riderProfile.name
              },
              customer: {
                id: updatedOrder.customerId,
                name: updatedOrder.customer.name,
                phone: updatedOrder.customer.phone
              },
              paymentAmount: updatedOrder.paidAmount,
              paymentStatus: updatedOrder.paymentStatus,
              totalAmount: updatedOrder.totalAmount
            }
          }
        });
      }

      // Push notification to admins
      try {
        const { sendToMultipleUsers } = await import('../services/pushService.js');
        await sendToMultipleUsers(adminUserIds, {
          title: 'Enroute order complete ho gaya',
          message: message,
          data: {
            orderId: updatedOrder.id,
            type: 'ORDER_DELIVERED'
          },
          clickAction: `/admin/orders/${updatedOrder.id}`
        });
      } catch (pushErr) {
        console.error('Failed to send enroute push notification:', pushErr);
      }
    } catch (notifyErr) {
      console.error('Failed to create enroute admin notification:', notifyErr);
    }

    return res.status(201).json({
      success: true,
      data: updatedOrder,
      message: 'Enroute order created and delivered successfully'
    });
  } catch (error) {
    console.error('Error creating enroute order:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create enroute order',
      error: error.message
    });
  }
};

// Mark order delivered and handle payment + customer balance
export const deliverOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentAmount = 0, paymentMethod = 'CASH', notes } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const total = parseFloat(order.totalAmount);
    const paid = parseFloat(paymentAmount);
    const remaining = total - paid;

    // Determine payment status
    let paymentStatus = 'NOT_PAID';
    if (paid === 0) paymentStatus = 'NOT_PAID';
    else if (paid < 0) paymentStatus = 'REFUND'; // Refund given to customer
    else if (paid > 0 && paid < total) paymentStatus = 'PARTIAL';
    else if (paid === total) paymentStatus = 'PAID';
    else if (paid > total) paymentStatus = 'OVERPAID';

    // Calculate receivable and payable
    let receivable = 0;
    let payable = 0;
    if (remaining > 0) {
      receivable = remaining; // Customer owes us money
    } else if (remaining < 0) {
      payable = Math.abs(remaining); // We owe customer money
    }
    // If remaining = 0, both stay 0 (default values)

    // Calculate new customer balance: current balance - paid amount
    const newCustomerBalance = parseFloat(order.customer.currentBalance) - paid;

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: 'DELIVERED',
          paidAmount: paid,
          paymentStatus,
          paymentMethod,
          paymentNotes: notes || null,
          receivable,
          payable,
          deliveredAt: new Date()
        },
        include: {
          customer: true,
          rider: true
        }
      });

      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: newCustomerBalance }
      });

      return updatedOrder;
    });

    // Create notification for all admin users
    try {
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true }
      });

      const adminUserIds = [];
      // Include updated order details in notification
      const message = `${updated.customer.name} | ${updated.numberOfBottles} bottle(s) | Total Rs ${total} | Received Rs ${paid} | Payment: ${paymentStatus}`;

      for (const adminUser of adminUsers) {
        adminUserIds.push(adminUser.id);
        await prisma.notification.create({
          data: {
            userId: adminUser.id,
            title: 'Order deliver ho gaya',
            message: message,
            type: 'ORDER_DELIVERED',
            data: {
              orderId: id,
              customer: {
                id: order.customerId,
                name: updated.customer.name,
                phone: updated.customer.phone
              },
              rider: updated.rider ? {
                id: updated.rider.id,
                name: updated.rider.name
              } : null,
              paymentAmount: paid,
              paymentStatus,
              totalAmount: total,
              numberOfBottles: updated.numberOfBottles,
              currentOrderAmount: parseFloat(updated.currentOrderAmount)
            }
          }
        });
      }

      // Send push notification to all admins
      try {
        const { sendToMultipleUsers } = await import('../services/pushService.js');
        await sendToMultipleUsers(adminUserIds, {
          title: 'Order deliver ho gaya',
          message: message,
          data: {
            orderId: id,
            type: 'ORDER_DELIVERED'
          },
          clickAction: `/admin/orders/${id}`
        });
      } catch (pushErr) {
        console.error('Failed to send push notification:', pushErr);
      }
    } catch (notifyErr) {
      console.error('Failed to create admin notification:', notifyErr);
    }

    return res.json({ success: true, data: updated, message: 'Order delivered and balances updated' });
  } catch (error) {
    console.error('Error delivering order:', error);
    return res.status(500).json({ success: false, message: 'Failed to deliver order', error: error.message });
  }
};

// Cancel order and revert customer balance
export const cancelOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user?.role; // Get user role from authenticated request

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        rider: {
          select: { id: true, name: true, userId: true }
        }
      }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    if (order.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Order is already cancelled' });
    }

    if (order.status === 'DELIVERED') {
      return res.status(400).json({ success: false, message: 'Cannot cancel a delivered order' });
    }

    // Revert customer balance to the balance before this order
    const originalCustomerBalance = parseFloat(order.customerBalance);

    // Change order status to CANCELLED and revert balance (for both rider and admin)
    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED'
        },
        include: {
          customer: true,
          rider: true
        }
      });

      // Revert customer balance to original balance before this order
      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: originalCustomerBalance }
      });

      return updatedOrder;
    });

    // If rider is canceling, notify admins about the cancellation
    if (userRole === 'RIDER') {
      try {
        // Get full customer details for address
        const fullCustomer = await prisma.customer.findUnique({
          where: { id: order.customerId },
          select: { name: true, houseNo: true, streetNo: true, area: true, city: true }
        });

        const address = formatAddress(fullCustomer);
        const message = `${updated.rider?.name || 'Rider'} ne ${fullCustomer.name} ka order cancel kar diya - ${updated.numberOfBottles} bottle(ain), Rs ${updated.totalAmount}, ${address}`;

        // Get all admin users
        const adminUsers = await prisma.user.findMany({
          where: { role: 'ADMIN', isActive: true },
          select: { id: true }
        });

        const adminUserIds = [];

        // Create notifications for all admins
        for (const adminUser of adminUsers) {
          adminUserIds.push(adminUser.id);
          await prisma.notification.create({
            data: {
              userId: adminUser.id,
              title: 'Order cancel ho gaya',
              message: message,
              type: 'RIDER_CANCELED_ORDER',
              data: {
                orderId: id,
                rider: updated.rider ? {
                  id: updated.rider.id,
                  name: updated.rider.name
                } : null,
                customer: {
                  id: order.customerId,
                  name: fullCustomer.name,
                  phone: updated.customer.phone
                },
                numberOfBottles: updated.numberOfBottles
              }
            }
          });
        }

        // Send push notification to all admins
        try {
          const { sendToMultipleUsers } = await import('../services/pushService.js');
          await sendToMultipleUsers(adminUserIds, {
            title: 'Order cancel ho gaya',
            message: message,
            data: {
              orderId: id,
              type: 'RIDER_CANCELED_ORDER'
            },
            clickAction: `/admin/orders/${id}`
          });
        } catch (pushErr) {
          console.error('Failed to send push notification:', pushErr);
        }
      } catch (notifyErr) {
        console.error('Failed to create admin notification:', notifyErr);
        // Continue even if notification fails
      }
    }

    // If admin (or not rider) cancels, notify the assigned rider (if any)
    if (userRole !== 'RIDER' && updated.rider?.userId) {
      try {
        const fullCustomer = await prisma.customer.findUnique({
          where: { id: updated.customer.id },
          select: { name: true, houseNo: true, streetNo: true, area: true, city: true }
        });
        const address = formatAddress(fullCustomer);
        const riderMessage = `${fullCustomer.name} ka ${updated.numberOfBottles} bottle(ain) wala order cancel ho gaya, ${address}`;

        await prisma.notification.create({
          data: {
            userId: updated.rider.userId,
            title: 'Order cancel ho gaya',
            message: riderMessage,
            type: 'SYSTEM_UPDATE',
            data: {
              orderId: id,
              customer: {
                id: updated.customer.id,
                name: fullCustomer.name,
                phone: updated.customer.phone
              },
              numberOfBottles: updated.numberOfBottles
            }
          }
        });

        try {
          const { sendToUser } = await import('../services/pushService.js');
          await sendToUser(updated.rider.userId, {
            title: 'Order cancel ho gaya',
            message: riderMessage,
            data: {
              orderId: id,
              type: 'SYSTEM_UPDATE'
            },
            clickAction: `/rider/orders/${id}`
          });
        } catch (pushErr) {
          console.error('Failed to send push notification to rider:', pushErr);
        }
      } catch (notifyErr) {
        console.error('Failed to notify rider about cancellation:', notifyErr);
      }
    }

    return res.json({ success: true, data: updated, message: 'Order cancelled and customer balance reverted' });
  } catch (error) {
    console.error('Error cancelling order:', error);
    return res.status(500).json({ success: false, message: 'Failed to cancel order', error: error.message });
  }
};

// Update order details
export const updateOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { totalAmount, notes, priority, numberOfBottles, status, riderId } = req.body;

    const updateData = {};
    if (totalAmount !== undefined) updateData.totalAmount = parseFloat(totalAmount);
    if (notes !== undefined) updateData.notes = notes;
    if (priority !== undefined) updateData.priority = priority.toUpperCase();
    if (numberOfBottles !== undefined) updateData.numberOfBottles = parseInt(numberOfBottles);
    if (status !== undefined) updateData.status = status.toUpperCase();
    if (riderId !== undefined) updateData.riderId = riderId;

    const order = await prisma.order.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        rider: {
          include: {
            user: {
              select: { id: true }
            }
          }
        }
      }
    });

    // Notify rider if order is assigned and has a rider
    if (order.rider?.user?.id) {
      try {
        // Get full customer details for address
        const fullCustomer = await prisma.customer.findUnique({
          where: { id: order.customerId },
          select: { name: true, houseNo: true, streetNo: true, area: true, city: true }
        });

        const address = formatAddress(fullCustomer);
        const message = `${fullCustomer.name} ke order mein changes - ${order.numberOfBottles} bottle(ain), amount Rs ${order.totalAmount}, ${address}`;

        await prisma.notification.create({
          data: {
            userId: order.rider.user.id,
            title: 'Order mein changes hain',
            message: message,
            type: 'ORDER_UPDATED',
            data: {
              orderId: id,
              priority: order.priority,
              totalAmount: order.totalAmount,
              numberOfBottles: order.numberOfBottles,
              customer: {
                id: order.customerId,
                name: fullCustomer.name,
                phone: order.customer.phone
              }
            }
          }
        });

        // Send push notification
        try {
          const { sendToUser } = await import('../services/pushService.js');
          await sendToUser(order.rider.user.id, {
            title: 'Order mein changes hain',
            message: message,
            data: {
              orderId: id,
              type: 'ORDER_UPDATED'
            },
            clickAction: `/rider/orders/${id}`
          });
        } catch (pushErr) {
          console.error('Failed to send push notification:', pushErr);
        }
      } catch (notifyErr) {
        console.error('Failed to create rider notification:', notifyErr);
        // Continue even if notification fails
      }
    }

    res.json({
      success: true,
      data: order,
      message: 'Order updated successfully'
    });
  } catch (error) {
    console.error('Error updating order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update order',
      error: error.message
    });
  }
};

// Clear bill - Create CLEARBILL order and mark as completed immediately
export const clearBill = async (req, res) => {
  try {
    const { customerId, paidAmount, paymentMethod = 'CASH', paymentNotes, priority = 'NORMAL' } = req.body;

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: 'Customer ID is required'
      });
    }

    if (paidAmount === undefined || paidAmount === null) {
      return res.status(400).json({
        success: false,
        message: 'Paid amount is required'
      });
    }

    // Fetch customer
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, name: true, currentBalance: true }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    const customerBalance = parseFloat(customer.currentBalance);
    const paid = parseFloat(paidAmount);

    // If customer balance is zero, nothing to clear
    if (customerBalance === 0) {
      return res.status(400).json({
        success: false,
        message: 'Customer balance is already zero'
      });
    }

    // Determine if it's receivable or payable
    let receivable = 0;
    let payable = 0;
    let totalAmount = customerBalance;
    let paymentStatus = 'NOT_PAID';
    let adjustedPaid = paid;

    if (customerBalance > 0) {
      // Receivable case - customer owes us (positive balance)
      receivable = customerBalance;
      const remainingReceivable = receivable - paid;
      
      if (remainingReceivable === 0) {
        paymentStatus = 'PAID';
        receivable = 0;  // Fully paid, no remaining receivable
        payable = 0;
      } else if (remainingReceivable < 0) {
        paymentStatus = 'OVERPAID';
        receivable = 0;
        payable = Math.abs(remainingReceivable);
      } else if (paid > 0) {
        paymentStatus = 'PARTIAL';
        receivable = remainingReceivable;  // Set to remaining amount
        payable = 0;
      } else {
        paymentStatus = 'NOT_PAID';
        payable = 0;
      }
    } else {
      // Payable case - we owe customer (negative balance)
      payable = Math.abs(customerBalance);
      const remainingPayable = payable - paid;
      
      if (remainingPayable === 0) {
        paymentStatus = 'PAID';
        payable = 0;  // Fully paid, no remaining payable
        receivable = 0;
      } else if (remainingPayable < 0) {
        paymentStatus = 'OVERPAID';
        payable = 0;
        receivable = Math.abs(remainingPayable);
      } else if (paid > 0) {
        paymentStatus = 'PARTIAL';
        payable = remainingPayable;  // Set to remaining amount
        receivable = 0;
      } else {
        paymentStatus = 'NOT_PAID';
        receivable = 0;
      }
      
      // For payable, paidAmount should be negative
      adjustedPaid = -paid;
    }

    // Calculate new customer balance: oldBalance - paidAmount
    const newCustomerBalance = customerBalance - adjustedPaid;

    const order = await prisma.$transaction(async (tx) => {
      // Create the CLEARBILL order and mark as completed immediately
      const newOrder = await tx.order.create({
        data: {
          customerId: customer.id,
          orderType: 'CLEARBILL',
          status: 'COMPLETED',
          numberOfBottles: 0,
          currentOrderAmount: 0,
          customerBalance: customerBalance,
          totalAmount: totalAmount,
          paidAmount: adjustedPaid,
          paymentStatus,
          paymentMethod: paymentMethod.toUpperCase(),
          paymentNotes: paymentNotes || null,
          receivable,
          payable,
          priority: priority.toUpperCase(),
          deliveredAt: new Date()
        },
        include: {
          customer: true,
          rider: true
        }
      });

      // Update customer's current balance
      await tx.customer.update({
        where: { id: customer.id },
        data: { currentBalance: newCustomerBalance }
      });

      return newOrder;
    });

    res.status(201).json({
      success: true,
      data: order,
      message: 'Bill cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing bill:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear bill',
      error: error.message
    });
  }
};

// Amend an in-progress order (PENDING/ASSIGNED) by reverting customer balance to snapshot,
// recalculating the order amount, and reapplying the provisional balance.
export const amendOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const { numberOfBottles, unitPrice, notes, priority, riderId } = req.body;

    const order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Only allow amendments for non-delivered/cancelled
    const editableStatuses = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];
    if (!editableStatuses.includes(order.status)) {
      return res.status(400).json({ success: false, message: 'Only in-progress orders can be amended' });
    }

    // Required inputs
    if (numberOfBottles === undefined || unitPrice === undefined) {
      return res.status(400).json({ success: false, message: 'numberOfBottles and unitPrice are required' });
    }

    // Revert: take customer back to snapshot balance recorded on the order
    const snapshotBalance = parseFloat(order.customerBalance);
    const newCurrentOrderAmount = parseFloat(numberOfBottles) * parseFloat(unitPrice);
    // Create uses: totalAmount = customerBalance (snapshot) + currentOrderAmount
    const newTotalAmount = snapshotBalance + newCurrentOrderAmount;

    const updated = await prisma.$transaction(async (tx) => {
      // Revert customer balance to snapshot first
      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: snapshotBalance }
      });

      // Update the order in place (same id)
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          // Keep snapshot as-is (order.customerBalance)
          numberOfBottles: parseInt(numberOfBottles),
          totalAmount: newTotalAmount,
          currentOrderAmount: newCurrentOrderAmount,
          ...(notes !== undefined ? { notes } : {}),
          ...(priority !== undefined ? { priority: String(priority).toUpperCase() } : {}),
          ...(riderId !== undefined ? { riderId } : {})
        },
        include: { customer: true, rider: true }
      });

      // Reapply provisional balance after amendment
      const finalCustomerBalance = newTotalAmount; // snapshot + currentOrderAmount
      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: finalCustomerBalance }
      });

      return updatedOrder;
    });

    // Notify assigned rider (if any) about the update
    if (updated.rider?.userId) {
      try {
        const fullCustomer = await prisma.customer.findUnique({
          where: { id: updated.customer.id },
          select: { name: true, houseNo: true, streetNo: true, area: true, city: true }
        });
        const address = formatAddress(fullCustomer);
        const message = `${fullCustomer.name} ke order mein changes - ${updated.numberOfBottles} bottle(ain), amount Rs ${updated.totalAmount}, ${address}`;

        await prisma.notification.create({
          data: {
            userId: updated.rider.userId,
            title: 'Order mein changes hain',
            message: message,
            type: 'ORDER_UPDATED',
            data: {
              orderId: id,
              priority: updated.priority,
              totalAmount: updated.totalAmount,
              numberOfBottles: updated.numberOfBottles,
              customer: {
                id: updated.customer.id,
                name: fullCustomer.name,
                phone: updated.customer.phone
              }
            }
          }
        });

        try {
          const { sendToUser } = await import('../services/pushService.js');
          await sendToUser(updated.rider.userId, {
            title: 'Order mein changes hain',
            message: message,
            data: {
              orderId: id,
              type: 'ORDER_UPDATED'
            },
            clickAction: `/rider/orders/${id}`
          });
        } catch (pushErr) {
          console.error('Failed to send push notification:', pushErr);
        }
      } catch (notifyErr) {
        console.error('Failed to create ORDER_UPDATED notification in amend:', notifyErr);
      }
    }

    return res.json({ success: true, data: updated, message: 'Order amended successfully' });
  } catch (error) {
    console.error('Error amending order:', error);
    return res.status(500).json({ success: false, message: 'Failed to amend order', error: error.message });
  }
};

// Rider edit order - only quantity can be changed
export const editOrderByRider = async (req, res) => {
  try {
    const { id } = req.params;
    const { numberOfBottles } = req.body;
    const userId = req.user?.id;
    const userRole = req.user?.role;

    // Only riders can edit
    if (!userId || userRole !== 'RIDER') {
      return res.status(403).json({
        success: false,
        message: 'Only riders can edit orders'
      });
    }

    if (!numberOfBottles || numberOfBottles < 1) {
      return res.status(400).json({
        success: false,
        message: 'numberOfBottles must be at least 1'
      });
    }

    // Get rider profile
    const riderProfile = await prisma.riderProfile.findFirst({
      where: { userId, isActive: true }
    });

    if (!riderProfile) {
      return res.status(404).json({
        success: false,
        message: 'Rider profile not found'
      });
    }

    // Get order
    const order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true }
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Check if rider is assigned to this order
    if (order.riderId !== riderProfile.id) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit orders assigned to you'
      });
    }

    // Only allow edits for ASSIGNED or IN_PROGRESS orders
    const editableStatuses = ['ASSIGNED', 'IN_PROGRESS'];
    if (!editableStatuses.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Only assigned or in-progress orders can be edited'
      });
    }

    // Store original values for notification
    const originalBottles = order.numberOfBottles;
    const originalTotalAmount = parseFloat(order.totalAmount);

    // Calculate unit price from current order
    const unitPrice = parseFloat(order.currentOrderAmount) / order.numberOfBottles;

    // Revert customer balance to snapshot
    const snapshotBalance = parseFloat(order.customerBalance);
    const newCurrentOrderAmount = parseInt(numberOfBottles) * unitPrice;
    const newTotalAmount = snapshotBalance + newCurrentOrderAmount;

    const updated = await prisma.$transaction(async (tx) => {
      // Revert customer balance to snapshot first
      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: snapshotBalance }
      });

      // Update the order
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          numberOfBottles: parseInt(numberOfBottles),
          totalAmount: newTotalAmount,
          currentOrderAmount: newCurrentOrderAmount
        },
        include: { customer: true, rider: true }
      });

      // Update customer balance with new total
      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: newTotalAmount }
      });

      return updatedOrder;
    });

    // Notify all admin users
    try {
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true }
      });

      const fullCustomer = await prisma.customer.findUnique({
        where: { id: updated.customer.id },
        select: { name: true, houseNo: true, streetNo: true, area: true, city: true }
      });

      const address = formatAddress(fullCustomer);
      const message = `Rider na ${fullCustomer.name} ka order update kia ha jo ${originalBottles} phela tha or ab ${updated.numberOfBottles} ha ot ab bill ${newTotalAmount}`;

      for (const adminUser of adminUsers) {
        await prisma.notification.create({
          data: {
            userId: adminUser.id,
            title: 'Rider ne order update kia',
            message: message,
            type: 'ORDER_UPDATED',
            data: {
              orderId: id,
              customer: {
                id: updated.customer.id,
                name: fullCustomer.name,
                phone: updated.customer.phone
              },
              rider: {
                id: updated.rider?.id,
                name: updated.rider?.name
              },
              originalBottles,
              newBottles: updated.numberOfBottles,
              originalTotalAmount,
              newTotalAmount,
              address
            }
          }
        });
      }

      // Send push notification to all admins
      try {
        const { sendToMultipleUsers } = await import('../services/pushService.js');
        const adminUserIds = adminUsers.map(u => u.id);
        await sendToMultipleUsers(adminUserIds, {
          title: 'Rider ne order update kia',
          message: message,
          data: {
            orderId: id,
            type: 'ORDER_UPDATED'
          },
          clickAction: `/admin/orders/${id}`
        });
      } catch (pushErr) {
        console.error('Failed to send push notification:', pushErr);
      }
    } catch (notifyErr) {
      console.error('Failed to create admin notification:', notifyErr);
    }

    return res.json({
      success: true,
      data: updated,
      message: 'Order updated successfully'
    });
  } catch (error) {
    console.error('Error editing order by rider:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to edit order',
      error: error.message
    });
  }
};
