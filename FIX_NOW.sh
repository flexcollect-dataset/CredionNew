#!/bin/bash
# ONE COMMAND FIX FOR EC2 - Run this on your EC2 instance

cd ~/CredionNew/backend && git pull origin main && pm2 stop credion-backend 2>/dev/null; pm2 delete credion-backend 2>/dev/null; pkill -f "node app.js" 2>/dev/null; sleep 2 && npm install --production && pm2 start app.js --name credion-backend && pm2 save && sleep 3 && echo "Testing endpoints..." && curl -s "http://localhost:3001/api/bankruptcy/matches?lastName=test" | head -c 200 && echo "" && curl -s "http://localhost:3001/api/director-related/matches?lastName=test" | head -c 200 && echo "" && echo "Done! Check PM2: pm2 list"

