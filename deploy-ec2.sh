#!/bin/bash
# One-command EC2 deployment fix
# Run this on your EC2 instance: ./deploy-ec2.sh

cd ~/CredionNew/backend 2>/dev/null || cd /home/ec2-user/CredionNew/backend 2>/dev/null || cd ~/backend || { echo "❌ Backend directory not found"; exit 1; }
git pull origin main 2>/dev/null || git pull origin master 2>/dev/null || { echo "⚠️  Git pull failed, continuing..."; }
chmod +x fix-apis.sh test-routes.js 2>/dev/null
./fix-apis.sh || {
    echo "📝 Running manual fix...";
    pm2 stop credion-backend 2>/dev/null; pm2 delete credion-backend 2>/dev/null;
    pkill -f "node app.js" 2>/dev/null;
    npm install --production;
    pm2 start app.js --name credion-backend || nohup node app.js > app.log 2>&1 &;
    sleep 3;
    curl -s "http://localhost:3001/api/bankruptcy/matches?lastName=test" | head -1 && echo "✅ APIs working!" || echo "❌ Still having issues";
}

