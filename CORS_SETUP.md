# CORS Environment Variables Setup

This guide explains how to set up environment variables for CORS configuration without hardcoding URLs.

## Environment Variables

### For Backend (Vercel)

Set these environment variables in your Vercel backend project:

```
FRONTEND_URL=https://smartsupply-three.vercel.app
VERCEL_FRONTEND_URL=https://smartsupply-three.vercel.app
```

### For Frontend (Vercel)

Set this environment variable in your Vercel frontend project:

```
VITE_API_BASE_URL=https://smart-be-three.vercel.app/api
```

## How to Set Environment Variables in Vercel

### Backend Project:
1. Go to your backend project in Vercel dashboard
2. Click "Settings" → "Environment Variables"
3. Add:
   - `FRONTEND_URL` = `https://smartsupply-three.vercel.app`
   - `VERCEL_FRONTEND_URL` = `https://smartsupply-three.vercel.app`

### Frontend Project:
1. Go to your frontend project in Vercel dashboard
2. Click "Settings" → "Environment Variables"
3. Add:
   - `VITE_API_BASE_URL` = `https://smart-be-three.vercel.app/api`

## Benefits

- ✅ **No Hardcoded URLs** - All URLs come from environment variables
- ✅ **Easy Updates** - Change URLs without code changes
- ✅ **Environment Specific** - Different URLs for different environments
- ✅ **Secure** - URLs not exposed in code

## Testing

After setting environment variables:

1. **Redeploy both projects** (frontend and backend)
2. **Test CORS** using the CORS test component
3. **Check environment variables** in the CORS test response

## Current Configuration

- **Frontend**: https://smartsupply-three.vercel.app/
- **Backend**: https://smart-be-three.vercel.app/
- **API Base**: https://smart-be-three.vercel.app/api
