#!/bin/bash

# Automated Fix Script for API Endpoints Not Working on EC2
# Run this script on your EC2 instance in the backend directory

set -e

echo "🔧 Starting API Endpoints Fix..."
echo "================================="
echo ""

# Step 1: Check current directory
BACKEND_DIR=$(pwd)
if [ ! -f "app.js" ]; then
    echo "❌ Error: app.js not found. Please run this script from the backend directory."
    echo "   Current directory: $BACKEND_DIR"
    exit 1
fi

echo "✅ Backend directory: $BACKEND_DIR"
echo ""

# Step 2: Check if routes exist in code
echo "📋 Step 1: Checking if routes exist in payment.routes.js..."
if grep -q "router.get('/bankruptcy/matches'" routes/payment.routes.js; then
    echo "   ✅ /api/bankruptcy/matches route found"
    BANKRUPTCY_EXISTS=true
else
    echo "   ❌ /api/bankruptcy/matches route NOT found in code"
    BANKRUPTCY_EXISTS=false
fi

if grep -q "router.get('/director-related/matches'" routes/payment.routes.js; then
    echo "   ✅ /api/director-related/matches route found"
    DIRECTOR_EXISTS=true
else
    echo "   ❌ /api/director-related/matches route NOT found in code"
    DIRECTOR_EXISTS=false
fi

if grep -q "router.post('/land-title/counts'" routes/payment.routes.js; then
    echo "   ✅ /api/land-title/counts route found"
    LANDTITLE_EXISTS=true
else
    echo "   ❌ /api/land-title/counts route NOT found in code"
    LANDTITLE_EXISTS=false
fi

if [ "$BANKRUPTCY_EXISTS" = false ] || [ "$DIRECTOR_EXISTS" = false ] || [ "$LANDTITLE_EXISTS" = false ]; then
    echo ""
    echo "⚠️  Routes not found in code. Pulling latest from GitHub..."
    git fetch origin
    git pull origin main || git pull origin master
    echo "✅ Code updated. Please run this script again."
    exit 0
fi

echo ""

# Step 3: Check Git status
echo "📋 Step 2: Checking Git status..."
GIT_STATUS=$(git status --porcelain)
if [ -n "$GIT_STATUS" ]; then
    echo "   ⚠️  Uncommitted changes detected"
    git status --short
else
    echo "   ✅ Working directory clean"
fi

# Check if behind remote
git fetch origin > /dev/null 2>&1
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null || git rev-parse origin/master 2>/dev/null)

if [ "$LOCAL" != "$REMOTE" ]; then
    echo "   ⚠️  Local code is behind remote. Updating..."
    git pull origin main || git pull origin master
    echo "   ✅ Code updated"
else
    echo "   ✅ Code is up to date"
fi

echo ""

# Step 4: Test route loading
echo "📋 Step 3: Testing route loading..."
if node test-routes.js 2>/dev/null; then
    echo "   ✅ Routes are loading correctly"
else
    echo "   ❌ Routes are NOT loading correctly"
    echo "   Running test script for details..."
    node test-routes.js
    exit 1
fi

echo ""

# Step 5: Stop server
echo "📋 Step 4: Stopping server..."
if command -v pm2 &> /dev/null; then
    if pm2 list | grep -q "credion-backend"; then
        pm2 stop credion-backend 2>/dev/null || true
        pm2 delete credion-backend 2>/dev/null || true
        echo "   ✅ Stopped PM2 process"
    else
        echo "   ℹ️  No PM2 process found"
    fi
fi

# Also try to kill any direct node processes
pkill -f "node app.js" 2>/dev/null && echo "   ✅ Killed direct node processes" || true

sleep 2
echo ""

# Step 6: Install dependencies (if package.json changed)
echo "📋 Step 5: Installing dependencies..."
npm install --production
echo "   ✅ Dependencies installed"
echo ""

# Step 7: Start server
echo "📋 Step 6: Starting server..."
if command -v pm2 &> /dev/null; then
    pm2 start app.js --name credion-backend
    pm2 save
    echo "   ✅ Started with PM2"
    SERVER_TYPE="pm2"
else
    nohup node app.js > app.log 2>&1 &
    echo "   ✅ Started with nohup (PID: $!)"
    SERVER_TYPE="nohup"
fi

# Wait for server to start
echo "   ⏳ Waiting for server to start..."
sleep 5
echo ""

# Step 8: Test endpoints
echo "📋 Step 7: Testing endpoints..."
echo ""

# Test health check
if curl -f http://localhost:3001/health > /dev/null 2>&1; then
    echo "   ✅ Health check passed"
else
    echo "   ❌ Health check failed"
    if [ "$SERVER_TYPE" = "pm2" ]; then
        echo "   Checking PM2 logs..."
        pm2 logs credion-backend --lines 20 --nostream
    else
        echo "   Checking app.log..."
        tail -20 app.log
    fi
    exit 1
fi

# Test bankruptcy endpoint
echo -n "   Testing /api/bankruptcy/matches... "
BANKRUPTCY_RESPONSE=$(curl -s -w "\n%{http_code}" "http://localhost:3001/api/bankruptcy/matches?lastName=test" 2>/dev/null || echo "error")
BANKRUPTCY_CODE=$(echo "$BANKRUPTCY_RESPONSE" | tail -1)
if [ "$BANKRUPTCY_CODE" = "200" ] || [ "$BANKRUPTCY_CODE" = "400" ]; then
    echo "✅ Working (HTTP $BANKRUPTCY_CODE)"
else
    echo "❌ Failed (HTTP $BANKRUPTCY_CODE or error)"
    echo "      Response: $(echo "$BANKRUPTCY_RESPONSE" | head -1)"
fi

# Test director-related endpoint
echo -n "   Testing /api/director-related/matches... "
DIRECTOR_RESPONSE=$(curl -s -w "\n%{http_code}" "http://localhost:3001/api/director-related/matches?lastName=test" 2>/dev/null || echo "error")
DIRECTOR_CODE=$(echo "$DIRECTOR_RESPONSE" | tail -1)
if [ "$DIRECTOR_CODE" = "200" ] || [ "$DIRECTOR_CODE" = "400" ]; then
    echo "✅ Working (HTTP $DIRECTOR_CODE)"
else
    echo "❌ Failed (HTTP $DIRECTOR_CODE or error)"
    echo "      Response: $(echo "$DIRECTOR_RESPONSE" | head -1)"
fi

echo ""

# Step 9: Summary
echo "================================="
echo "🎉 Fix Complete!"
echo ""

if [ "$SERVER_TYPE" = "pm2" ]; then
    echo "📊 Server Status:"
    pm2 list
    echo ""
    echo "📝 View logs: pm2 logs credion-backend"
else
    echo "📝 View logs: tail -f app.log"
fi

echo ""
echo "✅ Test your APIs:"
echo "   curl 'http://localhost:3001/api/bankruptcy/matches?lastName=test'"
echo "   curl 'http://localhost:3001/api/director-related/matches?lastName=test'"
echo ""
echo "🌐 Test from your domain:"
echo "   curl 'https://your-domain.com/api/bankruptcy/matches?lastName=test'"
echo "   curl 'https://your-domain.com/api/director-related/matches?lastName=test'"

