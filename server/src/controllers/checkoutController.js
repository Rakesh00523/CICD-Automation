const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');

async function checkout(req, res, next) {
  try {
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }

    const orderItems = [];
    let total = 0;

    for (const { productId, quantity } of items) {
      if (!mongoose.isValidObjectId(productId) || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Invalid cart item' });
      }

      const product = await Product.findById(productId);
      if (!product) {
        return res.status(404).json({ message: `Product ${productId} not found` });
      }
      if (product.stock < quantity) {
        return res.status(409).json({ message: `Insufficient stock for ${product.name}` });
      }

      orderItems.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity,
      });
      total += product.price * quantity;
    }

    // Decrement stock for each purchased item. This is a mock checkout: no real
    // payment is processed — a fake payment gateway is planned for a later phase.
    for (const { productId, quantity } of items) {
      await Product.updateOne({ _id: productId }, { $inc: { stock: -quantity } });
    }

    const order = await Order.create({ items: orderItems, total, status: 'confirmed' });

    res.status(201).json({
      orderId: order._id,
      total: order.total,
      status: order.status,
      createdAt: order.createdAt,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { checkout };
