import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

// Get admin profile
export const getAdminProfile = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get user with admin profile
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        adminProfile: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Return admin profile data
    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        name: user.adminProfile?.name || '',
        role: user.role
      }
    });

  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin profile',
      error: error.message
    });
  }
};

// Update admin profile (name and phone)
export const updateAdminProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { name, phone } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        adminProfile: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update user phone if provided
    const updateData = {};
    if (phone !== undefined) {
      // Check if phone is already taken by another user
      if (phone) {
        const existingUser = await prisma.user.findFirst({
          where: {
            phone: phone,
            id: { not: userId }
          }
        });

        if (existingUser) {
          return res.status(400).json({
            success: false,
            message: 'Phone number already in use'
          });
        }
      }
      updateData.phone = phone;
    }

    // Update user
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: updateData
      });
    }

    // Update or create admin profile
    if (name !== undefined) {
      if (user.adminProfile) {
        // Update existing profile
        await prisma.adminProfile.update({
          where: { userId: userId },
          data: { name }
        });
      } else {
        // Create new profile
        await prisma.adminProfile.create({
          data: {
            userId: userId,
            name
          }
        });
      }
    }

    // Get updated user data
    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        adminProfile: true
      }
    });

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        id: updatedUser.id,
        email: updatedUser.email,
        phone: updatedUser.phone,
        name: updatedUser.adminProfile?.name || '',
        role: updatedUser.role
      }
    });

  } catch (error) {
    console.error('Update admin profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update admin profile',
      error: error.message
    });
  }
};

// Update admin password
export const updateAdminPassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    // Validate required fields
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Validate new password length
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword }
    });

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('Password update error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update password',
      error: error.message
    });
  }
};

