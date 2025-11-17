# 🔧 EC2 API Endpoints Fix - Simple Instructions

## ✅ Confirmation: Routes Work Locally
I've verified that your routes are correctly configured:
- ✅ `/api/bankruptcy/matches` - FOUND
- ✅ `/api/director-related/matches` - FOUND  
- ✅ `/api/land-title/counts` - FOUND

## 🚀 Quick Fix (3 Steps)

### On Your Local Machine:

1. **Commit and push the fix scripts to GitHub:**
```bash
cd /Users/rutvikkorat/Downloads/CredionNew
git add backend/test-routes.js backend/fix-apis.sh backend/QUICK_FIX.md
git commit -m "Add API fix scripts"
git push origin main
```

### On Your EC2 Instance (SSH in):

2. **Pull the latest code:**
```bash
ssh -i "your-key.pem" ec2-user@3.24.11.111
cd ~/CredionNew/backend
git pull origin main
```

3. **Run the automated fix script:**
```bash
chmod +x fix-apis.sh
./fix-apis.sh
```

**That's it!** The script will:
- ✅ Check if routes exist in code
- ✅ Pull latest code if needed
- ✅ Test route loading
- ✅ Stop and restart server
- ✅ Test all endpoints
- ✅ Show you the results

## 📝 Manual Alternative (if script doesn't work)

If the automated script doesn't work for some reason, run these commands manually:

```bash
# 1. Navigate to backend
cd ~/CredionNew/backend

# 2. Pull latest code
git pull origin main

# 3. Test routes are loaded
node test-routes.js

# 4. Stop server
pm2 stop credion-backend
pm2 delete credion-backend

# 5. Start server
pm2 start app.js --name credion-backend
pm2 save

# 6. Test endpoints
curl "http://localhost:3001/api/bankruptcy/matches?lastName=test"
curl "http://localhost:3001/api/director-related/matches?lastName=test"
```

## 🔍 Troubleshooting

### If routes are NOT found in test-routes.js:
- The code wasn't pulled correctly
- Run: `git fetch origin && git pull origin main`

### If endpoints return 404:
- Server didn't restart properly
- Run: `pm2 restart credion-backend`
- Check logs: `pm2 logs credion-backend`

### If server won't start:
- Check logs: `pm2 logs credion-backend --lines 100`
- Check if port is in use: `lsof -i :3001`
- Check environment variables: `cat .env`

## 📞 What to Share if Still Not Working

If after running the fix script it still doesn't work, share:

1. **Output of test-routes.js:**
```bash
node test-routes.js
```

2. **PM2 status:**
```bash
pm2 list
pm2 logs credion-backend --lines 50
```

3. **Test endpoint response:**
```bash
curl -v "http://localhost:3001/api/bankruptcy/matches?lastName=test"
```

4. **Git status:**
```bash
git status
git log --oneline -3
```

## ✅ Expected Results

After running the fix, you should see:

```
✅ Routes loaded in payment.routes.js:
=====================================
GET      /api/bankruptcy/matches
GET      /api/director-related/matches
POST     /api/land-title/counts

🔍 Route Check:
  /api/bankruptcy/matches: ✅ FOUND
  /api/director-related/matches: ✅ FOUND
  /api/land-title/counts: ✅ FOUND
```

And the endpoints should return data (not 404).

---

**Quick Summary:**
1. Push `test-routes.js` and `fix-apis.sh` to GitHub
2. SSH into EC2
3. Run `./fix-apis.sh`
4. Done! 🎉

