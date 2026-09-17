const express = require('express');
const { listMyOrders } = require('../controllers/orderController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/me', requireAuth, listMyOrders);

module.exports = router;
