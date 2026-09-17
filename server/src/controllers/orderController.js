const Order = require('../models/Order');

async function listMyOrders(req, res, next) {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(
      orders.map((order) => ({
        orderId: order._id,
        items: order.items,
        total: order.total,
        status: order.status,
        createdAt: order.createdAt,
      }))
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { listMyOrders };
