# EC2 Backend Deployment Guide

## Problem
After pushing new API endpoints to GitHub, the frontend deployed successfully but the backend on EC2 still shows "API endpoint not found" for the new APIs.

## Solution: Update Backend on EC2

### Step 1: SSH into Your EC2 Instance

```bash
ssh -i "path/to/your-key.pem" ec2-user@3.24.11.111
# Or if using ubuntu user:
ssh -i "path/to/your-key.pem" ubuntu@3.24.11.111
```

**Note:** Replace `3.24.11.111` with your actual EC2 Elastic IP if different.

### Step 2: Navigate to Backend Directory

```bash
cd /path/to/CredionNew/backend
# Or if your project is in home directory:
cd ~/CredionNew/backend
# Or wherever your backend code is located
```

### Step 3: Stop the Current Node.js Server

First, find how your server is running:

**Option A: If using PM2 (Process Manager)**
```bash
pm2 list                    # Check running processes
pm2 stop all               # Stop all processes
# Or stop specific app:
pm2 stop credion-backend
```

### Step 4: Pull Latest Code from GitHub

```bash
# Make sure you're in the backend directory
cd ~/CredionNew/backend

# Pull latest changes
git pull origin main
# Or if you're on a different branch:
git pull origin <your-branch-name>
```

### Step 5: Install Dependencies (if needed)

```bash
# Install any new dependencies
npm install
```

### Step 6: Restart the Server

**Option A: Using PM2**
```bash
pm2 start app.js --name credion-backend
# Or if you have an ecosystem file:
pm2 start ecosystem.config.js
# Or restart if already configured:
pm2 restart credion-backend
```

### Step 7: Verify the Server is Running

```bash
# Check if the process is running
ps aux | grep node

# Check the logs (if using PM2)
pm2 logs credion-backend

# Test the health endpoint
curl http://localhost:3001/health

# Or test from your domain
curl https://your-domain.com/health
```

### Step 8: Test the New API Endpoints

```bash
# Test bankruptcy endpoint
curl "http://localhost:3001/api/bankruptcy/matches?lastName=test"

# Test director-related endpoint  
curl "http://localhost:3001/api/director-related/matches?lastName=test"

# Test land-title endpoint
curl -X POST http://localhost:3001/api/land-title/counts \
  -H "Content-Type: application/json" \
  -d '{"type":"organization","abn":"123456789","states":["NSW"]}'
```

## Quick Script (All-in-One)

Save this as `deploy-backend.sh` on your EC2 instance:

```bash
#!/bin/bash

# Navigate to backend directory
cd ~/CredionNew/backend

# Stop the server (adjust based on your setup)
pm2 stop credion-backend 2>/dev/null || \
sudo systemctl stop credion-backend 2>/dev/null || \
pkill -f "node app.js"

# Pull latest code
git pull origin main

# Install dependencies
npm install

# Start the server (adjust based on your setup)
pm2 start app.js --name credion-backend || \
sudo systemctl start credion-backend || \
nohup node app.js > app.log 2>&1 &

# Wait a moment
sleep 2

# Check status
echo "Server status:"
pm2 list 2>/dev/null || sudo systemctl status credion-backend 2>/dev/null || ps aux | grep node

echo "Deployment complete!"
```

Make it executable and run:
```bash
chmod +x deploy-backend.sh
./deploy-backend.sh
```

## Troubleshooting

### If endpoints still not found:

1. **Check route registration in app.js**
   ```bash
   grep -n "bankruptcy\|director-related\|land-title" app.js
   ```

2. **Verify payment.routes.js has the routes**
   ```bash
   grep -n "router.get\|router.post" routes/payment.routes.js | grep -E "bankruptcy|director-related|land-title"
   ```

3. **Check server logs for errors**
   ```bash
   # PM2 logs
   pm2 logs credion-backend
   
   # Or check log file
   tail -f app.log
   ```

4. **Verify the server is actually running the new code**
   ```bash
   # Check if routes are loaded
   curl http://localhost:3001/
   ```

5. **Check CORS configuration** - Make sure your EC2 domain is allowed in CORS_ORIGINS

6. **Check environment variables** - Ensure all required env vars are set in `.env` file

## Setting up PM2 (Recommended for Production)

If you're not using PM2, it's highly recommended:

```bash
# Install PM2 globally
npm install -g pm2

# Start your app with PM2
cd ~/CredionNew/backend
pm2 start app.js --name credion-backend

# Save PM2 configuration
pm2 save

# Setup PM2 to start on system reboot
pm2 startup
# Follow the instructions it provides
```

## Environment Variables on EC2

Make sure your `.env` file on EC2 has all required variables:

```env
# Database
DB_HOST=your-db-host
DB_PORT=5432
DB_NAME=your-db-name
DB_USER=your-db-user
DB_PASSWORD=your-db-password

# Server
PORT=3001
NODE_ENV=production

# CORS - Include your Netlify frontend URL
CORS_ORIGINS=https://your-netlify-app.netlify.app,https://your-domain.com

# Frontend URL (if redirects are needed)
FRONTEND_APP_URL=https://your-netlify-app.netlify.app

# JWT Secrets
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret

# Stripe
STRIPE_PUBLISHABLE_KEY=your-stripe-publishable-key
STRIPE_SECRET_KEY=your-stripe-secret-key

# Other API keys as needed
BANKRUPTCY_CLIENT_ID=your-bankruptcy-client-id
BANKRUPTCY_CLIENT_SECRET=your-bankruptcy-client-secret
# ... etc
```

## Next Steps

After deploying, test the new endpoints from your frontend. The endpoints should now work:
- `/api/bankruptcy/matches`
- `/api/director-related/matches`  
- `/api/land-title/counts`
