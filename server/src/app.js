const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoSanitize = require('express-mongo-sanitize');
const productsRouter = require('./routes/products');
const checkoutRouter = require('./routes/checkout');

function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*' }));
  app.use(express.json());
  // Strips any request key starting with '$' or containing '.' from
  // req.body/req.query/req.params, so a MongoDB query operator (e.g.
  // ?category[$ne]=x) can never reach a Mongoose filter as a live operator.
  app.use(mongoSanitize());
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
