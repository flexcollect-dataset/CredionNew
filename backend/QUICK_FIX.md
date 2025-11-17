# Quick Fix for API Endpoints Not Working on EC2

## The Problem
Your new APIs (`/api/bankruptcy/matches` and `/api/director-related/matches`) work locally but return "API endpoint not found" on EC2.

## Quick Fix Steps

### Step 1: SSH into EC2
```bash
ssh -i "your-key.pem" ec2-user@3.24.11.111
```

### Step 2: Navigate to Backend Directory
```bash
cd ~/CredionNew/backend
# Or wherever your backend is located
```

### Step 3: Test if Routes are in the Code
```bash
# Check if the routes exist in payment.routes.js
grep -n "router.get.*bankruptcy\|router.get.*director-related" routes/payment.routes.js

# Should show:
# 175:router.get('/bankruptcy/matches', async (req, res) => {
# 219:router.get('/director-related/matches', async (req, res) => {
```

### Step 4: Verify Routes are Loaded
```bash
# Run the test script
node test-routes.js

# This will show all routes and verify the new ones exist
```

### Step 5: Check Current Git Status
```bash
# See if you're on the latest code
git status
git log --oneline -5

# Pull latest code
git fetch origin
git pull origin main
```

### Step 6: Restart Server Properly
```bash
# Stop PM2 process
pm2 stop credion-backend
pm2 delete credion-backend

# Clear PM2 logs (optional)
pm2 flush

# Start fresh
cd ~/CredionNew/backend
pm2 start app.js --name credion-backend
pm2 save

# Watch logs to see if routes are loading
pm2 logs credion-backend --lines 50
```

### Step 7: Test Endpoints
```bash
# Test health check
curl http://localhost:3001/health

# Test bankruptcy endpoint
curl "http://localhost:3001/api/bankruptcy/matches?lastName=Smith"

# Test director-related endpoint
curl "http://localhost:3001/api/director-related/matches?lastName=Smith"
```

## If Still Not Working

### Check Route Mounting Order
The routes should be mounted in `app.js` like this:
```javascript
app.use('/api/payment', paymentRoutes.router);
app.use('/api', paymentRoutes.router);  // This is important!
```

### Verify payment.routes.js exports
At the bottom of `routes/payment.routes.js`, make sure you have:
```javascript
module.exports = {
  router,
  createReport,
  // ... other exports
};
```

### Check for Route Conflicts
```bash
# See all registered routes
node -e "
const app = require('./app.js');
app._router.stack.forEach((r) => {
  if(r.route && r.route.path){
    console.log(Object.keys(r.route.methods)[0].toUpperCase() + ' ' + r.route.path);
  }
});
"
```

### Force Clean Restart
```bash
# Kill all node processes
pkill -9 node

# Clear npm cache (optional)
npm cache clean --force

# Reinstall dependencies (optional)
rm -rf node_modules
npm install

# Start fresh
pm2 start app.js --name credion-backend
```

## Common Issues

1. **Old code running**: Server wasn't restarted after git pull
2. **Route not exported**: `payment.routes.js` doesn't export router correctly
3. **Mounting order**: Routes mounted after 404 handler
4. **Cached code**: Node.js cached old code (rare)

## Verify Deployment

After following these steps, your endpoints should work:
- ✅ `GET /api/bankruptcy/matches?lastName=test`
- ✅ `GET /api/director-related/matches?lastName=test`
- ✅ `POST /api/land-title/counts`

If you still see "API endpoint not found", share the output of:
- `node test-routes.js`
- `pm2 logs credion-backend --lines 100`

