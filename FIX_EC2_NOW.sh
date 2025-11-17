#!/bin/bash
# EXACT FIX FOR EC2 - Run this on your EC2 instance

echo "🚀 Starting EC2 Fix..."

cd ~/CredionNew/backend || cd /home/ec2-user/CredionNew/backend || exit 1

echo "📥 Pulling latest code..."
git fetch origin
git pull origin main || git pull origin master

echo "⏹️  Stopping server..."
pm2 stop credion-backend 2>/dev/null || true
pm2 delete credion-backend 2>/dev/null || true
pkill -f "node app.js" 2>/dev/null || true
sleep 2

echo "📦 Installing dependencies..."
npm install --production

echo "✅ Verifying routes exist..."
if grep -q "bankruptcy/matches" routes/payment.routes.js && grep -q "director-related/matches" routes/payment.routes.js; then
    echo "   ✅ Routes found in code"
else
    echo "   ❌ Routes NOT found - code may not have updated"
    git log --oneline -3
    exit 1
fi

echo "▶️  Starting server..."
pm2 start app.js --name credion-backend
pm2 save

echo "⏳ Waiting for server to start..."
sleep 5

echo "🔍 Testing endpoints..."
if curl -s "http://localhost:3001/health" > /dev/null; then
    echo "   ✅ Server is running"
else
    echo "   ❌ Server not responding - check logs: pm2 logs credion-backend"
    pm2 logs credion-backend --lines 20 --nostream
    exit 1
fi

echo ""
echo "🎉 Fix Complete! Testing routes:"
echo ""
curl -s "http://localhost:3001/api/bankruptcy/matches?lastName=test" | head -c 300
echo ""
echo ""
curl -s "http://localhost:3001/api/director-related/matches?lastName=test" | head -c 300
echo ""
echo ""
echo "✅ Done! Check status: pm2 list"

