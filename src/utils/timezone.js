/**
 * Timezone utility for PKT (Pakistan Time, UTC+5)
 * Converts PKT dates to UTC date ranges for database queries
 */

// PKT is UTC+5
const PKT_OFFSET_HOURS = 5;

/**
 * Get the start of day in PKT, converted to UTC
 * @param {Date|string} date - Date object or date string (YYYY-MM-DD format)
 * @returns {Date} Start of day in PKT, as a UTC Date object
 */
export function getPktDayStartUtc(date) {
  let dateObj;
  
  if (typeof date === 'string') {
    // Parse date string (assuming YYYY-MM-DD format)
    const [year, month, day] = date.split('-').map(Number);
    // Create date at midnight in PKT (which is 5 hours behind UTC)
    // If we want Oct 31 00:00 PKT, that's Oct 30 19:00 UTC
    dateObj = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
    // Subtract 5 hours to account for PKT being UTC+5
    dateObj.setUTCHours(dateObj.getUTCHours() - PKT_OFFSET_HOURS);
  } else {
    // Use provided date, but ensure we're working with the date part only
    dateObj = new Date(date);
    dateObj.setUTCHours(0, 0, 0, 0);
    dateObj.setUTCHours(dateObj.getUTCHours() - PKT_OFFSET_HOURS);
  }
  
  return dateObj;
}

/**
 * Get the end of day in PKT, converted to UTC
 * @param {Date|string} date - Date object or date string (YYYY-MM-DD format)
 * @returns {Date} End of day in PKT (just before next day), as a UTC Date object
 */
export function getPktDayEndUtc(date) {
  let dateObj;
  
  if (typeof date === 'string') {
    const [year, month, day] = date.split('-').map(Number);
    // Create date at end of day in PKT
    // Oct 31 23:59:59.999 PKT = Oct 31 23:59:59.999 UTC - 5 hours = Oct 31 18:59:59.999 UTC
    // But we want to include everything up to just before the next day starts
    // So we create the next day at 00:00:00 PKT, which is Oct 31 19:00:00 UTC
    // Then subtract 1 millisecond to get the end of the current day
    const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
    nextDay.setUTCHours(nextDay.getUTCHours() - PKT_OFFSET_HOURS);
    dateObj = new Date(nextDay.getTime() - 1); // 1 millisecond before next day starts
  } else {
    dateObj = new Date(date);
    const year = dateObj.getUTCFullYear();
    const month = dateObj.getUTCMonth();
    const day = dateObj.getUTCDate();
    const nextDay = new Date(Date.UTC(year, month, day + 1, 0, 0, 0, 0));
    nextDay.setUTCHours(nextDay.getUTCHours() - PKT_OFFSET_HOURS);
    dateObj = new Date(nextDay.getTime() - 1);
  }
  
  return dateObj;
}

/**
 * Get today's date range in PKT, converted to UTC
 * @returns {Object} Object with { start, end } Date objects in UTC
 */
export function getTodayPktUtcRange() {
  const now = new Date();
  
  // Get current date in PKT (add 5 hours to current UTC time to get PKT time)
  const pktNow = new Date(now.getTime() + (PKT_OFFSET_HOURS * 60 * 60 * 1000));
  
  // Get date string in PKT timezone (YYYY-MM-DD)
  const year = pktNow.getUTCFullYear();
  const month = String(pktNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(pktNow.getUTCDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  return {
    start: getPktDayStartUtc(dateStr),
    end: getPktDayEndUtc(dateStr)
  };
}

/**
 * Get date range for a specific date in PKT, converted to UTC
 * @param {Date|string} date - Date object or date string (YYYY-MM-DD format)
 * @returns {Object} Object with { start, end } Date objects in UTC
 */
export function getPktDateRangeUtc(date) {
  const dateStr = typeof date === 'string' ? date : date.toISOString().split('T')[0];
  return {
    start: getPktDayStartUtc(dateStr),
    end: getPktDayEndUtc(dateStr)
  };
}

/**
 * Format a UTC date to PKT date string (YYYY-MM-DD)
 * @param {Date} utcDate - UTC Date object
 * @returns {string} Date string in YYYY-MM-DD format (as it would appear in PKT)
 */
export function formatPktDate(utcDate) {
  const pktDate = new Date(utcDate.getTime() + (PKT_OFFSET_HOURS * 60 * 60 * 1000));
  const year = pktDate.getUTCFullYear();
  const month = String(pktDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(pktDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date string in PKT (YYYY-MM-DD)
 * @returns {string} Today's date in YYYY-MM-DD format
 */
export function getTodayPktDate() {
  const now = new Date();
  const pktNow = new Date(now.getTime() + (PKT_OFFSET_HOURS * 60 * 60 * 1000));
  const year = pktNow.getUTCFullYear();
  const month = String(pktNow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(pktNow.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

