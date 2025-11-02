# SmartEstate Backend API

Backend API server for SmartEstate multi-tenant real estate management system.

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **Prisma** - ORM for database access
- **Supabase** - PostgreSQL database
- **JWT** - Authentication
- **bcryptjs** - Password hashing

## Getting Started

### Installation

```bash
npm install
```

### Environment Setup

Create a `.env` file based on `.env.example`:

```env
PORT=5000
NODE_ENV=development
DATABASE_URL="postgresql://user:password@host:port/database"
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
JWT_SECRET=your_secret_key
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:3000
```

### Database Setup

```bash
# Generate Prisma Client
npx prisma generate

# Push schema to database
npx prisma db push

# Open Prisma Studio (optional)
npx prisma studio
```

### Run Development Server

```bash
npm run dev
```

Server runs on: `http://localhost:5000`

## API Documentation

### Health Check Endpoints

#### GET /api/health
Basic server health check

**Response:**
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2025-10-11T...",
  "uptime": 123.45,
  "environment": "development"
}
```

#### GET /api/health/handshake
Frontend-backend connection verification

**Response:**
```json
{
  "success": true,
  "message": "🤝 Frontend-Backend connection successful!",
  "data": {
    "server": "SmartEstate Backend",
    "version": "1.0.0",
    "timestamp": "2025-10-11T...",
    "connected": true,
    "status": "operational"
  }
}
```

## Project Structure

```
backend/
├── src/
│   ├── server.js              # Main server file
│   ├── controllers/           # Route controllers
│   │   └── health.controller.js
│   ├── routes/                # API routes
│   │   └── health.routes.js
│   ├── middleware/            # Custom middleware (coming soon)
│   ├── models/                # Database models (Prisma)
│   └── utils/                 # Utility functions (coming soon)
├── prisma/
│   └── schema.prisma          # Database schema
├── .env                       # Environment variables
├── .env.example               # Environment template
├── .gitignore                 # Git ignore rules
└── package.json               # Dependencies
```

## Database Schema

Multi-tenant architecture with the following models:

- **SuperAdmin** - Platform administrators
- **Tenant** - Real estate agencies
- **TenantAdmin** - Agency administrators
- **Agent** - Agency agents
- **Property** - Property listings
- **Client** - Client requirements
- **Match** - Property-client matches

All models (except SuperAdmin) include `tenant_id` for data isolation.

## Scripts

```bash
npm run dev      # Development with nodemon
npm start        # Production server
```

## Error Handling

The API uses standard HTTP status codes:

- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `500` - Internal Server Error

Error response format:
```json
{
  "success": false,
  "message": "Error message here",
  "error": "Detailed error (dev only)"
}
```

## Security

- CORS enabled for frontend origin
- JWT authentication (coming soon)
- Password hashing with bcryptjs
- Environment variables for sensitive data
- Tenant-based data isolation

## Coming Soon

- Authentication endpoints
- Property management CRUD
- Client management CRUD
- Smart matching algorithm
- WhatsApp/SMS integration
- File upload for images
- Search and filtering
- Analytics endpoints

