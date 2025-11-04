import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

// Get company setup
export const getCompanySetup = async (req, res) => {
  try {
    // Get first company setup (assuming single company setup for now)
    const companySetup = await prisma.company_setups.findFirst({
      include: {
        bottle_categories: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    if (!companySetup) {
      return res.json({
        success: true,
        data: null
      });
    }

    res.json({
      success: true,
      data: companySetup
    });

  } catch (error) {
    console.error('Get company setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch company setup',
      error: error.message
    });
  }
};

// Create company setup
export const createCompanySetup = async (req, res) => {
  try {
    const { agencyName, agencyAddress, agencyPhoneNumber, agencyLogo, areasOperated } = req.body;

    // Validate required fields
    if (!agencyName || !agencyAddress || !agencyPhoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Agency name, address, and phone number are required'
      });
    }

    // Validate areasOperated
    if (!areasOperated || !Array.isArray(areasOperated) || areasOperated.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one area must be specified'
      });
    }

    // Check if company setup already exists
    const existing = await prisma.company_setups.findFirst();
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Company setup already exists. Use update endpoint instead.'
      });
    }

    // Create company setup
    const companySetup = await prisma.company_setups.create({
      data: {
        id: randomUUID(),
        agencyName,
        agencyAddress,
        agencyPhoneNumber,
        agencyLogo: agencyLogo || '',
        areasOperated: areasOperated, // Store as JSON
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });

    res.status(201).json({
      success: true,
      message: 'Company setup created successfully',
      data: companySetup
    });

  } catch (error) {
    console.error('Create company setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create company setup',
      error: error.message
    });
  }
};

// Update company setup
export const updateCompanySetup = async (req, res) => {
  try {
    const { id } = req.params;
    const { agencyName, agencyAddress, agencyPhoneNumber, agencyLogo, areasOperated } = req.body;

    // Check if company setup exists
    const existing = await prisma.company_setups.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Company setup not found'
      });
    }

    // Build update data
    const updateData = {
      updatedAt: new Date()
    };

    if (agencyName !== undefined) updateData.agencyName = agencyName;
    if (agencyAddress !== undefined) updateData.agencyAddress = agencyAddress;
    if (agencyPhoneNumber !== undefined) updateData.agencyPhoneNumber = agencyPhoneNumber;
    if (agencyLogo !== undefined) updateData.agencyLogo = agencyLogo;
    if (areasOperated !== undefined) {
      if (!Array.isArray(areasOperated) || areasOperated.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one area must be specified'
        });
      }
      updateData.areasOperated = areasOperated;
    }

    // Update company setup
    const updated = await prisma.company_setups.update({
      where: { id },
      data: updateData,
      include: {
        bottle_categories: {
          orderBy: {
            createdAt: 'desc'
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Company setup updated successfully',
      data: updated
    });

  } catch (error) {
    console.error('Update company setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update company setup',
      error: error.message
    });
  }
};


