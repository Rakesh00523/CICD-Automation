const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const productsRouter = require('./routes/products');
const checkoutRouter = require('./routes/checkout');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
  app.use(express.json());
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/products', productsRouter);
  app.use('/api/checkout', checkoutRouter);

  app.use((req, res) => res.status(404).json({ message: 'Not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
