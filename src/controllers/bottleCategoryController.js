import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// Get bottle categories
export const getBottleCategories = async (req, res) => {
  try {
    const { companySetupId } = req.query;

    if (!companySetupId) {
      return res.status(400).json({
        success: false,
        message: 'Company setup ID is required'
      });
    }

    // Check if company setup exists
    const companySetup = await prisma.company_setups.findUnique({
      where: { id: companySetupId }
    });

    if (!companySetup) {
      return res.status(404).json({
        success: false,
        message: 'Company setup not found'
      });
    }

    // Get bottle categories
    const categories = await prisma.bottle_categories.findMany({
      where: {
        companySetupId: companySetupId
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json({
      success: true,
      data: categories
    });

  } catch (error) {
    console.error('Get bottle categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bottle categories',
      error: error.message
    });
  }
};

// Create bottle category
export const createBottleCategory = async (req, res) => {
  try {
    const { categoryName, price, companySetupId } = req.body;

    // Validate required fields
    if (!categoryName || price === undefined || !companySetupId) {
      return res.status(400).json({
        success: false,
        message: 'Category name, price, and company setup ID are required'
      });
    }

    // Validate price
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      return res.status(400).json({
        success: false,
        message: 'Price must be a valid positive number'
      });
    }

    // Check if company setup exists
    const companySetup = await prisma.company_setups.findUnique({
      where: { id: companySetupId }
    });

    if (!companySetup) {
      return res.status(404).json({
        success: false,
        message: 'Company setup not found'
      });
    }

    // Create bottle category
    const category = await prisma.bottle_categories.create({
      data: {
        id: randomUUID(),
        categoryName,
        price: priceNum,
        companySetupId,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    res.status(201).json({
      success: true,
      message: 'Bottle category created successfully',
      data: category
    });

  } catch (error) {
    console.error('Create bottle category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bottle category',
      error: error.message
    });
  }
};

// Update bottle category
export const updateBottleCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryName, price } = req.body;

    // Check if category exists
    const existing = await prisma.bottle_categories.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Bottle category not found'
      });
    }

    // Build update data
    const updateData = {
      updatedAt: new Date()
    };

    if (categoryName !== undefined) updateData.categoryName = categoryName;
    if (price !== undefined) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum < 0) {
        return res.status(400).json({
          success: false,
          message: 'Price must be a valid positive number'
        });
      }
      updateData.price = priceNum;
    }

    // Update category
    const updated = await prisma.bottle_categories.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      message: 'Bottle category updated successfully',
      data: updated
    });

  } catch (error) {
    console.error('Update bottle category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bottle category',
      error: error.message
    });
  }
};

// Delete bottle category
export const deleteBottleCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category exists
    const existing = await prisma.bottle_categories.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Bottle category not found'
      });
    }

    // Delete category
    await prisma.bottle_categories.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: 'Bottle category deleted successfully'
    });

  } catch (error) {
    console.error('Delete bottle category error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bottle category',
      error: error.message
    });
  }
};

