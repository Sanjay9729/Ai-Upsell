/**
 * Centralized logging service for the AI Upsell application
 */

class Logger {
  constructor() {
    this.logLevel = process.env.LOG_LEVEL || 'info';
    this.isDevelopment = process.env.NODE_ENV === 'development';
  }

  /**
   * Log an error message
   */
  error(message, error = null, context = {}) {
    const logEntry = {
      level: 'error',
      message,
      timestamp: new Date().toISOString(),
      context,
      ...(error && { error: error.message, stack: error.stack })
    };

    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, logEntry);
    }

    // In production, you could send to external logging service
    if (!this.isDevelopment) {
      this.sendToExternalLogger(logEntry);
    }
  }

  /**
   * Log a warning message
   */
  warn(message, context = {}) {
    const logEntry = {
      level: 'warn',
      message,
      timestamp: new Date().toISOString(),
      context
    };

    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, logEntry);
    }
  }

  /**
   * Log an info message
   */
  info(message, context = {}) {
    const logEntry = {
      level: 'info',
      message,
      timestamp: new Date().toISOString(),
      context
    };

    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}`, logEntry);
    }
  }

  /**
   * Log a debug message
   */
  debug(message, context = {}) {
    const logEntry = {
      level: 'debug',
      message,
      timestamp: new Date().toISOString(),
      context
    };

    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, logEntry);
    }
  }

  /**
   * Check if message should be logged based on current log level
   */
  shouldLog(level) {
    const levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3
    };

    return levels[level] <= levels[this.logLevel];
  }

  /**
   * Send logs to external service (placeholder for production)
   */
  sendToExternalLogger(logEntry) {
    // Placeholder for external logging service integration
    // Examples: Loggly, Datadog, CloudWatch, etc.
    // this.fetch('https://logging-service.com/api/logs', { method: 'POST', body: JSON.stringify(logEntry) });
  }

  /**
   * Log API request
   */
  logRequest(req, res, responseTime) {
    const logEntry = {
      method: req.method,
      url: req.url,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      timestamp: new Date().toISOString()
    };

    this.info('API Request', logEntry);
  }

  /**
   * Log AI engine operations
   */
  logAIEngine(operation, shopId, productId, details = {}) {
    this.info(`AI Engine: ${operation}`, {
      shopId,
      productId,
      operation,
      ...details
    });
  }

  /**
   * Log database operations
   */
  logDatabase(operation, collection, query, result = null) {
    this.debug(`Database: ${operation}`, {
      operation,
      collection,
      query: JSON.stringify(query),
      resultCount: result ? (Array.isArray(result) ? result.length : 1) : null
    });
  }

  /**
   * Log webhook processing
   */
  logWebhook(topic, shopDomain, productId, success = true, error = null) {
    const message = `Webhook: ${topic} for ${shopDomain}`;
    
    if (success) {
      this.info(message, { topic, shopDomain, productId });
    } else {
      this.error(message, error, { topic, shopDomain, productId });
    }
  }

  /**
   * Log Shopify API calls
   */
  logShopifyAPI(endpoint, shopDomain, statusCode, responseTime) {
    this.debug('Shopify API Call', {
      endpoint,
      shopDomain,
      statusCode,
      responseTime: `${responseTime}ms`
    });
  }
}

// Export singleton instance
export const logger = new Logger();

// Middleware for request logging
export const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    logger.logRequest(req, res, responseTime);
  });
  
  next();
};

// Express error handling middleware
export const errorHandler = (err, req, res, next) => {
  logger.error('Express Error Handler', err, {
    method: req.method,
    url: req.url,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'development' 
    ? err.message 
    : 'Internal server error';

  res.status(err.status || 500).json({
    error: message,
    requestId: req.id || 'unknown'
  });
};