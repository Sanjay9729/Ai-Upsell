# AI Upsell - Shopify Product Recommendation System

A complete AI-powered upsell recommendation system for Shopify stores that implements an exact 6-step flow to show relevant product recommendations on product detail pages.

## 🎯 Exact Flow Implementation

This application follows your specified flow exactly:

1. **Products are synced from Shopify to MongoDB** - Happens when app is installed, also on product updates via webhooks
2. **Customer opens a product detail page** - Page provides current product ID to the app
3. **AI engine searches MongoDB** - Looks at products stored for that store only
4. **Top upsell product IDs are selected** - Usually 3-4 products
5. **Fresh product details are fetched from Shopify** - Price, image, availability (Shopify is source of truth)
6. **Upsell products are shown on product page** - Rendered by the upsell component

## 🚀 Features

- **AI-Powered Recommendations**: Uses intelligent similarity matching based on product features
- **Real-time Updates**: Webhook integration for automatic product sync
- **Fresh Data**: Always shows current price, availability, and images from Shopify
- **Responsive Design**: Mobile-friendly upsell display
- **Analytics Tracking**: Built-in click tracking for performance monitoring
- **Error Handling**: Comprehensive error handling and logging
- **No Schema Dependencies**: Uses raw MongoDB operations as requested

## 📁 Project Structure

```
ai-upsell/
├── backend/                 # Backend API server
│   ├── database/           # MongoDB connection and utilities
│   ├── routes/             # API routes (products, webhooks)
│   ├── services/           # Business logic (AI engine, Shopify, logging)
│   ├── server.js           # Main server file
│   └── package.json        # Backend dependencies
├── frontend/               # React frontend components
│   ├── src/
│   │   ├── components/     # React components (UpsellProducts, etc.)
│   │   ├── services/       # API service for frontend
│   │   └── ...
├── README.md              # This file
└── ...
```

## 🛠️ Technology Stack

### Backend
- **Node.js** with Express.js
- **MongoDB** for data storage
- **Shopify Admin API** for product data
- **Shopify Storefront API** for fresh product details
- **Groq LLM** for AI-powered product recommendations
- **Custom Rule-based Fallback** for reliability

### Frontend
- **React** for component-based UI
- **CSS Modules** for styling
- **Fetch API** for backend communication

## 📋 Prerequisites

- Node.js 18+ 
- MongoDB (local or cloud)
- Shopify store with API access
- Shopify Storefront API token

## 🔧 Installation & Setup

### 1. Clone and Install Dependencies

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies (if using separate frontend)
cd ../frontend
npm install
```

### 2. Environment Configuration

Create `.env` files in both backend and frontend directories:

**Backend `.env`:**
```env
# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/ai-upsell

# Server Configuration
PORT=3000
NODE_ENV=development

# Groq AI Configuration (Required for AI recommendations)
GROQ_API_KEY=your_groq_api_key_here

# Server Configuration
PORT=3000

# Logging
LOG_LEVEL=info

# Frontend URL for CORS
FRONTEND_URL=http://localhost:3000

# Shopify Configuration
SHOPIFY_APP_SECRET=your_shopify_app_secret_here
```

**Getting Your Groq API Key**
1. Visit [Groq Console](https://console.groq.com/)
2. Sign up for a free account
3. Create a new API key
4. Add it to your `.env` file as `GROQ_API_KEY`

> **Note**: Groq offers fast, free inference for AI recommendations. The system includes a fallback to rule-based recommendations if Groq is unavailable.

**Frontend `.env`:**
```env
REACT_APP_API_URL=http://localhost:3000/api
```

### 3. MongoDB Setup

**Option A: Local MongoDB**
```bash
# Install MongoDB locally or use Docker
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

**Option B: MongoDB Atlas (Cloud)**
1. Create account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create cluster and get connection string
3. Update `MONGODB_URI` in backend `.env`

### 4. Start Development Servers

```bash
# Start backend server
cd backend
npm run dev

# Start frontend (if separate)
cd frontend
npm start
```

## 🔌 Integration Guide

### Basic Integration in Your Product Page

```jsx
import UpsellProducts from './components/UpsellProducts';
import './components/UpsellProducts.css';

function ProductDetailPage({ product }) {
  return (
    <div>
      {/* Your existing product display */}
      <div className="product-info">
        <h1>{product.title}</h1>
        <p>{product.description}</p>
        {/* ... other product details */}
      </div>

      {/* Add AI Upsell Component */}
      <UpsellProducts
        currentProductId={product.id}
        shopDomain="yourstore.myshopify.com"
        storefrontAccessToken="your_storefront_token"
        title="You might also like"
        maxProducts={4}
      />
    </div>
  );
}
```

### Required Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `currentProductId` | string | Yes | Current product ID |
| `shopDomain` | string | Yes | Shop domain (e.g., mystore.myshopify.com) |
| `storefrontAccessToken` | string | Yes | Shopify Storefront API token |
| `title` | string | No | Section title (default: "You might also like") |
| `maxProducts` | number | No | Max products to show (default: 4) |
| `className` | string | No | Additional CSS classes |

## 📚 API Documentation

### Product Sync Endpoint

**POST** `/api/products/sync`

Sync products from Shopify to MongoDB.

**Request Body:**
```json
{
  "shopId": "mystore.myshopify.com",
  "accessToken": "shpat_..."
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully synced 25 products",
  "syncedCount": 25
}
```

### Upsell Recommendations Endpoint

**GET** `/api/products/upsell/:productId?shopId=:shopDomain`

Get upsell recommendations for a product.

**Query Parameters:**
- `productId`: Product ID to get recommendations for
- `shopId`: Shop domain

**Response:**
```json
{
  "success": true,
  "upsellProductIds": ["123", "456", "789"],
  "recommendations": [
    {
      "productId": "123",
      "title": "Similar Product",
      "similarityScore": 85,
      "reason": "Same category"
    }
  ]
}
```

### Webhook Endpoints

**POST** `/api/webhooks/products/update`
**POST** `/api/webhooks/products/create`
**POST** `/api/webhooks/products/delete`
**POST** `/api/webhooks/app/uninstalled`

Handle Shopify webhooks for automatic product sync.

## 🤖 Groq AI Engine Details

This system uses **Groq's LLM** for intelligent product recommendations with a sophisticated analysis approach:

### Groq AI Capabilities
- **Natural Language Analysis**: Deep understanding of product relationships
- **Context-Aware Recommendations**: Considers customer purchase patterns
- **Intelligent Reasoning**: Explains why products are recommended
- **Real-time Processing**: Fast inference for immediate recommendations
- **Confidence Scoring**: Provides recommendation reliability scores

### Fallback System
- **Rule-based Engine**: Automatically activates if Groq is unavailable
- **Feature Similarity**: Category, brand, color, and keyword matching
- **Weighted Scoring**: Prioritizes most relevant product attributes

The AI engine uses a sophisticated similarity algorithm that considers:

### Similarity Factors (Weighted)
- **Category/Product Type** (40% weight) - Same or related categories
- **Brand/Vendor** (25% weight) - Same brand products
- **Color** (15% weight) - Matching or complementary colors
- **Style** (10% weight) - Similar style characteristics
- **Keywords** (10% weight) - Text similarity in titles/descriptions

### Recommendation Logic
1. Calculates similarity scores for all products in the store
2. Selects top-scoring products (usually 3-4)
3. Ensures diversity by avoiding very similar products
4. Generates human-readable reasons for recommendations

## 🔄 Shopify Webhooks Setup

Configure webhooks in your Shopify app settings:

1. **Product Create**: `https://your-domain.com/api/webhooks/products/create`
2. **Product Update**: `https://your-domain.com/api/webhooks/products/update`
3. **Product Delete**: `https://your-domain.com/api/webhooks/products/delete`
4. **App Uninstall**: `https://your-domain.com/api/webhooks/app/uninstalled`

## 📊 Analytics & Monitoring

The system includes built-in analytics tracking:

- **Click Tracking**: Records when users click on upsell products
- **Performance Logging**: Comprehensive request/response logging
- **Error Monitoring**: Detailed error tracking and reporting

## 🚀 Deployment

### Backend Deployment

1. Set production environment variables
2. Deploy to your preferred platform (Heroku, AWS, DigitalOcean)
3. Ensure MongoDB connection is configured
4. Update CORS settings for production domain

### Frontend Deployment

1. Build the React app: `npm run build`
2. Deploy to CDN or hosting service
3. Update API URL in production environment

## 🧪 Testing

```bash
# Test backend API
curl -X POST http://localhost:3001/api/products/sync \
  -H "Content-Type: application/json" \
  -d '{"shopId":"test.myshopify.com","accessToken":"test_token"}'

# Test health endpoint
curl http://localhost:3001/health
```

## 📈 Performance Optimization

- **Database Indexing**: Proper MongoDB indexes for fast queries
- **Caching**: Consider Redis for frequent AI calculations
- **Rate Limiting**: Implement Shopify API rate limiting
- **Image Optimization**: Use Shopify's image optimization features

## 🔒 Security Considerations

- **HMAC Verification**: All webhooks are HMAC verified
- **CORS Configuration**: Properly configured for your domains
- **Environment Variables**: Sensitive data stored securely
- **API Rate Limiting**: Protect against abuse

## 🛡️ Error Handling

The system includes comprehensive error handling:

- **Graceful Degradation**: Shows fallback content if AI fails
- **Retry Logic**: Automatic retry for failed Shopify API calls
- **User Feedback**: Clear error messages for users
- **Logging**: Detailed error logs for debugging

## 📞 Support

For issues and questions:
1. Check the logs in your backend server
2. Verify MongoDB connection and data
3. Ensure Shopify API credentials are correct
4. Test webhook endpoints are accessible

## 📄 License

MIT License - feel free to use in your projects.

---

**Built with ❤️ for Shopify merchants who want to increase their average order value through intelligent product recommendations.**
