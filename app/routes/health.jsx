/**
 * Health Check Endpoint
 * Used by monitoring services to verify application is running
 * Accessible without authentication
 */

export const loader = async () => {
  try {
    // Check database connection
    const { getDb } = await import("../../backend/database/mongodb.js");
    const db = await getDb();

    // Run a simple query to verify connection
    const adminDb = db.admin();
    const ping = await adminDb.ping();

    const health = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      checks: {
        database: {
          status: ping?.ok ? "up" : "down",
          responseTime: ping?.ok ? "fast" : "timeout",
        },
        memory: {
          status: "up",
          usage: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100,
          unit: "MB",
        },
        uptime: {
          seconds: Math.floor(process.uptime()),
        },
      },
    };

    return new Response(JSON.stringify(health), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    const health = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      error: error.message,
      checks: {
        database: {
          status: "down",
          error: error.message,
        },
      },
    };

    return new Response(JSON.stringify(health), {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  }
};
