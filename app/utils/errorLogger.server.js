/**
 * Error Logging & Monitoring Utility
 * Handles error tracking and alerting in production
 */

import fs from "fs";
import path from "path";

const LOGS_DIR = "./logs";

// Ensure logs directory exists
function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Log levels
 */
const LogLevel = {
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  CRITICAL: "CRITICAL",
};

/**
 * Format log entry
 */
function formatLogEntry(level, message, context = {}) {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    level,
    message,
    context,
    nodeEnv: process.env.NODE_ENV,
    url: context.url || "unknown",
    shopId: context.shopId || "unknown",
    userId: context.userId || "unknown",
    duration: context.duration || null,
  };
}

/**
 * Write log to file
 */
function writeLog(entry) {
  ensureLogsDir();

  const today = new Date().toISOString().split("T")[0];
  const logFile = path.join(LOGS_DIR, `${entry.level.toLowerCase()}-${today}.log`);

  try {
    fs.appendFileSync(
      logFile,
      JSON.stringify(entry) + "\n",
      { encoding: "utf8" }
    );
  } catch (error) {
    console.error("Failed to write log:", error);
  }
}

/**
 * Log debug message
 */
export function logDebug(message, context = {}) {
  if (process.env.NODE_ENV !== "development") return;

  const entry = formatLogEntry(LogLevel.DEBUG, message, context);
  console.log(`[DEBUG] ${message}`, context);
  writeLog(entry);
}

/**
 * Log info message
 */
export function logInfo(message, context = {}) {
  const entry = formatLogEntry(LogLevel.INFO, message, context);
  console.log(`[INFO] ${message}`, context);
  writeLog(entry);
}

/**
 * Log warning message
 */
export function logWarn(message, context = {}) {
  const entry = formatLogEntry(LogLevel.WARN, message, context);
  console.warn(`[WARN] ${message}`, context);
  writeLog(entry);
}

/**
 * Log error with stack trace
 */
export function logError(error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;

  const entry = formatLogEntry(LogLevel.ERROR, message, {
    ...context,
    stack,
    errorName: error?.name || "Error",
  });

  console.error(`[ERROR] ${message}`, { ...context, stack });
  writeLog(entry);

  // Alert on critical errors
  if (message.includes("CRITICAL") || error?.critical) {
    alertCriticalError(entry);
  }
}

/**
 * Log critical error (requires immediate action)
 */
export function logCritical(error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : null;

  const entry = formatLogEntry(LogLevel.CRITICAL, message, {
    ...context,
    stack,
    errorName: error?.name || "Error",
  });

  console.error(`[CRITICAL] ${message}`, { ...context, stack });
  writeLog(entry);

  // Always alert on critical
  alertCriticalError(entry);
}

/**
 * Alert on critical errors (could integrate with email, Slack, etc.)
 */
function alertCriticalError(entry) {
  // TODO: Integrate with alerting service
  // - Send email to admin
  // - Post to Slack
  // - Send SMS
  // - Page on-call engineer

  console.error("🚨 CRITICAL ERROR ALERT 🚨");
  console.error(JSON.stringify(entry, null, 2));

  // For now, just log to console
  // In production, this would integrate with your alerting service
}

/**
 * Log HTTP request
 */
export function logRequest(request, context = {}) {
  const entry = formatLogEntry(LogLevel.INFO, `HTTP ${request.method} ${request.url}`, {
    ...context,
    method: request.method,
    url: new URL(request.url).pathname,
    headers: {
      userAgent: request.headers.get("user-agent"),
      referer: request.headers.get("referer"),
    },
  });

  writeLog(entry);
}

/**
 * Log HTTP response
 */
export function logResponse(request, response, duration, context = {}) {
  const entry = formatLogEntry(LogLevel.INFO, `HTTP ${response.status} ${request.method}`, {
    ...context,
    method: request.method,
    url: new URL(request.url).pathname,
    status: response.status,
    duration,
  });

  writeLog(entry);
}

/**
 * Log database query
 */
export function logDatabaseQuery(query, duration, context = {}) {
  if (duration > 1000) {
    // Log slow queries
    logWarn(`Slow database query (${duration}ms)`, {
      ...context,
      query: query.substring(0, 200),
      duration,
    });
  }

  logDebug(`Database query (${duration}ms)`, {
    ...context,
    query: query.substring(0, 100),
    duration,
  });
}

/**
 * Log API call
 */
export function logApiCall(endpoint, method, duration, status, context = {}) {
  if (status >= 400) {
    logWarn(`API error: ${method} ${endpoint} (${status})`, {
      ...context,
      endpoint,
      method,
      status,
      duration,
    });
  } else if (duration > 1000) {
    logWarn(`Slow API call: ${method} ${endpoint} (${duration}ms)`, {
      ...context,
      endpoint,
      method,
      status,
      duration,
    });
  } else {
    logDebug(`API call: ${method} ${endpoint}`, {
      ...context,
      endpoint,
      method,
      status,
      duration,
    });
  }
}

/**
 * Get logs for a specific date
 */
export function getLogs(date = new Date(), level = null) {
  ensureLogsDir();

  const dateStr = date.toISOString().split("T")[0];
  const files = fs.readdirSync(LOGS_DIR);
  let logFiles = files.filter((f) => f.includes(dateStr));

  if (level) {
    const levelFile = `${level.toLowerCase()}-${dateStr}.log`;
    logFiles = logFiles.filter((f) => f === levelFile);
  }

  let logs = [];
  for (const file of logFiles) {
    const filePath = path.join(LOGS_DIR, file);
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter((l) => l.length > 0);
      logs = logs.concat(lines.map((l) => JSON.parse(l)));
    } catch (error) {
      logError(error, { context: `Failed to read log file: ${file}` });
    }
  }

  return logs;
}

/**
 * Get error summary for dashboard
 */
export function getErrorSummary(hoursBack = 24) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - hoursBack * 60 * 60 * 1000);

  const logs = getLogs(null, LogLevel.ERROR);
  const filteredLogs = logs.filter(
    (log) => new Date(log.timestamp) >= cutoff
  );

  // Group by error message
  const errorGroups = {};
  for (const log of filteredLogs) {
    const key = log.message;
    if (!errorGroups[key]) {
      errorGroups[key] = {
        message: key,
        count: 0,
        lastOccurred: log.timestamp,
        examples: [],
      };
    }
    errorGroups[key].count++;
    errorGroups[key].lastOccurred = log.timestamp;
    if (errorGroups[key].examples.length < 5) {
      errorGroups[key].examples.push(log);
    }
  }

  // Sort by frequency
  const summary = Object.values(errorGroups).sort((a, b) => b.count - a.count);

  return {
    totalErrors: filteredLogs.length,
    errorTypes: summary.length,
    topErrors: summary.slice(0, 5),
    timeRange: { start: cutoff.toISOString(), end: now.toISOString() },
  };
}

/**
 * Archive old logs (older than 30 days)
 */
export function archiveOldLogs() {
  ensureLogsDir();

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(LOGS_DIR);

  for (const file of files) {
    const filePath = path.join(LOGS_DIR, file);
    const stat = fs.statSync(filePath);

    if (stat.mtime < thirtyDaysAgo) {
      try {
        fs.unlinkSync(filePath);
        logInfo(`Archived old log: ${file}`);
      } catch (error) {
        logError(error, { context: `Failed to archive log: ${file}` });
      }
    }
  }
}

/**
 * Create a performance timer
 */
export class PerformanceTimer {
  constructor(name, context = {}) {
    this.name = name;
    this.context = context;
    this.startTime = Date.now();
  }

  end() {
    const duration = Date.now() - this.startTime;
    return {
      name: this.name,
      duration,
      context: this.context,
    };
  }
}

/**
 * Middleware to log all requests/responses
 */
export function requestLogger(loader) {
  return async (args) => {
    const { request } = args;
    const startTime = Date.now();

    try {
      logRequest(request, { shopId: args.context?.shopId });

      const response = await loader(args);
      const duration = Date.now() - startTime;

      logResponse(request, response, duration, { shopId: args.context?.shopId });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;
      logError(error, {
        context: "Loader error",
        url: request.url,
        method: request.method,
        duration,
      });

      throw error;
    }
  };
}
