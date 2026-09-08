const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    // req.route.path (set once Express matches a route) gives the
    // parameterized path, e.g. /api/products/:id -- using the raw req.path
    // instead would create a separate time series per product ID and blow
    // up cardinality. A router's own root route has path '/', which would
    // otherwise leave a stray trailing slash after concatenating baseUrl.
    const routePath = req.route?.path === '/' ? '' : req.route?.path;
    const route = req.route ? `${req.baseUrl}${routePath}` : 'unmatched';
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, durationSeconds);
  });
  next();
}

module.exports = { register, metricsMiddleware };
