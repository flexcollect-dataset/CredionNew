const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User, RefreshToken, PasswordResetToken } = require('../models');
const { Op } = require('sequelize');

// JWT Secret (should be in environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Frontend URLs
const FRONTEND_BASE_URL = (process.env.FRONTEND_APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
const LOGIN_REDIRECT_URL =
    process.env.FRONTEND_LOGIN_URL ||
    (FRONTEND_BASE_URL ? `${FRONTEND_BASE_URL}/login` : '/');
const SIGNUP_REDIRECT_URL =
    process.env.FRONTEND_SIGNUP_URL ||
    (FRONTEND_BASE_URL ? `${FRONTEND_BASE_URL}/signup` : '/');

// Middleware for JWT verification (API routes)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'ACCESS_DENIED', message: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'INVALID_TOKEN', message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Middleware for session-based authentication (Page routes)
const authenticateSession = async (req, res, next) => {
    try {
        if (!req.session || !req.session.userId) {
            return res.redirect('/auth/login');
        }
        
        // Get user details
        const user = await User.findByPk(req.session.userId, {
            attributes: ['userId', 'firstName', 'lastName', 'email', 'isActive']
        });
        
        if (!user || !user.isActive) {
            req.session.destroy();
            return res.redirect('/auth/login');
        }
        
        req.user = {
            userId: user.userId,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName
        };
        
        next();
    } catch (error) {
        console.error('Session authentication error:', error);
        req.session.destroy();
        res.redirect('/auth/login');
    }
};

// Validation middleware
const loginValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email address'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long')
];

const signupValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email address'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
    body('firstName')
        .trim()
        .isLength({ min: 2 })
        .withMessage('First name must be at least 2 characters long'),
    body('lastName')
        .trim()
        .isLength({ min: 2 })
        .withMessage('Last name must be at least 2 characters long'),
    body('mobileNumber')
        .isLength({ min: 10, max: 15 })
        .withMessage('Mobile number must be between 10 and 15 digits')
        .matches(/^\d+$/)
        .withMessage('Mobile number must contain only digits'),
    body('agreeTerms')
        .equals('true')
        .withMessage('You must agree to the Terms of Service'),
    body('currentPlan')
        .isIn(['pay_as_you_go', 'monthly'])
        .withMessage('Please select a valid plan')
];

// Helper function to generate JWT token
const generateToken = (userId, email) => {
    return jwt.sign(
        { userId, email },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// Helper function to generate refresh token
const generateRefreshToken = (userId) => {
    return jwt.sign(
        { userId, type: 'refresh' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
};

// Helper function to hash password
const hashPassword = async (password) => {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
};

// ============================================
// AUTHENTICATION ROUTES
// ============================================

// POST /auth/signup - Register a new user
router.post('/signup', signupValidation, async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                error: 'VALIDATION_ERROR',
                message: errors.array()[0].msg,
                errors: errors.array()
            });
        }

        const { email, password, firstName, lastName, mobileNumber, currentPlan } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({
            where: {
                [Op.or]: [
                    { email: email.toLowerCase() },
                    { mobileNumber: mobileNumber }
                ]
            }
        });

        if (existingUser) {
            if (existingUser.email === email.toLowerCase()) {
                return res.status(400).json({ 
                    error: 'EMAIL_EXISTS',
                    message: 'An account with this email already exists'
                });
            }
            if (existingUser.mobileNumber === mobileNumber) {
                return res.status(400).json({ 
                    error: 'MOBILE_EXISTS',
                    message: 'An account with this mobile number already exists'
                });
            }
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Create new user
        const newUser = await User.create({
            firstName,
            lastName,
            email: email.toLowerCase(),
            mobileNumber,
            password: hashedPassword,
            currentPlan: currentPlan || 'pay_as_you_go',
            isEmailVerified: true, // Auto-verify for testing
            isActive: true
        });

        // Generate tokens
        const accessToken = generateToken(newUser.userId, newUser.email);
        const refreshToken = generateRefreshToken(newUser.userId);

        // Store refresh token
        await RefreshToken.create({
            userId: newUser.userId,
            token: refreshToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        // Set session
        req.session.userId = newUser.userId;
        req.session.email = newUser.email;

        // Determine redirect URL based on plan
        const redirectUrl = currentPlan === 'pay_as_you_go' ? '/card-details' : '/search';

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: {
                userId: newUser.userId,
                email: newUser.email,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                mobileNumber: newUser.mobileNumber,
                currentPlan: newUser.currentPlan
            },
            accessToken,
            refreshToken,
            redirectUrl
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: 'An error occurred during registration'
        });
    }
});

// POST /auth/login - Login user
router.post('/login', loginValidation, async (req, res) => {
    try {
        // Validate input
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ 
                error: 'VALIDATION_ERROR',
                message: errors.array()[0].msg,
                errors: errors.array()
            });
        }

        const { email, password, rememberMe } = req.body;

        // Find user
        const user = await User.findOne({
            where: { email: email.toLowerCase() }
        });

        if (!user) {
            return res.status(401).json({ 
                error: 'INVALID_CREDENTIALS',
                message: 'Invalid email or password'
            });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ 
                error: 'INVALID_CREDENTIALS',
                message: 'Invalid email or password'
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(403).json({ 
                error: 'ACCOUNT_DISABLED',
                message: 'Your account has been disabled'
            });
        }

        // Update last login
        await user.update({ lastLogin: new Date() });

        // Generate tokens
        const accessToken = generateToken(user.userId, user.email);
        const refreshToken = generateRefreshToken(user.userId);

        // Store refresh token
        await RefreshToken.create({
            userId: user.userId,
            token: refreshToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        // Set session with remember me functionality
        req.session.userId = user.userId;
        req.session.email = user.email;
        
        // Configure session cookie based on remember me preference
        if (rememberMe === true || rememberMe === 'true') {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        } else {
            req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
        }

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                userId: user.userId,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                mobileNumber: user.mobileNumber
            },
            accessToken,
            refreshToken,
            redirectUrl: '/search'
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: 'An error occurred during login'
        });
    }
});

// POST /auth/logout - Logout user
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Delete all refresh tokens for this user
        await RefreshToken.destroy({
            where: { userId }
        });

        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
        });

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: 'An error occurred during logout'
        });
    }
});

// GET /auth/logout - Logout user (redirect to login)
router.get('/logout', async (req, res) => {
    try {
        // Delete all refresh tokens for this user if available
        if (req.session && req.session.userId) {
            await RefreshToken.destroy({
                where: { userId: req.session.userId }
            });
        }

        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
        });

        // Redirect to login page
        res.redirect('/auth/login');
    } catch (error) {
        console.error('Logout error:', error);
        res.redirect('/auth/login');
    }
});

// POST /auth/check-email - Check if email exists
router.post('/check-email', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                error: 'VALIDATION_ERROR',
                message: 'Email is required'
            });
        }

        const user = await User.findOne({
            where: { email: email.toLowerCase() }
        });

        res.json({
            exists: !!user
        });
    } catch (error) {
        console.error('Check email error:', error);
        res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: 'An error occurred while checking email'
        });
    }
});

// POST /auth/check-mobile - Check if mobile number exists
router.post('/check-mobile', async (req, res) => {
    try {
        const { mobileNumber } = req.body;
        
        if (!mobileNumber) {
            return res.status(400).json({ 
                error: 'VALIDATION_ERROR',
                message: 'Mobile number is required'
            });
        }

        // Validate mobile number format
        if (!/^\d{10,15}$/.test(mobileNumber)) {
            return res.json({
                exists: false
            });
        }

        const user = await User.findOne({
            where: { mobileNumber }
        });

        res.json({
            exists: !!user
        });
    } catch (error) {
        console.error('Check mobile error:', error);
        res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: 'An error occurred while checking mobile number'
        });
    }
});

// ============================================
// ADMIN/DEBUG ROUTES
// ============================================

// GET /auth/users - List all users (for testing)
router.get('/users', async (req, res) => {
    try {
        const users = await User.findAll({
            attributes: ['userId', 'firstName', 'lastName', 'email', 'mobileNumber', 'currentPlan', 'isEmailVerified', 'isActive', 'created_at', 'lastLogin'],
            order: [['userId', 'ASC']]
        });

        res.json({
            success: true,
            count: users.length,
            users: users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ 
            error: 'INTERNAL_ERROR',
            message: 'An error occurred while fetching users'
        });
    }
});

// ============================================
// PAGE ROUTES
// ============================================

// GET /auth/login - Redirect to frontend login
router.get('/login', (req, res) => {
    res.redirect(LOGIN_REDIRECT_URL);
});

// GET /auth/signup - Redirect to frontend signup
router.get('/signup', (req, res) => {
    res.redirect(SIGNUP_REDIRECT_URL);
});


module.exports = router;