import { PrismaClient } from '@prisma/client';
import { getTodayPktDate, getPktDateRangeUtc, formatPktDate } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Get daily closing summary for today (without saving)
export const getDailyClosingSummary = async (req, res) => {
  try {
    const todayPktDate = getTodayPktDate();
    const { start, end } = getPktDateRangeUtc(todayPktDate);

    // Check if orders are in progress (PENDING, ASSIGNED, IN_PROGRESS, CREATED)
    // These statuses indicate orders that are not completed and should block daily closing
    const inProgressOrders = await prisma.order.count({
      where: {
        status: {
          in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'CREATED']
        }
      }
    });

    // Get all active customers
    const activeCustomers = await prisma.customer.findMany({
      where: {
        isActive: true
      },
      select: {
        currentBalance: true
      }
    });

    // Calculate customer payable (sum of negative balances)
    const customerPayable = activeCustomers
      .filter(c => parseFloat(c.currentBalance) < 0)
      .reduce((sum, c) => sum + Math.abs(parseFloat(c.currentBalance)), 0);

    // Calculate customer receivable (sum of positive balances)
    const customerReceivable = activeCustomers
      .filter(c => parseFloat(c.currentBalance) > 0)
      .reduce((sum, c) => sum + parseFloat(c.currentBalance), 0);

    // Get today's orders (excluding cancelled) with more details
    const todayOrders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end
        },
        status: {
          not: 'CANCELLED'
        }
      },
      select: {
        paidAmount: true,
        currentOrderAmount: true,
        numberOfBottles: true,
        riderId: true,
        paymentMethod: true,
        orderType: true
      }
    });

    // Calculate totals
    const totalPaidAmount = todayOrders.reduce(
      (sum, order) => sum + parseFloat(order.paidAmount),
      0
    );

    const totalCurrentOrderAmount = todayOrders.reduce(
      (sum, order) => sum + parseFloat(order.currentOrderAmount),
      0
    );

    const walkInAmount = todayOrders
      .filter(order => order.orderType === 'WALKIN')
      .reduce((sum, order) => sum + parseFloat(order.paidAmount), 0);

    const clearBillAmount = todayOrders
      .filter(order => order.orderType === 'CLEARBILL')
      .reduce((sum, order) => sum + parseFloat(order.paidAmount), 0);

    const enrouteAmount = todayOrders
      .filter(order => order.orderType === 'ENROUTE')
      .reduce((sum, order) => sum + parseFloat(order.paidAmount), 0);

    const balanceClearedToday = totalCurrentOrderAmount - totalPaidAmount;

    const totalBottles = todayOrders.reduce(
      (sum, order) => sum + order.numberOfBottles,
      0
    );

    const totalOrders = todayOrders.length;

    // Group by rider for collections with payment method breakdown
    const riderCollectionsMap = new Map();
    todayOrders.forEach(order => {
      if (!order.riderId) return; // Skip orders without riders
      if (riderCollectionsMap.has(order.riderId)) {
        const existing = riderCollectionsMap.get(order.riderId);
        existing.amount += parseFloat(order.paidAmount);
        existing.ordersCount += 1;
        
        // Track payment methods per rider
        const paymentMethod = order.paymentMethod || 'CASH';
        if (existing.paymentMethods.has(paymentMethod)) {
          const pmData = existing.paymentMethods.get(paymentMethod);
          pmData.amount += parseFloat(order.paidAmount);
          pmData.ordersCount += 1;
        } else {
          existing.paymentMethods.set(paymentMethod, {
            amount: parseFloat(order.paidAmount),
            ordersCount: 1
          });
        }
      } else {
        const paymentMethod = order.paymentMethod || 'CASH';
        const paymentMethodsMap = new Map();
        paymentMethodsMap.set(paymentMethod, {
          amount: parseFloat(order.paidAmount),
          ordersCount: 1
        });
        
        riderCollectionsMap.set(order.riderId, {
          amount: parseFloat(order.paidAmount),
          ordersCount: 1,
          paymentMethods: paymentMethodsMap
        });
      }
    });

    // Fetch rider names
    const riderIds = Array.from(riderCollectionsMap.keys());
    const riders = await prisma.riderProfile.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, name: true }
    });

    const ridersMap = new Map(riders.map(r => [r.id, r.name]));

    const riderCollections = Array.from(riderCollectionsMap.entries()).map(([riderId, data]) => ({
      riderId,
      riderName: ridersMap.get(riderId) || 'Unknown',
      amount: data.amount,
      ordersCount: data.ordersCount,
      paymentMethods: Array.from(data.paymentMethods.entries()).map(([method, pmData]) => ({
        method,
        amount: pmData.amount,
        ordersCount: pmData.ordersCount
      }))
    }));

    // Group by payment method (use CASH fallback for null/undefined)
    const paymentMethodsMap = new Map();
    todayOrders.forEach(order => {
      const method = order.paymentMethod || 'CASH';
      if (paymentMethodsMap.has(method)) {
        const existing = paymentMethodsMap.get(method);
        existing.amount += parseFloat(order.paidAmount);
        existing.ordersCount += 1;
      } else {
        paymentMethodsMap.set(method, {
          amount: parseFloat(order.paidAmount),
          ordersCount: 1
        });
      }
    });

    const paymentMethods = Array.from(paymentMethodsMap.entries()).map(([method, data]) => ({
      method,
      amount: data.amount,
      ordersCount: data.ordersCount
    }));

    // Check if closing already exists for today
    const existingClosing = await prisma.dailyClosing.findUnique({
      where: {
        date: new Date(todayPktDate + 'T00:00:00Z')
      }
    });

    res.json({
      success: true,
      data: {
        date: todayPktDate,
        customerPayable: Number(customerPayable) || 0,
        customerReceivable: Number(customerReceivable) || 0,
        totalPaidAmount: Number(totalPaidAmount) || 0,
        totalCurrentOrderAmount: Number(totalCurrentOrderAmount) || 0,
        walkInAmount: Number(walkInAmount) || 0,
        clearBillAmount: Number(clearBillAmount) || 0,
        enrouteAmount: Number(enrouteAmount) || 0,
        balanceClearedToday: Number(balanceClearedToday) || 0,
        totalBottles: Number(totalBottles) || 0,
        totalOrders: Number(totalOrders) || 0,
        riderCollections: Array.isArray(riderCollections) ? riderCollections : [],
        paymentMethods: Array.isArray(paymentMethods) ? paymentMethods : [],
        canClose: inProgressOrders === 0,
        inProgressOrdersCount: Number(inProgressOrders) || 0,
        alreadyExists: !!existingClosing
      }
    });
  } catch (error) {
    console.error('Error fetching daily closing summary:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily closing summary',
      error: error.message
    });
  }
};

// Create or update daily closing
export const saveDailyClosing = async (req, res) => {
  try {
    const todayPktDate = getTodayPktDate();
    const { start, end } = getPktDateRangeUtc(todayPktDate);

    // Check if orders are in progress (PENDING, ASSIGNED, IN_PROGRESS, CREATED)
    // These statuses indicate orders that are not completed and should block daily closing
    const inProgressOrders = await prisma.order.count({
      where: {
        status: {
          in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'CREATED']
        }
      }
    });

    if (inProgressOrders > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot close counter when there are ${inProgressOrders} order(s) in progress. Please complete all pending orders first.`,
        inProgressOrdersCount: inProgressOrders
      });
    }

    // Get all active customers
    const activeCustomers = await prisma.customer.findMany({
      where: {
        isActive: true
      },
      select: {
        currentBalance: true
      }
    });

    // Calculate customer payable (sum of negative balances)
    const customerPayable = activeCustomers
      .filter(c => parseFloat(c.currentBalance) < 0)
      .reduce((sum, c) => sum + Math.abs(parseFloat(c.currentBalance)), 0);

    // Calculate customer receivable (sum of positive balances)
    const customerReceivable = activeCustomers
      .filter(c => parseFloat(c.currentBalance) > 0)
      .reduce((sum, c) => sum + parseFloat(c.currentBalance), 0);

    // Get today's orders (excluding cancelled) with more details
    const todayOrders = await prisma.order.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end
        },
        status: {
          not: 'CANCELLED'
        }
      },
      select: {
        paidAmount: true,
        currentOrderAmount: true,
        numberOfBottles: true,
        riderId: true,
        paymentMethod: true,
        orderType: true
      }
    });

    // Calculate totals
    const totalPaidAmount = todayOrders.reduce(
      (sum, order) => sum + parseFloat(order.paidAmount),
      0
    );

    const totalCurrentOrderAmount = todayOrders.reduce(
      (sum, order) => sum + parseFloat(order.currentOrderAmount),
      0
    );

    const walkInAmount = todayOrders
      .filter(order => order.orderType === 'WALKIN')
      .reduce((sum, order) => sum + parseFloat(order.paidAmount), 0);

    const clearBillAmount = todayOrders
      .filter(order => order.orderType === 'CLEARBILL')
      .reduce((sum, order) => sum + parseFloat(order.paidAmount), 0);

    const enrouteAmount = todayOrders
      .filter(order => order.orderType === 'ENROUTE')
      .reduce((sum, order) => sum + parseFloat(order.paidAmount), 0);

    const balanceClearedToday = totalCurrentOrderAmount - totalPaidAmount;

    const totalBottles = todayOrders.reduce(
      (sum, order) => sum + order.numberOfBottles,
      0
    );

    const totalOrders = todayOrders.length;

    // Group by rider for collections with payment method breakdown
    const riderCollectionsMap = new Map();
    todayOrders.forEach(order => {
      if (!order.riderId) return; // Skip orders without riders
      if (riderCollectionsMap.has(order.riderId)) {
        const existing = riderCollectionsMap.get(order.riderId);
        existing.amount += parseFloat(order.paidAmount);
        existing.ordersCount += 1;
        
        // Track payment methods per rider
        const paymentMethod = order.paymentMethod || 'CASH';
        if (existing.paymentMethods.has(paymentMethod)) {
          const pmData = existing.paymentMethods.get(paymentMethod);
          pmData.amount += parseFloat(order.paidAmount);
          pmData.ordersCount += 1;
        } else {
          existing.paymentMethods.set(paymentMethod, {
            amount: parseFloat(order.paidAmount),
            ordersCount: 1
          });
        }
      } else {
        const paymentMethod = order.paymentMethod || 'CASH';
        const paymentMethodsMap = new Map();
        paymentMethodsMap.set(paymentMethod, {
          amount: parseFloat(order.paidAmount),
          ordersCount: 1
        });
        
        riderCollectionsMap.set(order.riderId, {
          amount: parseFloat(order.paidAmount),
          ordersCount: 1,
          paymentMethods: paymentMethodsMap
        });
      }
    });

    // Group by payment method (use CASH fallback for null/undefined)
    const paymentMethodsMap = new Map();
    todayOrders.forEach(order => {
      const method = order.paymentMethod || 'CASH';
      if (paymentMethodsMap.has(method)) {
        const existing = paymentMethodsMap.get(method);
        existing.amount += parseFloat(order.paidAmount);
        existing.ordersCount += 1;
      } else {
        paymentMethodsMap.set(method, {
          amount: parseFloat(order.paidAmount),
          ordersCount: 1
        });
      }
    });

    // Create or update the daily closing (use findUnique + create/update to avoid upsert quirks)
    const closingDate = new Date(todayPktDate + 'T00:00:00Z');
    const createData = {
      date: closingDate,
      customerPayable,
      customerReceivable,
      totalPaidAmount,
      totalCurrentOrderAmount,
      walkInAmount,
      clearBillAmount,
      enrouteAmount,
      balanceClearedToday,
      totalBottles,
      totalOrders
    };

    let dailyClosing;
    const existing = await prisma.dailyClosing.findUnique({
      where: { date: closingDate }
    });

    if (existing) {
      await prisma.dailyClosingRider.deleteMany({ where: { dailyClosingId: existing.id } });
      await prisma.dailyClosingPayment.deleteMany({ where: { dailyClosingId: existing.id } });
      dailyClosing = await prisma.dailyClosing.update({
        where: { id: existing.id },
        data: {
          customerPayable: createData.customerPayable,
          customerReceivable: createData.customerReceivable,
          totalPaidAmount: createData.totalPaidAmount,
          totalCurrentOrderAmount: createData.totalCurrentOrderAmount,
          walkInAmount: createData.walkInAmount,
          clearBillAmount: createData.clearBillAmount,
          enrouteAmount: createData.enrouteAmount,
          balanceClearedToday: createData.balanceClearedToday,
          totalBottles: createData.totalBottles,
          totalOrders: createData.totalOrders
        }
      });
    } else {
      dailyClosing = await prisma.dailyClosing.create({
        data: createData
      });
    }

    // Create rider collections with payment method breakdowns
    const riderCollectionsData = Array.from(riderCollectionsMap.entries()).map(([riderId, data]) => ({
      dailyClosingId: dailyClosing.id,
      riderId: riderId,
      amount: data.amount,
      ordersCount: data.ordersCount,
      paymentMethods: {
        create: Array.from(data.paymentMethods.entries()).map(([method, pmData]) => ({
          paymentMethod: method,
          amount: pmData.amount,
          ordersCount: pmData.ordersCount
        }))
      }
    }));

    if (riderCollectionsData.length > 0) {
      for (const riderData of riderCollectionsData) {
        await prisma.dailyClosingRider.create({
          data: riderData
        });
      }
    }

    // Create payment method breakdowns
    const paymentMethods = Array.from(paymentMethodsMap.entries()).map(([method, data]) => ({
      dailyClosingId: dailyClosing.id,
      paymentMethod: method,
      amount: data.amount,
      ordersCount: data.ordersCount
    }));

    if (paymentMethods.length > 0) {
      await prisma.dailyClosingPayment.createMany({
        data: paymentMethods
      });
    }

    // Fetch the complete closing with relations
    const completeClosing = await prisma.dailyClosing.findUnique({
      where: { id: dailyClosing.id },
      include: {
        riderCollections: {
          include: {
            rider: {
              select: { name: true }
            },
            paymentMethods: true
          }
        },
        paymentMethods: true
      }
    });

    res.json({
      success: true,
      message: 'Daily closing saved successfully',
      data: completeClosing
    });
  } catch (error) {
    console.error('Error saving daily closing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save daily closing',
      error: error.message
    });
  }
};

// Get all daily closings
export const getAllDailyClosings = async (req, res) => {
  try {
    const dailyClosings = await prisma.dailyClosing.findMany({
      orderBy: {
        date: 'desc'
      },
      include: {
        riderCollections: {
          include: {
            rider: {
              select: { name: true }
            },
            paymentMethods: true
          }
        },
        paymentMethods: true
      }
    });

    const formattedClosings = dailyClosings.map(closing => ({
      id: closing.id,
      date: formatPktDate(closing.date),
      customerPayable: parseFloat(closing.customerPayable) || 0,
      customerReceivable: parseFloat(closing.customerReceivable) || 0,
      totalPaidAmount: parseFloat(closing.totalPaidAmount) || 0,
      totalCurrentOrderAmount: parseFloat(closing.totalCurrentOrderAmount) || 0,
      walkInAmount: parseFloat(closing.walkInAmount) || 0,
      clearBillAmount: parseFloat(closing.clearBillAmount) || 0,
      enrouteAmount: parseFloat(closing.enrouteAmount) || 0,
      balanceClearedToday: parseFloat(closing.balanceClearedToday) || 0,
      totalBottles: Number(closing.totalBottles) || 0,
      totalOrders: Number(closing.totalOrders) || 0,
      riderCollections: (closing.riderCollections || []).map(rc => ({
        riderName: rc.rider?.name || 'Unknown',
        amount: parseFloat(rc.amount) || 0,
        ordersCount: Number(rc.ordersCount) || 0,
        paymentMethods: (rc.paymentMethods || []).map(pm => ({
          method: pm.paymentMethod,
          amount: parseFloat(pm.amount) || 0,
          ordersCount: Number(pm.ordersCount) || 0
        }))
      })),
      paymentMethods: (closing.paymentMethods || []).map(pm => ({
        method: pm.paymentMethod,
        amount: parseFloat(pm.amount) || 0,
        ordersCount: Number(pm.ordersCount) || 0
      })),
      createdAt: closing.createdAt,
      updatedAt: closing.updatedAt
    }));

    res.json({
      success: true,
      data: formattedClosings
    });
  } catch (error) {
    console.error('Error fetching daily closings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily closings',
      error: error.message
    });
  }
};

