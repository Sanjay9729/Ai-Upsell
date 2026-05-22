/**
 * Input Validation Utilities
 * Ensures all user inputs are valid before processing
 */

export class ValidationError extends Error {
  constructor(fieldName, message) {
    super(message);
    this.fieldName = fieldName;
    this.name = "ValidationError";
  }
}

/**
 * Validate business goal
 */
export function validateGoal(goal) {
  const validGoals = [
    "increase_aov",
    "revenue_per_visitor",
    "subscription_adoption",
    "inventory_movement",
  ];

  if (!goal || !validGoals.includes(goal)) {
    throw new ValidationError("goal", "Invalid business goal selected");
  }

  return goal;
}

/**
 * Validate risk tolerance
 */
export function validateRiskTolerance(risk) {
  const validRisks = ["conservative", "balanced", "aggressive"];

  if (!risk || !validRisks.includes(risk)) {
    throw new ValidationError("riskTolerance", "Invalid risk tolerance selected");
  }

  return risk;
}

/**
 * Validate discount percentage (0-90)
 */
export function validateDiscountCap(value) {
  const num = parseFloat(value);

  if (isNaN(num) || num < 0 || num > 90) {
    throw new ValidationError(
      "maxDiscountCap",
      "Discount cap must be between 0 and 90%"
    );
  }

  return Math.round(num);
}

/**
 * Validate inventory minimum (0-10000)
 */
export function validateInventoryMin(value) {
  const num = parseInt(value, 10);

  if (isNaN(num) || num < 0 || num > 10000) {
    throw new ValidationError(
      "inventoryMin",
      "Inventory minimum must be between 0 and 10,000 units"
    );
  }

  return num;
}

/**
 * Validate session offer limit (1-10)
 */
export function validateSessionLimit(value) {
  const num = parseInt(value, 10);

  if (isNaN(num) || num < 1 || num > 10) {
    throw new ValidationError(
      "sessionLimit",
      "Session limit must be between 1 and 10 offers"
    );
  }

  return num;
}

/**
 * Validate bundle name
 */
export function validateBundleName(name) {
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError("name", "Bundle name is required");
  }

  if (name.length > 100) {
    throw new ValidationError("name", "Bundle name must be less than 100 characters");
  }

  return name.trim();
}

/**
 * Validate product IDs (comma-separated)
 */
export function validateProductIds(idsString) {
  if (!idsString || typeof idsString !== "string") {
    throw new ValidationError("productIds", "Product IDs are required");
  }

  const ids = idsString
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  if (ids.length < 2) {
    throw new ValidationError("productIds", "Bundle must contain at least 2 products");
  }

  if (ids.length > 10) {
    throw new ValidationError("productIds", "Bundle cannot contain more than 10 products");
  }

  // Validate each ID is numeric or valid Shopify GID format
  for (const id of ids) {
    if (!/^\d+$/.test(id) && !/^gid:\/\/shopify\/Product\/\d+$/i.test(id)) {
      throw new ValidationError("productIds", `Invalid product ID format: ${id}`);
    }
  }

  return ids;
}

/**
 * Validate boolean protection settings
 */
export function validateProtection(value) {
  return value === "on" || value === true;
}

/**
 * Validate offer display mode
 */
export function validateOfferDisplayMode(mode) {
  const validModes = ["bundle", "volume_discount", "both"];

  if (!mode || !validModes.includes(mode)) {
    throw new ValidationError("offerDisplayMode", "Invalid offer display mode");
  }

  return mode;
}

/**
 * Validate excluded product/collection IDs
 */
export function validateExclusionList(idsString) {
  if (!idsString || idsString.trim() === "") {
    return { ids: [], handles: [] };
  }

  if (typeof idsString !== "string") {
    throw new ValidationError("exclusions", "Exclusion list must be a string");
  }

  const tokens = idsString
    .split(/[,\n]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length > 100) {
    throw new ValidationError("exclusions", "Maximum 100 exclusions allowed");
  }

  const ids = [];
  const handles = [];

  for (const token of tokens) {
    // Check if it's a GID format (e.g., gid://shopify/Product/123)
    const gidMatch = token.match(/gid:\/\/shopify\/(Product|Collection)\/(\d+)/i);
    if (gidMatch) {
      ids.push(gidMatch[2]);
      continue;
    }

    // Check if it's numeric (just the ID)
    if (/^\d+$/.test(token)) {
      ids.push(token);
      continue;
    }

    // Otherwise treat as handle
    if (/^[a-z0-9-]+$/i.test(token)) {
      handles.push(token.toLowerCase());
      continue;
    }

    throw new ValidationError(
      "exclusions",
      `Invalid format for "${token}". Use product IDs, GIDs, or handles`
    );
  }

  return {
    ids: Array.from(new Set(ids)),
    handles: Array.from(new Set(handles)),
  };
}

/**
 * Validate MongoDB ObjectID format
 */
export function validateObjectId(id) {
  if (!id || typeof id !== "string") {
    throw new ValidationError("id", "Invalid ID");
  }

  if (!/^[0-9a-f]{24}$/.test(id)) {
    throw new ValidationError("id", "Invalid ID format");
  }

  return id;
}

/**
 * Validate shop ID (from Shopify)
 */
export function validateShopId(shopId) {
  if (!shopId || typeof shopId !== "string") {
    throw new ValidationError("shopId", "Shop ID is required");
  }

  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shopId)) {
    throw new ValidationError("shopId", "Invalid shop ID format");
  }

  return shopId;
}

/**
 * Validate email address
 */
export function validateEmail(email) {
  if (!email || typeof email !== "string") {
    throw new ValidationError("email", "Email is required");
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new ValidationError("email", "Invalid email format");
  }

  return email.toLowerCase();
}

/**
 * Batch validate form data
 */
export function validateFormData(data, schema) {
  const errors = {};

  for (const [field, validator] of Object.entries(schema)) {
    try {
      validator(data[field]);
    } catch (error) {
      if (error instanceof ValidationError) {
        errors[field] = error.message;
      } else {
        errors[field] = "Invalid value";
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: {} };
}

/**
 * Sanitize string to prevent XSS
 */
export function sanitizeString(str) {
  if (typeof str !== "string") return "";

  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

/**
 * Validate bundle discount percentage
 */
export function validateBundleDiscount(discount) {
  const num = parseFloat(discount);

  if (isNaN(num) || num < 1 || num > 90) {
    throw new ValidationError("discount", "Discount must be between 1% and 90%");
  }

  return Math.round(num * 2) / 2; // Round to nearest 0.5%
}
