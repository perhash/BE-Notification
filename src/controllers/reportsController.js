import { PrismaClient } from '@prisma/client';
import { getTodayPktUtcRange, getPktDayStartUtc, getPktDayEndUtc, formatPktDate, getPktDateRangeUtc } from '../utils/timezone.js';

const prisma = new PrismaClient();

// Helper function to calculate date ranges (using PKT timezone)
const getDateRange = (period) => {
  const todayRange = getTodayPktUtcRange();
  const PKT_OFFSET_HOURS = 5;
  const pktNow = new Date(Date.now() + (PKT_OFFSET_HOURS * 60 * 60 * 1000));
  
  switch (period) {
    case 'daily':
      return { startDate: todayRange.start, endDate: todayRange.end };
    
    case 'weekly':
      // Calculate week start in PKT
      const dayOfWeek = pktNow.getUTCDay(); // 0 = Sunday
      const weekStartDate = new Date(pktNow);
      weekStartDate.setUTCDate(pktNow.getUTCDate() - dayOfWeek);
      const weekStartStr = `${weekStartDate.getUTCFullYear()}-${String(weekStartDate.getUTCMonth() + 1).padStart(2, '0')}-${String(weekStartDate.getUTCDate()).padStart(2, '0')}`;
      const weekRange = getPktDateRangeUtc(weekStartStr);
      return { startDate: weekRange.start, endDate: todayRange.end };
    
    case 'monthly':
      // First day of current month in PKT
      const monthStartStr = `${pktNow.getUTCFullYear()}-${String(pktNow.getUTCMonth() + 1).padStart(2, '0')}-01`;
      const monthStartRange = getPktDayStartUtc(monthStartStr);
      return { startDate: monthStartRange, endDate: todayRange.end };
    
    case 'yearly':
      // First day of current year in PKT
      const yearStartStr = `${pktNow.getUTCFullYear()}-01-01`;
      const yearStartRange = getPktDayStartUtc(yearStartStr);
      return { startDate: yearStartRange, endDate: todayRange.end };
    
    case 'alltime':
    default:
      // For all time, go back 5 years in PKT
      const fiveYearsAgoStr = `${pktNow.getUTCFullYear() - 5}-01-01`;
      const fiveYearsAgoRange = getPktDayStartUtc(fiveYearsAgoStr);
      return { startDate: fiveYearsAgoRange, endDate: todayRange.end };
  }
};

// Get analytics data
export const getAnalytics = async (req, res) => {
  try {
    const { period = 'monthly', entity = 'all' } = req.query;
    const { startDate, endDate } = getDateRange(period);
    
    console.log('Analytics request:', { period, entity, startDate, endDate });
    
    const analytics = {};

    // Orders analytics
    if (entity === 'all' || entity === 'orders') {
      const orders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          customer: true,
          rider: true
        }
      });

      // Separate delivery and walk-in orders
      const deliveryOrders = orders.filter(o => o.orderType === 'DELIVERY');
      const walkInOrders = orders.filter(o => o.orderType === 'WALKIN');

      // Calculate delivery metrics
      const deliveredDeliveryOrders = deliveryOrders.filter(o => o.status === 'DELIVERED');
      const pendingDeliveryOrders = deliveryOrders.filter(o => 
        o.status !== 'DELIVERED' && o.status !== 'COMPLETED'
      );
      const deliveryRevenue = deliveryOrders.reduce((sum, o) => 
        sum + (parseFloat(o.totalAmount) || 0), 0
      );

      // Calculate walk-in metrics
      const completedWalkInOrders = walkInOrders.filter(o => o.status === 'COMPLETED');
      const walkInRevenue = walkInOrders.reduce((sum, o) => 
        sum + (parseFloat(o.totalAmount) || 0), 0
      );

      // Total revenue
      const totalRevenue = parseFloat(deliveryRevenue) + parseFloat(walkInRevenue);

      // Group by date for chart data (using PKT dates)
      const ordersByDate = {};
      orders.forEach(order => {
        const date = formatPktDate(order.createdAt);
        if (!ordersByDate[date]) {
          ordersByDate[date] = { 
            date, 
            orders: 0, 
            revenue: 0, 
            delivered: 0, 
            pending: 0,
            walkIn: 0,
            walkInRevenue: 0
          };
        }
        ordersByDate[date].orders++;
        const amount = parseFloat(order.totalAmount) || 0;
        ordersByDate[date].revenue += amount;
        
        if (order.orderType === 'WALKIN' && order.status === 'COMPLETED') {
          ordersByDate[date].walkIn++;
          ordersByDate[date].walkInRevenue += amount;
        } else if (order.orderType === 'DELIVERY') {
          if (order.status === 'DELIVERED') {
            ordersByDate[date].delivered++;
          } else if (order.status !== 'COMPLETED') {
            ordersByDate[date].pending++;
          }
        }
      });

      analytics.orders = {
        total: orders.length,
        delivery: {
          total: deliveryOrders.length,
          delivered: deliveredDeliveryOrders.length,
          pending: pendingDeliveryOrders.length,
          revenue: deliveryRevenue
        },
        walkIn: {
          total: walkInOrders.length,
          completed: completedWalkInOrders.length,
          revenue: walkInRevenue
        },
        totalRevenue: totalRevenue,
        delivered: deliveredDeliveryOrders.length,
        pending: pendingDeliveryOrders.length,
        chartData: Object.values(ordersByDate).sort((a, b) => a.date.localeCompare(b.date))
      };
    }

    // Customers analytics
    if (entity === 'all' || entity === 'customers') {
      // Get all customers, but filter their orders by date range
      const customers = await prisma.customer.findMany({
        include: {
          orders: {
            where: {
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            }
          }
        }
      });

      // Filter customers by date range only if entity is 'customers' (not 'all')
      const filteredCustomers = entity === 'customers' 
        ? customers.filter(c => c.createdAt >= startDate && c.createdAt <= endDate)
        : customers;

      // Group by date based on order creation dates, not customer creation dates (using PKT dates)
      const customersByDate = {};
      filteredCustomers.forEach(customer => {
        customer.orders.forEach(order => {
          const date = formatPktDate(order.createdAt);
          if (!customersByDate[date]) {
            customersByDate[date] = { date, customers: new Set(), active: 0, inactive: 0, orders: 0 };
          }
          customersByDate[date].customers.add(customer.id);
          customersByDate[date].orders++;
        });
      });

      // Convert Sets to counts
      const chartData = Object.keys(customersByDate).map(date => {
        const day = customersByDate[date];
        return {
          date,
          customers: day.customers.size,
          active: filteredCustomers.filter(c => c.isActive && Array.from(day.customers).includes(c.id)).length,
          inactive: day.customers.size - filteredCustomers.filter(c => c.isActive && Array.from(day.customers).includes(c.id)).length,
          orders: day.orders
        };
      }).sort((a, b) => a.date.localeCompare(b.date));

      analytics.customers = {
        total: filteredCustomers.length,
        active: filteredCustomers.filter(c => c.isActive).length,
        inactive: filteredCustomers.filter(c => !c.isActive).length,
        totalOrders: filteredCustomers.reduce((sum, c) => sum + c.orders.length, 0),
        chartData
      };
    }

    // Riders analytics
    if (entity === 'all' || entity === 'riders') {
      // Get all riders, but filter their orders by date range
      const riders = await prisma.riderProfile.findMany({
        include: {
          orders: {
            where: {
              createdAt: {
                gte: startDate,
                lte: endDate
              },
              status: 'DELIVERED'
            }
          }
        }
      });

      // Filter riders by date range only if entity is 'riders' (not 'all')
      const filteredRiders = entity === 'riders'
        ? riders.filter(r => r.createdAt >= startDate && r.createdAt <= endDate)
        : riders;

      // Group by date based on order creation dates (using PKT dates)
      const ridersByDate = {};
      filteredRiders.forEach(rider => {
        rider.orders.forEach(order => {
          const date = formatPktDate(order.createdAt);
          if (!ridersByDate[date]) {
            ridersByDate[date] = { date, riders: new Set(), active: 0, inactive: 0, deliveries: 0, revenue: 0 };
          }
          ridersByDate[date].riders.add(rider.id);
          ridersByDate[date].deliveries++;
          ridersByDate[date].revenue += parseFloat(order.totalAmount) || 0;
        });
      });

      // Convert Sets to counts
      const chartData = Object.keys(ridersByDate).map(date => {
        const day = ridersByDate[date];
        return {
          date,
          riders: day.riders.size,
          active: filteredRiders.filter(r => r.isActive && Array.from(day.riders).includes(r.id)).length,
          inactive: day.riders.size - filteredRiders.filter(r => r.isActive && Array.from(day.riders).includes(r.id)).length,
          deliveries: day.deliveries,
          revenue: day.revenue
        };
      }).sort((a, b) => a.date.localeCompare(b.date));

      analytics.riders = {
        total: filteredRiders.length,
        active: filteredRiders.filter(r => r.isActive).length,
        inactive: filteredRiders.filter(r => !r.isActive).length,
        totalDeliveries: filteredRiders.reduce((sum, r) => sum + r.orders.length, 0),
        totalRevenue: filteredRiders.reduce((sum, r) => sum + r.orders.reduce((s, o) => s + (parseFloat(o.totalAmount) || 0), 0), 0),
        chartData
      };
    }

    res.json({
      success: true,
      data: analytics,
      period,
      dateRange: { startDate, endDate }
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics',
      error: error.message
    });
  }
};

// Get report data for download
export const getReportData = async (req, res) => {
  try {
    const { period = 'monthly', type = 'orders', startDate: customStart, endDate: customEnd } = req.query;
    
    let startDate, endDate;
    if (customStart && customEnd) {
      // Convert custom dates from PKT to UTC ranges
      startDate = getPktDayStartUtc(customStart);
      endDate = getPktDayEndUtc(customEnd);
    } else {
      const range = getDateRange(period);
      startDate = range.startDate;
      endDate = range.endDate;
    }

    let reportData = [];

    if (type === 'orders') {
      const orders = await prisma.order.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          customer: {
            select: { name: true, phone: true }
          },
          rider: {
            select: { name: true, phone: true }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      reportData = orders.map(order => ({
        id: order.id,
        date: order.createdAt,
        customer: order.customer?.name || 'Walk-in Customer',
        phone: order.customer?.phone || 'N/A',
        rider: order.rider?.name || (order.orderType === 'WALKIN' ? 'N/A' : 'Not assigned'),
        bottles: order.numberOfBottles,
        amount: parseFloat(order.totalAmount) || 0,
        status: order.status,
        paymentStatus: order.paymentStatus,
        orderType: order.orderType
      }));
    } else if (type === 'customers') {
      const customers = await prisma.customer.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          _count: {
            select: { orders: true }
          },
          orders: {
            where: {
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            },
            select: {
              totalAmount: true,
              status: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      reportData = customers.map(customer => {
        const totalOrders = customer.orders.length;
        const totalRevenue = customer.orders.reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0);
        const deliveredOrders = customer.orders.filter(o => o.status === 'DELIVERED').length;

        return {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          address: `${customer.houseNo || ''} ${customer.streetNo || ''} ${customer.area || ''} ${customer.city || ''}`.trim(),
          joinedDate: customer.createdAt,
          status: customer.isActive ? 'Active' : 'Inactive',
          totalOrders,
          deliveredOrders,
          totalRevenue
        };
      });
    } else if (type === 'riders') {
      const riders = await prisma.riderProfile.findMany({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        include: {
          orders: {
            where: {
              createdAt: {
                gte: startDate,
                lte: endDate
              }
            },
            select: {
              totalAmount: true,
              status: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      reportData = riders.map(rider => {
        const deliveryOrders = rider.orders.filter(o => o.orderType === 'DELIVERY');
        const totalDeliveries = deliveryOrders.filter(o => o.status === 'DELIVERED').length;
        const totalRevenue = deliveryOrders
          .filter(o => o.status === 'DELIVERED')
          .reduce((sum, o) => sum + (parseFloat(o.totalAmount) || 0), 0);
        const pendingDeliveries = deliveryOrders.filter(o => 
          o.status !== 'DELIVERED' && o.status !== 'COMPLETED'
        ).length;

        return {
          id: rider.id,
          name: rider.name,
          phone: rider.phone,
          joinedDate: rider.createdAt,
          status: rider.isActive ? 'Active' : 'Inactive',
          totalDeliveries,
          pendingDeliveries,
          totalRevenue
        };
      });
    }

    res.json({
      success: true,
      data: reportData,
      period,
      type,
      dateRange: { startDate, endDate },
      count: reportData.length
    });
  } catch (error) {
    console.error('Error fetching report data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch report data',
      error: error.message
    });
  }
};

