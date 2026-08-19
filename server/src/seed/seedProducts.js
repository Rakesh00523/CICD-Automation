require('dotenv').config();
const { connectDB } = require('../config/db');
const Product = require('../models/Product');

const sampleProducts = [
  {
    name: 'Wireless Headphones',
    description: 'Over-ear Bluetooth headphones with active noise cancellation.',
    price: 59.99,
    category: 'Electronics',
    imageUrl: 'https://picsum.photos/seed/headphones/400/300',
    stock: 25,
  },
  {
    name: 'Running Shoes',
    description: 'Lightweight breathable running shoes for daily training.',
    price: 44.5,
    category: 'Footwear',
    imageUrl: 'https://picsum.photos/seed/shoes/400/300',
    stock: 40,
  },
  {
    name: 'Stainless Steel Water Bottle',
    description: 'Insulated 750ml bottle that keeps drinks cold for 24 hours.',
    price: 18.0,
    category: 'Home',
    imageUrl: 'https://picsum.photos/seed/bottle/400/300',
    stock: 60,
  },
  {
    name: 'Mechanical Keyboard',
    description: 'Compact 65% mechanical keyboard with hot-swappable switches.',
    price: 79.99,
    category: 'Electronics',
    imageUrl: 'https://picsum.photos/seed/keyboard/400/300',
    stock: 15,
  },
  {
    name: 'Canvas Backpack',
    description: 'Durable 20L canvas backpack with laptop compartment.',
    price: 34.25,
    category: 'Accessories',
    imageUrl: 'https://picsum.photos/seed/backpack/400/300',
    stock: 30,
  },
];

async function seed() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ecommerce';
  await connectDB(uri);
  await Product.deleteMany({});
  await Product.insertMany(sampleProducts);
  console.log(`Seeded ${sampleProducts.length} products`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding failed', err);
  process.exit(1);
});
