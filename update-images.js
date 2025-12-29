import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import fetch from 'node-fetch';

dotenv.config();

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-upsell';
const shop = process.env.SHOP_CUSTOM_DOMAIN;
const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;

async function updateProductImages() {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db('ai-upsell');
    const productsCollection = db.collection('products');

    // Get all products from MongoDB
    const products = await productsCollection.find({ shopId: shop }).toArray();
    console.log(`📦 Found ${products.length} products to update\n`);

    let updatedCount = 0;
    let hasNextPage = true;
    let cursor = null;
    const imageMap = new Map();

    // Fetch all product images from Shopify GraphQL
    console.log('🔍 Fetching images from Shopify GraphQL...');
    while (hasNextPage) {
      const response = await fetch(`https://${shop}/admin/api/2024-01/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `
            query getProducts($cursor: String) {
              products(first: 50, after: $cursor) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                edges {
                  node {
                    id
                    legacyResourceId
                    images(first: 10) {
                      edges {
                        node {
                          id
                          url
                          altText
                          width
                          height
                        }
                      }
                    }
                  }
                }
              }
            }
          `,
          variables: {
            cursor: cursor
          }
        })
      });

      const data = await response.json();

      if (data.errors) {
        console.error('❌ GraphQL errors:', data.errors);
        break;
      }

      const productsData = data.data?.products;
      if (!productsData) break;

      // Map product IDs to images
      productsData.edges.forEach(({ node: product }) => {
        const productId = parseInt(product.legacyResourceId, 10);
        const images = product.images.edges.map(({ node: img }) => ({
          id: img.id,
          src: img.url,
          alt: img.altText || '',
          width: img.width,
          height: img.height
        }));
        imageMap.set(productId, images);
      });

      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;
      console.log(`  Fetched images for ${imageMap.size} products...`);
    }

    console.log(`\n📸 Fetched images for ${imageMap.size} products from Shopify\n`);

    // Update products in MongoDB with images
    console.log('💾 Updating MongoDB with images...\n');
    for (const product of products) {
      const images = imageMap.get(product.productId);

      if (images && images.length > 0) {
        await productsCollection.updateOne(
          { shopId: shop, productId: product.productId },
          {
            $set: {
              images: images,
              image: images[0],
              updatedAt: new Date()
            }
          }
        );

        updatedCount++;
        console.log(`✅ Updated ${product.title} (${images.length} images)`);
      } else {
        console.log(`⚠️  No images for ${product.title}`);
      }
    }

    console.log(`\n✅ Successfully updated ${updatedCount}/${products.length} products with images`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

updateProductImages();
