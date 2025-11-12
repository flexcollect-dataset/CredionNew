const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

// Local development configuration
const JWT_SECRET = 'credion-local-dev-secret-key';
const LOCAL_USERS = new Map(); // In-memory storage for local development
const FRONTEND_BASE_URL = (process.env.FRONTEND_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const LOGIN_REDIRECT_URL =
    process.env.FRONTEND_LOGIN_URL ||
    `${FRONTEND_BASE_URL}/login`;
const SIGNUP_REDIRECT_URL =
    process.env.FRONTEND_SIGNUP_URL ||
    `${FRONTEND_BASE_URL}/signup`;

// Middleware for JWT verification
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
        .isMobilePhone()
        .withMessage('Please provide a valid mobile number')
];

// Helper function to generate JWT token
const generateToken = (userId, email) => {
    return jwt.sign(
        { userId, email },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
};

// Helper function to hash password
const hashPassword = async (password) => {
    const saltRounds = 12;
    return await bcrypt.hash(password, saltRounds);
};

// Helper function to verify password
const verifyPassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};

// GET /auth/login - Redirect to frontend login
router.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect(`${FRONTEND_BASE_URL}/dashboard`);
    }

    res.redirect(LOGIN_REDIRECT_URL);
});

// POST /auth/login - Handle login
router.post('/login', loginValidation, async (req, res) => {
    try {
        // Check validation errors
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                fieldErrors: errors.mapped()
            });
        }

        const { email, password, rememberMe } = req.body;

        // Check if user exists in local storage
        const user = LOCAL_USERS.get(email);
        
        if (!user) {
            return res.status(401).json({
                error: 'INVALID_CREDENTIALS',
                message: 'Invalid email or password'
            });
        }

        // Check if account is locked
        if (user.isLocked) {
            return res.status(423).json({
                error: 'ACCOUNT_LOCKED',
                message: 'Your account has been temporarily locked. Please contact support.'
            });
        }

        // Verify password
        const isPasswordValid = await verifyPassword(password, user.password);
        if (!isPasswordValid) {
            // Increment failed login attempts
            user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
            if (user.failedLoginAttempts >= 5) {
                user.isLocked = true;
            }
            LOCAL_USERS.set(email, user);
            
            return res.status(401).json({
                error: 'INVALID_CREDENTIALS',
                message: 'Invalid email or password'
            });
        }

        // Reset failed login attempts on successful login
        user.failedLoginAttempts = 0;
        user.lastLoginAt = new Date().toISOString();
        LOCAL_USERS.set(email, user);

        // Generate token
        const accessToken = generateToken(user.userId, user.email);

        // Set session
        req.session.userId = user.userId;
        req.session.email = user.email;
        req.session.isAuthenticated = true;

        // Set remember me cookie if requested
        if (rememberMe) {
            res.cookie('rememberMe', 'true', {
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
                httpOnly: true,
                secure: false // false for local development
            });
        }

        res.json({
            success: true,
            message: 'Login successful',
            user: {
                userId: user.userId,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName
            },
            accessToken,
            redirectUrl: '/dashboard'
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'An internal error occurred. Please try again.'
        });
    }
});

// GET /auth/signup - Redirect to frontend signup
router.get('/signup', (req, res) => {
    res.redirect(SIGNUP_REDIRECT_URL);
});

// POST /auth/signup - Handle signup
router.post('/signup', signupValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                fieldErrors: errors.mapped()
            });
        }

        const { email, password, firstName, lastName, mobileNumber } = req.body;

        // Check if user already exists
        if (LOCAL_USERS.has(email)) {
            return res.status(409).json({
                error: 'USER_EXISTS',
                message: 'An account with this email already exists'
            });
        }

        // Hash password
        const hashedPassword = await hashPassword(password);

        // Generate user ID
        const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Create user object
        const user = {
            userId,
            email,
            password: hashedPassword,
            firstName,
            lastName,
            mobileNumber,
            isEmailVerified: true, // Auto-verify for local development
            isLocked: false,
            failedLoginAttempts: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Save user to local storage
        LOCAL_USERS.set(email, user);

        res.status(201).json({
            success: true,
            message: 'Account created successfully! You can now log in.',
            userId
        });

    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'An internal error occurred. Please try again.'
        });
    }
});

// POST /auth/logout - Handle logout
router.post('/logout', authenticateToken, async (req, res) => {
    try {
        // Clear session
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destruction error:', err);
            }
        });

        // Clear remember me cookie
        res.clearCookie('rememberMe');

        res.json({
            success: true,
            message: 'Logged out successfully'
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'An internal error occurred during logout.'
        });
    }
});

// POST /auth/forgot-password - Handle forgot password
router.post('/forgot-password', [
    body('email').isEmail().normalizeEmail()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                fieldErrors: errors.mapped()
            });
        }

        const { email } = req.body;

        // Check if user exists
        const user = LOCAL_USERS.get(email);
        
        if (!user) {
            // Don't reveal if email exists or not
            return res.json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        }

        // For local development, just return success
        res.json({
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent.'
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: 'An internal error occurred. Please try again.'
        });
    }
});

// GET /auth/users - List all users (for local development)
router.get('/users', (req, res) => {
    const users = Array.from(LOCAL_USERS.values()).map(user => ({
        userId: user.userId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mobileNumber: user.mobileNumber,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt
    }));
    
    res.json({
        success: true,
        users,
        count: users.length
    });
});

module.exports = router;
