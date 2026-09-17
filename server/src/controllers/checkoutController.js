const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const paymentGateway = require('../services/paymentGateway');

async function checkout(req, res, next) {
  try {
    const { items, payment } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Cart is empty' });
    }
    if (!payment || typeof payment !== 'object') {
      return res.status(400).json({ message: 'Payment details are required' });
    }

    // Merge repeated product IDs before validating stock — otherwise the same
    // product listed twice in one request each get checked against the same
    // starting stock figure, and both decrements can apply, overselling it.
    const quantityByProductId = new Map();
    for (const { productId, quantity } of items) {
      if (!mongoose.isValidObjectId(productId) || !Number.isInteger(quantity) || quantity < 1) {
        return res.status(400).json({ message: 'Invalid cart item' });
      }
      quantityByProductId.set(productId, (quantityByProductId.get(productId) || 0) + quantity);
    }

    const orderItems = [];
    let total = 0;

    for (const [productId, quantity] of quantityByProductId) {
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

    // Charge before touching stock or creating the order -- a decline must
    // leave everything exactly as it was.
    const chargeResult = await paymentGateway.charge(payment, total);
    if (!chargeResult.approved) {
      return res.status(402).json({ message: chargeResult.reason });
    }

    // Decrement stock for each purchased item. This is a fake payment gateway
    // (see server/src/services/paymentGateway.js): no real money moves.
    for (const [productId, quantity] of quantityByProductId) {
      await Product.updateOne({ _id: productId }, { $inc: { stock: -quantity } });
    }

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      total,
      status: 'confirmed',
      payment: {
        transactionId: chargeResult.transactionId,
        cardLast4: chargeResult.cardLast4,
      },
    });

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
