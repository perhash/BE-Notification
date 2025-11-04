import { PrismaClient } from '@prisma/client';
import { getPktDateRangeUtc, getPktDayStartUtc, getPktDayEndUtc, formatPktDate } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Helper function to format customer full address
const formatCustomerAddress = (customer) => {
  const addressParts = [
    customer.houseNo,
    customer.streetNo,
    customer.area,
    customer.city
  ].filter(Boolean);
  
  return addressParts.join(' ') || 'Address not provided';
};

// Helper function to format bottle text (singular/plural)
const formatBottleText = (count) => {
  return count === 1 ? `${count} bottle` : `${count} bottles`;
};

// Helper function to format delivery message for order assigned
const formatOrderAssignedMessage = (customer, numberOfBottles) => {
  const address = formatCustomerAddress(customer);
  const bottleText = formatBottleText(numberOfBottles);
  return `Order for ${customer.name}, deliver ${bottleText} to ${address}`;
};

// Helper function to format order delivered message with payment details
const formatOrderDeliveredMessage = (customer, totalAmount, paidAmount, remaining) => {
  const total = totalAmount.toFixed(0);
  const paid = paidAmount.toFixed(0);
  const remainingAmount = Math.abs(remaining).toFixed(0);
  
  if (remaining === 0) {
    // Fully paid
    return `Order delivered to ${customer.name}. Total: RS ${total}, Received: RS ${paid}, Fully paid.`;
  } else if (remaining > 0) {
    // Partial payment
    return `Order delivered to ${customer.name}. Total: RS ${total}, Received: RS ${paid}, Remaining: RS ${remainingAmount}`;
  } else {
    // Overpaid
    return `Order delivered to ${customer.name}. Total: RS ${total}, Received: RS ${paid}, Overpaid: RS ${remainingAmount}`;
  }
};

// Helper function to format reassignment message for old rider
const formatReassignOldRiderMessage = (customer, numberOfBottles, newRiderName) => {
  const address = formatCustomerAddress(customer);
  const bottleText = formatBottleText(numberOfBottles);
  return `This order has been reassigned to ${newRiderName}. Order for ${customer.name}, ${bottleText} to ${address}. Do not deliver.`;
};

// Helper function to format reassignment message for new rider
const formatReassignNewRiderMessage = (customer, numberOfBottles, oldRiderName) => {
  const address = formatCustomerAddress(customer);
  const bottleText = formatBottleText(numberOfBottles);
  return `This order has been reassigned to you from ${oldRiderName}. Order for ${customer.name}, deliver ${bottleText} to ${address}.`;
};

// Helper function to format cancellation message for rider
const formatCancelByAdminMessage = (customer, numberOfBottles) => {
  const address = formatCustomerAddress(customer);
  const bottleText = formatBottleText(numberOfBottles);
  return `Order cancelled by admin. Order for ${customer.name}, ${bottleText} to ${address}.`;
};

// Helper function to format cancellation message for admin
const formatCancelByRiderMessage = (customer, numberOfBottles, riderName) => {
  const address = formatCustomerAddress(customer);
  const bottleText = formatBottleText(numberOfBottles);
  return `Order cancelled by rider ${riderName}. Order for ${customer.name}, ${bottleText} to ${address}.`;
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
          // Get customer details with full address
          const customerWithAddress = await prisma.customer.findUnique({
            where: { id: order.customer.id },
            select: { name: true, phone: true, houseNo: true, streetNo: true, area: true, city: true }
          });

          const notificationMessage = formatOrderAssignedMessage(customerWithAddress, order.numberOfBottles);

          await prisma.notification.create({
            data: {
              userId: riderProfile.userId,
              title: 'New Order Assigned',
              message: notificationMessage,
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
            console.log('[orderController] Creating order - sending push to rider:', riderProfile.userId);
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(riderProfile.userId, {
              title: 'New Order Assigned',
              message: notificationMessage,
              data: {
                orderId: order.id,
                type: 'ORDER_ASSIGNED'
              },
              clickAction: `/rider/orders/${order.id}`
            });
            console.log('[orderController] Push notification sent successfully for order:', order.id);
          } catch (pushErr) {
            console.error('[orderController] Failed to send push notification:', pushErr);
          }
        }
      } catch (notifyErr) {
        console.error('[orderController] Failed to create rider notification:', notifyErr);
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

    const updateData = { status: status.toUpperCase() };
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

    // If rider is being changed (reassigned), send notifications
    if (riderId && oldRiderId && riderId !== oldRiderId) {
      try {
        console.log('[orderController] Order reassigned - preparing notifications');
        
        // Get customer details with full address
        const customerWithAddress = await prisma.customer.findUnique({
          where: { id: currentOrder.customerId },
          select: { name: true, phone: true, houseNo: true, streetNo: true, area: true, city: true }
        });

        // Get old and new rider names
        const oldRiderProfile = oldRiderId ? await prisma.riderProfile.findUnique({
          where: { id: oldRiderId },
          select: { name: true }
        }) : null;

        const newRiderProfile = order.rider ? {
          name: order.rider.name
        } : null;

        // Notify old rider that order is reassigned
        if (oldRiderUserId && newRiderProfile) {
          const oldRiderMessage = formatReassignOldRiderMessage(
            customerWithAddress,
            order.numberOfBottles,
            newRiderProfile.name
          );

          await prisma.notification.create({
            data: {
              userId: oldRiderUserId,
              title: 'Order Re-assigned',
              message: oldRiderMessage,
              type: 'ORDER_UNASSIGNED',
              data: {
                orderId: id,
                customer: {
                  id: currentOrder.customerId,
                  name: currentOrder.customer.name,
                  phone: currentOrder.customer.phone
                }
              }
            }
          });

          // Send push notification to old rider
          try {
            console.log('[orderController] Sending push to old rider:', oldRiderUserId);
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(oldRiderUserId, {
              title: 'Order Re-assigned',
              message: oldRiderMessage,
              data: {
                orderId: id,
                type: 'ORDER_UNASSIGNED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('[orderController] Failed to send push to old rider:', pushErr);
          }
        }

        // Notify new rider that order is assigned
        if (order.rider?.user?.id && oldRiderProfile) {
          const newRiderMessage = formatReassignNewRiderMessage(
            customerWithAddress,
            order.numberOfBottles,
            oldRiderProfile.name
          );

          await prisma.notification.create({
            data: {
              userId: order.rider.user.id,
              title: 'New Order Assigned',
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
            console.log('[orderController] Sending push to new rider:', order.rider.user.id);
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(order.rider.user.id, {
              title: 'New Order Assigned',
              message: newRiderMessage,
              data: {
                orderId: id,
                type: 'ORDER_ASSIGNED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('[orderController] Failed to send push to new rider:', pushErr);
          }
        }
      } catch (notifyErr) {
        console.error('[orderController] Failed to create rider notifications:', notifyErr);
        // Continue even if notifications fail
      }
    } else if (riderId && !oldRiderId) {
      // First time assignment - notify new rider
      try {
        if (order.rider?.user?.id) {
          // Get customer details with full address
          const customerWithAddress = await prisma.customer.findUnique({
            where: { id: order.customerId },
            select: { name: true, phone: true, houseNo: true, streetNo: true, area: true, city: true }
          });

          const notificationMessage = formatOrderAssignedMessage(customerWithAddress, order.numberOfBottles);

          await prisma.notification.create({
            data: {
              userId: order.rider.user.id,
              title: 'New Order Assigned',
              message: notificationMessage,
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
            console.log('[orderController] First assignment - sending push to rider:', order.rider.user.id);
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(order.rider.user.id, {
              title: 'New Order Assigned',
              message: notificationMessage,
              data: {
                orderId: id,
                type: 'ORDER_ASSIGNED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('[orderController] Failed to send push notification:', pushErr);
          }
        }
      } catch (notifyErr) {
        console.error('[orderController] Failed to create rider notification:', notifyErr);
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
      console.log('[orderController] Delivering order - preparing notifications for admins');
      
      const adminUsers = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
        select: { id: true }
      });

      console.log('[orderController] Found', adminUsers.length, 'admin user(s)');

      // Get customer details with full address
      const customerWithAddress = await prisma.customer.findUnique({
        where: { id: order.customerId },
        select: { name: true, phone: true, houseNo: true, streetNo: true, area: true, city: true }
      });

      const notificationMessage = formatOrderDeliveredMessage(customerWithAddress, total, paid, remaining);
      console.log('[orderController] Notification message:', notificationMessage);

      const adminUserIds = [];

      for (const adminUser of adminUsers) {
        adminUserIds.push(adminUser.id);
        await prisma.notification.create({
          data: {
            userId: adminUser.id,
            title: 'Order Delivered',
            message: notificationMessage,
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
              totalAmount: total
            }
          }
        });
      }

      console.log('[orderController] Created', adminUserIds.length, 'DB notification(s)');

      // Send push notification to all admins
      try {
        console.log('[orderController] Sending push notifications to', adminUserIds.length, 'admin(s)');
        const { sendToMultipleUsers } = await import('../services/pushService.js');
        await sendToMultipleUsers(adminUserIds, {
          title: 'Order Delivered',
          message: notificationMessage,
          data: {
            orderId: id,
            type: 'ORDER_DELIVERED'
          },
          clickAction: `/admin/orders/${id}`
        });
        console.log('[orderController] Push notifications sent successfully for order:', id);
      } catch (pushErr) {
        console.error('[orderController] Failed to send push notification:', pushErr);
      }
    } catch (notifyErr) {
      console.error('[orderController] Failed to create admin notification:', notifyErr);
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

    const order = await prisma.order.findUnique({
      where: { id },
      include: { customer: true }
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

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: 'CANCELLED'
        },
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

      // Revert customer balance to original balance before this order
      await tx.customer.update({
        where: { id: order.customerId },
        data: { currentBalance: originalCustomerBalance }
      });

      return updatedOrder;
    });

    // Determine who cancelled the order (admin or rider)
    const cancellerRole = req.user?.role || 'ADMIN'; // Default to ADMIN if not specified
    
    console.log('[orderController] Order cancelled by:', cancellerRole);

    // Get customer details with full address
    const customerWithAddress = await prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { name: true, phone: true, houseNo: true, streetNo: true, area: true, city: true }
    });

    // Send notifications based on who cancelled
    try {
      if (cancellerRole === 'ADMIN') {
        // Admin cancelled - notify rider
        if (updated.rider?.user?.id) {
          const riderMessage = formatCancelByAdminMessage(customerWithAddress, order.numberOfBottles);
          
          await prisma.notification.create({
            data: {
              userId: updated.rider.user.id,
              title: 'Order Cancelled',
              message: riderMessage,
              type: 'ORDER_CANCELLED',
              data: {
                orderId: id,
                customer: {
                  id: order.customerId,
                  name: updated.customer.name,
                  phone: updated.customer.phone
                }
              }
            }
          });

          // Send push notification to rider
          try {
            console.log('[orderController] Sending cancellation push to rider:', updated.rider.user.id);
            const { sendToUser } = await import('../services/pushService.js');
            await sendToUser(updated.rider.user.id, {
              title: 'Order Cancelled',
              message: riderMessage,
              data: {
                orderId: id,
                type: 'ORDER_CANCELLED'
              },
              clickAction: `/rider/orders/${id}`
            });
          } catch (pushErr) {
            console.error('[orderController] Failed to send cancellation push to rider:', pushErr);
          }
        }
      } else if (cancellerRole === 'RIDER') {
        // Rider cancelled - notify all admins
        const adminUsers = await prisma.user.findMany({
          where: { role: 'ADMIN', isActive: true },
          select: { id: true }
        });

        if (adminUsers.length > 0 && updated.rider) {
          const adminMessage = formatCancelByRiderMessage(
            customerWithAddress,
            order.numberOfBottles,
            updated.rider.name
          );

          const adminUserIds = [];

          for (const adminUser of adminUsers) {
            adminUserIds.push(adminUser.id);
            await prisma.notification.create({
              data: {
                userId: adminUser.id,
                title: 'Rider Cancelled Order',
                message: adminMessage,
                type: 'ORDER_CANCELLED',
                data: {
                  orderId: id,
                  customer: {
                    id: order.customerId,
                    name: updated.customer.name,
                    phone: updated.customer.phone
                  },
                  rider: {
                    id: updated.rider.id,
                    name: updated.rider.name
                  }
                }
              }
            });
          }

          // Send push notification to all admins
          try {
            console.log('[orderController] Sending cancellation push to', adminUserIds.length, 'admin(s)');
            const { sendToMultipleUsers } = await import('../services/pushService.js');
            await sendToMultipleUsers(adminUserIds, {
              title: 'Rider Cancelled Order',
              message: adminMessage,
              data: {
                orderId: id,
                type: 'ORDER_CANCELLED'
              },
              clickAction: `/admin/orders/${id}`
            });
          } catch (pushErr) {
            console.error('[orderController] Failed to send cancellation push to admins:', pushErr);
          }
        }
      }
    } catch (notifyErr) {
      console.error('[orderController] Failed to create cancellation notifications:', notifyErr);
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
        rider: true
      }
    });

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

    return res.json({ success: true, data: updated, message: 'Order amended successfully' });
  } catch (error) {
    console.error('Error amending order:', error);
    return res.status(500).json({ success: false, message: 'Failed to amend order', error: error.message });
  }
};
