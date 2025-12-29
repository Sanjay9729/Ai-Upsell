import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { connectToMongoDB, initializeCollections } from './database/mongodb.js';
import productsRouter from './routes/products.js';
import webhooksRouter from './routes/webhooks.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/products', productsRouter);
app.use('/api/webhooks', webhooksRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
async function startServer() {
  try {
    // Connect to MongoDB
    await connectToMongoDB();
    await initializeCollections();
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`🚀 AI Upsell Backend Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔌 API endpoints: http://localhost:${PORT}/api`);
      console.log(`📦 MongoDB connected successfully`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await closeMongoDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await closeMongoDB();
  process.exit(0);
});

// Import closeMongoDB from mongodb.js
import { closeMongoDB } from './database/mongodb.js';

startServer();