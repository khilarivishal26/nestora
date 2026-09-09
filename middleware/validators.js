// Nestora Centralized Validation Layer.
// Validates and sanitizes payloads for Authentication, Listings, Bookings, and Reviews.

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

const ALLOWED_PROPERTY_TYPES = [
  "hotel",
  "villa",
  "resort",
  "cottage",
  "apartment",
  "homestay",
  "cabin",
  "houseboat",
  "mansion",
  "tent",
  "treehouse",
  "other",
];

/**
 * Validates user registration data.
 */
function validateRegisterInput({ username, email, password }) {
  if (!username || typeof username !== "string" || !username.trim()) {
    return { valid: false, error: "Username is required." };
  }
  const cleanUsername = username.trim();
  if (!USERNAME_REGEX.test(cleanUsername)) {
    return {
      valid: false,
      error: "Username must be 3-30 characters long and contain only letters, numbers, and underscores.",
    };
  }

  if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
    return { valid: false, error: "Please enter a valid email address." };
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    return { valid: false, error: "Password must be at least 6 characters long." };
  }
  if (password.length > 100) {
    return { valid: false, error: "Password must not exceed 100 characters." };
  }

  return {
    valid: true,
    data: {
      username: cleanUsername,
      email: email.trim().toLowerCase(),
      password,
    },
  };
}

/**
 * Validates property listing creation and edit data.
 */
function validateListingInput(body) {
  const {
    title,
    description,
    price,
    location,
    country,
    propertyType,
    category,
    maxGuests,
    bedrooms,
    bathrooms,
    amenities,
  } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return { valid: false, error: "Title is required." };
  }
  const cleanTitle = title.trim();
  if (cleanTitle.length < 3 || cleanTitle.length > 100) {
    return { valid: false, error: "Title must be between 3 and 100 characters." };
  }

  if (!description || typeof description !== "string" || !description.trim()) {
    return { valid: false, error: "Description is required." };
  }
  const cleanDescription = description.trim();
  if (cleanDescription.length < 10 || cleanDescription.length > 3000) {
    return { valid: false, error: "Description must be between 10 and 3,000 characters." };
  }

  const numPrice = Number(price);
  if (price === undefined || price === "" || isNaN(numPrice) || !isFinite(numPrice) || numPrice < 0) {
    return { valid: false, error: "Price must be a valid non-negative number." };
  }
  if (numPrice > 1000000) {
    return { valid: false, error: "Price per night cannot exceed ₹10,00,000." };
  }

  if (!location || typeof location !== "string" || !location.trim()) {
    return { valid: false, error: "Location is required." };
  }
  const cleanLocation = location.trim();
  if (cleanLocation.length < 2 || cleanLocation.length > 100) {
    return { valid: false, error: "Location must be between 2 and 100 characters." };
  }

  if (!country || typeof country !== "string" || !country.trim()) {
    return { valid: false, error: "Country is required." };
  }
  const cleanCountry = country.trim();
  if (cleanCountry.length < 2 || cleanCountry.length > 100) {
    return { valid: false, error: "Country must be between 2 and 100 characters." };
  }

  const cleanPropertyType = (propertyType || "").toString().toLowerCase().trim();
  if (!ALLOWED_PROPERTY_TYPES.includes(cleanPropertyType)) {
    return {
      valid: false,
      error: `Invalid property type. Allowed types: ${ALLOWED_PROPERTY_TYPES.join(", ")}.`,
    };
  }

  const numMaxGuests = Number(maxGuests);
  if (!maxGuests || isNaN(numMaxGuests) || !Number.isInteger(numMaxGuests) || numMaxGuests < 1 || numMaxGuests > 50) {
    return { valid: false, error: "Maximum guests must be an integer between 1 and 50." };
  }

  const numBedrooms = bedrooms ? Number(bedrooms) : 0;
  if (isNaN(numBedrooms) || !Number.isInteger(numBedrooms) || numBedrooms < 0 || numBedrooms > 50) {
    return { valid: false, error: "Bedrooms count must be a non-negative integer up to 50." };
  }

  const numBathrooms = bathrooms ? Number(bathrooms) : 0;
  if (isNaN(numBathrooms) || !Number.isInteger(numBathrooms) || numBathrooms < 0 || numBathrooms > 50) {
    return { valid: false, error: "Bathrooms count must be a non-negative integer up to 50." };
  }

  let cleanAmenities = [];
  if (Array.isArray(amenities)) {
    cleanAmenities = amenities.map((a) => String(a).trim()).filter(Boolean);
  } else if (typeof amenities === "string" && amenities.trim()) {
    cleanAmenities = amenities.split(",").map((a) => a.trim()).filter(Boolean);
  }

  return {
    valid: true,
    data: {
      title: cleanTitle,
      description: cleanDescription,
      price: numPrice,
      location: cleanLocation,
      country: cleanCountry,
      propertyType: cleanPropertyType,
      category: category ? String(category).trim() : "",
      maxGuests: numMaxGuests,
      bedrooms: numBedrooms,
      bathrooms: numBathrooms,
      amenities: cleanAmenities,
    },
  };
}

/**
 * Validates reservation booking input.
 */
function validateBookingInput({ checkIn, checkOut, checkInDate: checkInDateParam, checkOutDate: checkOutDateParam, guests }) {
  const inDateStr = checkIn || checkInDateParam;
  const outDateStr = checkOut || checkOutDateParam;

  if (!inDateStr || !outDateStr) {
    return { valid: false, error: "Please provide both check-in and check-out dates." };
  }

  const checkInDate = new Date(inDateStr);
  const checkOutDate = new Date(outDateStr);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
    return { valid: false, error: "Invalid date format provided." };
  }

  checkInDate.setHours(0, 0, 0, 0);
  checkOutDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (checkInDate < today) {
    return { valid: false, error: "Check-in date cannot be in the past." };
  }

  if (checkOutDate <= checkInDate) {
    return { valid: false, error: "Check-out date must be after check-in date." };
  }

  const diffDays = Math.ceil(Math.abs(checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  if (diffDays > 90) {
    return { valid: false, error: "Maximum booking duration is 90 nights." };
  }

  const numGuests = Number(guests);
  if (!guests || isNaN(numGuests) || !Number.isInteger(numGuests) || numGuests < 1 || numGuests > 50) {
    return { valid: false, error: "Number of guests must be a positive integer between 1 and 50." };
  }

  return {
    valid: true,
    data: {
      checkInDate,
      checkOutDate,
      guests: numGuests,
      nights: diffDays,
    },
  };
}

/**
 * Validates review submission input.
 */
function validateReviewInput({ rating, body, comment }) {
  const numericRating = Number(rating);
  if (
    rating === undefined ||
    rating === "" ||
    isNaN(numericRating) ||
    !Number.isInteger(numericRating) ||
    numericRating < 1 ||
    numericRating > 5
  ) {
    return { valid: false, error: "Rating must be an integer between 1 and 5 stars." };
  }

  const reviewText = body || comment;
  if (!reviewText || typeof reviewText !== "string" || !reviewText.trim()) {
    return { valid: false, error: "Review text is required." };
  }

  const cleanBody = reviewText.trim();
  if (cleanBody.length < 5 || cleanBody.length > 2000) {
    return { valid: false, error: "Review text must be between 5 and 2,000 characters." };
  }

  return {
    valid: true,
    data: {
      rating: numericRating,
      body: cleanBody,
    },
  };
}

module.exports = {
  EMAIL_REGEX,
  USERNAME_REGEX,
  ALLOWED_PROPERTY_TYPES,
  validateRegisterInput,
  validateListingInput,
  validateBookingInput,
  validateReviewInput,
};
