/**
 * Mind Map Route (DATABASE VERSION)
 * API endpoint to generate mind map data from PostgreSQL database
 * NO PDF PARSING - Direct database queries for fast, reliable data
 * 
 * Location: backend/routes/mindMap.routes.js
 * 
 * Add to app.js:
 * const mindMapRoutes = require('./routes/mindMap.routes');
 * app.use('/api/matters', mindMapRoutes);
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { Matter } = require('../models');
const { buildMindMapFromDatabase } = require('../services/mindMapBuilder.service');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to check if user is authenticated (JWT)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'UNAUTHORIZED',
            message: 'Please log in to continue' 
        });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ 
                success: false, 
                error: 'INVALID_TOKEN',
                message: 'Invalid or expired token' 
            });
        }
        req.user = decoded;
        req.userId = decoded.userId;
        next();
    });
};

/**
 * GET /api/matters/:matterId/mind-map
 * Generate mind map data directly from database (NO PDF PARSING!)
 * MUCH FASTER: ~2-5 seconds vs 30-60 seconds with PDF parsing
 */
router.get('/:matterId/mind-map', authenticateToken, async (req, res) => {
    try {
        const { matterId } = req.params;
        const userId = req.userId;

        // Verify matter belongs to user
        const matter = await Matter.findOne({
            where: { 
                matterId: matterId,
                userId: userId 
            }
        });

        if (!matter) {
            return res.status(404).json({
                success: false,
                error: 'MATTER_NOT_FOUND',
                message: 'Matter not found'
            });
        }
        const startTime = Date.now();

        // Build mind map directly from database - NO PDF PARSING!
        const mindMapData = await buildMindMapFromDatabase(matterId, userId);

        const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);

        // Check if no data found
        if (mindMapData.stats.totalCompanies === 0) {
            return res.json({
                success: true,
                message: 'No ASIC reports with data found for this matter',
                data: mindMapData,
                matterId: parseInt(matterId),
                matterName: matter.matterName,
                reportCount: 0,
                processingTimeSeconds: processingTime
            });
        }

        res.json({
            success: true,
            message: 'Mind map generated successfully from database',
            data: mindMapData,
            matterId: parseInt(matterId),
            matterName: matter.matterName,
            reportCount: mindMapData.stats.totalCompanies, // Approximation
            processingTimeSeconds: processingTime,
            method: 'database' // Indicates this is the fast database method
        });

    } catch (error) {
        console.error('[Mind Map] Error generating mind map:', error);
        res.status(500).json({
            success: false,
            error: 'MIND_MAP_GENERATION_FAILED',
            message: error.message || 'Failed to generate mind map'
        });
    }
});

/**
 * GET /api/matters/:matterId/mind-map/status
 * Check if mind map data is available for a matter
 */
router.get('/:matterId/mind-map/status', authenticateToken, async (req, res) => {
    try {
        const { matterId } = req.params;
        const userId = req.userId;

        const { sequelize } = require('../config/db');

        // Count ASIC reports for this matter
        const result = await sequelize.query(`
            SELECT COUNT(*) as count
            FROM user_reports ur
            JOIN api_data ad ON ur.report_id = ad.id
            WHERE ur.matter_id = :matterId 
              AND ur.user_id = :userId
              AND (ad.rtype = 'asic-current' OR ad.rtype LIKE '%asic%')
        `, {
            replacements: { matterId, userId },
            type: sequelize.QueryTypes.SELECT
        });

        const reportCount = parseInt(result[0].count);

        res.json({
            success: true,
            available: reportCount > 0,
            reportCount: reportCount,
            message: reportCount > 0 
                ? `Mind map available with ${reportCount} ASIC reports`
                : 'No ASIC reports found for this matter'
        });

    } catch (error) {
        console.error('[Mind Map] Error checking status:', error);
        res.status(500).json({
            success: false,
            error: 'STATUS_CHECK_FAILED',
            message: error.message
        });
    }
});

module.exports = router;
