// Centralized error handling middleware for database operations

export const handleDatabaseError = (error, req, res, next) => {
  console.error('Database Error:', error);
  console.error('Error Code:', error.code);
  console.error('Error Message:', error.message);

  // Prisma unique constraint violation
  if (error.code === 'P2002') {
    const field = error.meta?.target?.[0] || 'field';
    const fieldName = getFieldDisplayName(field);
    
    return res.status(400).json({
      success: false,
      message: `Client with this ${fieldName} already exists`,
      error: 'DUPLICATE_ENTRY',
      details: {
        field,
        value: req.body[field],
        constraint: error.meta?.target
      }
    });
  }

  // Prisma record not found
  if (error.code === 'P2025') {
    return res.status(404).json({
      success: false,
      message: 'Record not found',
      error: 'NOT_FOUND',
      details: {
        code: error.code,
        message: error.message
      }
    });
  }

  // Prisma foreign key constraint
  if (error.code === 'P2003') {
    return res.status(400).json({
      success: false,
      message: 'Invalid reference to related record',
      error: 'FOREIGN_KEY_CONSTRAINT',
      details: {
        code: error.code,
        message: error.message
      }
    });
  }

  // Other Prisma errors
  if (error.code && error.code.startsWith('P')) {
    return res.status(400).json({
      success: false,
      message: error.message || 'Database validation error',
      error: 'DATABASE_ERROR',
      details: {
        code: error.code,
        message: error.message
      }
    });
  }

  // Validation errors
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: error.message || 'Validation error',
      error: 'VALIDATION_ERROR',
      details: {
        message: error.message
      }
    });
  }

  // Default error
  return res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: error.message
  });
};

// Helper function to get user-friendly field names
const getFieldDisplayName = (field) => {
  const fieldMap = {
    'phone': 'phone number',
    'whatsapp': 'WhatsApp number',
    'email': 'email address',
    'name': 'name'
  };
  
  return fieldMap[field] || field;
};
