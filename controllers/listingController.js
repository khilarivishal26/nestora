// Nestora listing controller.
// Handles every listing CRUD operation: index (browse), show (detail),
// create, update, and delete.  Also includes a "my listings" page so
// hosts can see all their properties regardless of approval status.
//
// KEY RULE (from Listing model): public-facing queries (index) must
// filter by status: "approved".  Pending/rejected listings are only
// visible to their owner and to admins.

const Listing = require("../models/Listing");
const Review = require("../models/Review");
const Booking = require("../models/Booking");
const { cloudinary } = require("../config/cloudinary");
const { validateListingInput } = require("../middleware/validators");

// ---------------------------------------------------------------------------
// GET /listings — Public listing index with search & filters (approved only)
// ---------------------------------------------------------------------------
module.exports.index = async (req, res, next) => {
  try {
    const {
      q, propertyType, minPrice, maxPrice, guests,
      bedrooms, country, amenities, sort, page: reqPage, limit: reqLimit,
    } = req.query;

    // Always start with approved-only and exclude soft-deleted listings
    const filter = { status: "approved", isDeleted: { $ne: true } };

    // --- Keyword search (title, description, location, country) ---
    if (q && q.trim()) {
      const regex = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { title: regex },
        { description: regex },
        { location: regex },
        { country: regex },
      ];
    }

    // --- Property type filter ---
    if (propertyType && propertyType.trim()) {
      filter.propertyType = propertyType.trim();
    }

    // --- Price range ---
    if (minPrice && !isNaN(Number(minPrice)) && Number(minPrice) >= 0) {
      filter.price = { ...filter.price, $gte: Number(minPrice) };
    }
    if (maxPrice && !isNaN(Number(maxPrice)) && Number(maxPrice) >= 0) {
      filter.price = { ...filter.price, $lte: Number(maxPrice) };
    }

    // --- Minimum guests ---
    if (guests && !isNaN(Number(guests)) && Number(guests) >= 1) {
      filter.maxGuests = { $gte: Number(guests) };
    }

    // --- Minimum bedrooms ---
    if (bedrooms && !isNaN(Number(bedrooms)) && Number(bedrooms) >= 1) {
      filter.bedrooms = { $gte: Number(bedrooms) };
    }

    // --- Country filter ---
    if (country && country.trim()) {
      filter.country = new RegExp(
        country.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"
      );
    }

    // --- Amenities (comma-separated or repeated param) ---
    if (amenities) {
      const amenityList = Array.isArray(amenities)
        ? amenities.map((a) => a.trim()).filter(Boolean)
        : amenities.split(",").map((a) => a.trim()).filter(Boolean);
      if (amenityList.length > 0) {
        // $all = listing must have every requested amenity.
        filter.amenities = {
          $all: amenityList.map(
            (a) => new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
          ),
        };
      }
    }

    // --- Sort ---
    let sortOption = { createdAt: -1 }; // default: newest first
    if (sort === "price_asc") sortOption = { price: 1 };
    else if (sort === "price_desc") sortOption = { price: -1 };

    // --- Pagination ---
    const page = Math.max(1, parseInt(reqPage, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(reqLimit, 10) || 12));
    const skip = (page - 1) * limit;

    const totalCount = await Listing.countDocuments(filter);
    const totalPages = Math.ceil(totalCount / limit) || 1;

    const listings = await Listing.find(filter)
      .sort(sortOption)
      .skip(skip)
      .limit(limit);

    // Check if any filters are active (used by the view to show "clear" link).
    const hasFilters = !!(
      q || propertyType || minPrice || maxPrice ||
      guests || bedrooms || country || amenities || sort
    );

    res.render("listings/index", {
      title: "Explore",
      listings,
      query: req.query, // pass back for form repopulation
      hasFilters,
      currentPage: page,
      totalPages,
      totalCount,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /listings/my — A host's own listings (all statuses)
// ---------------------------------------------------------------------------
module.exports.myListings = async (req, res, next) => {
  try {
    const listings = await Listing.find({ owner: req.user._id, isDeleted: { $ne: true } })
      .sort({ createdAt: -1 });

    res.render("listings/index", {
      title: "My Properties",
      listings,
      showStatus: true,   // tells the template to render status badges
      isMyPage: true,      // lets the template adapt its heading
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /listings/new — Render the "Add Property" form
// ---------------------------------------------------------------------------
module.exports.renderNewForm = (req, res) => {
  res.render("listings/new", { title: "Add Property" });
};

// ---------------------------------------------------------------------------
// POST /listings — Create a new listing
// ---------------------------------------------------------------------------
module.exports.create = async (req, res, next) => {
  try {
    const validation = validateListingInput(req.body);
    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect("/listings/new");
    }

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
      amenities: amenitiesList,
    } = validation.data;

    // Map uploaded files (Cloudinary URLs from multer-storage-cloudinary).
    const images = req.files ? req.files.map((f) => f.path) : [];

    const newListing = new Listing({
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
      amenities: amenitiesList,
      images,
      owner: req.user._id,
      // status defaults to "pending" (defined in Listing schema)
    });

    // Save optional coordinates if provided and valid
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      newListing.coordinates = { lat, lng };
    }

    await newListing.save();

    req.flash(
      "success",
      "Property listed successfully! It will be visible to guests after approval."
    );
    res.redirect(`/listings/${newListing._id}`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /listings/:id — Show a single listing
// ---------------------------------------------------------------------------
module.exports.show = async (req, res, next) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate("owner", "username email createdAt")
      .populate({
        path: "reviews",
        populate: { path: "author", select: "username" },
        options: { sort: { createdAt: -1 } },
      });

    if (!listing) {
      req.flash("error", "Listing not found.");
      return res.redirect("/listings");
    }

    // Only the owner or an admin may view non-approved listings.
    const isOwner =
      req.user && listing.owner._id.equals(req.user._id);
    const isAdmin = req.user && req.user.role === "admin";

    if (listing.status !== "approved" && !isOwner && !isAdmin) {
      req.flash("error", "Listing not found.");
      return res.redirect("/listings");
    }

    // Compute average rating from populated reviews.
    let avgRating = 0;
    if (listing.reviews && listing.reviews.length > 0) {
      const total = listing.reviews.reduce((sum, r) => sum + r.rating, 0);
      avgRating = (total / listing.reviews.length).toFixed(1);
    }

    // Check if the current user has stayed at this property and whether they have reviewed
    let isEligibleGuest = false;
    let hasReviewed = false;

    if (req.user && !isOwner) {
      const eligibleBooking = await Booking.findOne({
        listing: listing._id,
        guest: req.user._id,
        status: { $in: ["confirmed", "completed"] },
      });
      isEligibleGuest = Boolean(eligibleBooking);

      if (listing.reviews && listing.reviews.length > 0) {
        hasReviewed = listing.reviews.some(
          (r) => r.author && r.author._id.equals(req.user._id)
        );
      }
    }

    res.render("listings/show", {
      title: listing.title,
      listing,
      isOwner,
      isAdmin,
      avgRating: Number(avgRating),
      reviewCount: listing.reviews ? listing.reviews.length : 0,
      isEligibleGuest,
      hasReviewed,
      mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN || "",
      mapboxToken: process.env.MAPBOX_ACCESS_TOKEN || process.env.MAPBOX_TOKEN || "",
    });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /listings/:id/edit — Render the edit form
// ---------------------------------------------------------------------------
module.exports.renderEditForm = (req, res) => {
  // req.listing was attached by the isListingOwner middleware.
  const listing = req.listing;
  res.render("listings/edit", { title: "Edit Property", listing });
};

// ---------------------------------------------------------------------------
// PUT /listings/:id — Update a listing
// ---------------------------------------------------------------------------
module.exports.update = async (req, res, next) => {
  try {
    const listing = req.listing; // attached by isListingOwner middleware
    const { deleteImages } = req.body;

    // --- Backend validation ---
    const validation = validateListingInput(req.body);
    if (!validation.valid) {
      req.flash("error", validation.error);
      return res.redirect(`/listings/${listing._id}/edit`);
    }

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
      amenities: amenitiesList,
    } = validation.data;

    // Update scalar fields.
    listing.title = title;
    listing.description = description;
    listing.price = price;
    listing.location = location;
    listing.country = country;
    listing.propertyType = propertyType;
    listing.category = category;
    listing.maxGuests = maxGuests;
    listing.bedrooms = bedrooms;
    listing.bathrooms = bathrooms;
    listing.amenities = amenitiesList;

    // Update optional coordinates if provided and valid
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      listing.coordinates = { lat, lng };
    } else if (req.body.latitude === '' && req.body.longitude === '') {
      // Allow clearing coordinates when both fields are explicitly emptied
      listing.coordinates = { lat: undefined, lng: undefined };
    }

    // Append any newly uploaded images.
    if (req.files && req.files.length > 0) {
      const newImages = req.files.map((f) => f.path);
      listing.images.push(...newImages);
    }

    // Remove images the user checked for deletion.
    if (deleteImages && deleteImages.length > 0) {
      // Delete from Cloudinary (best-effort — don't block save if it fails).
      for (const imgUrl of deleteImages) {
        try {
          // Cloudinary URLs: .../upload/v123/nestora/publicid.jpg
          // We need the public_id including the folder, e.g. "nestora/publicid".
          const segments = imgUrl.split("/");
          const filenameWithExt = segments[segments.length - 1];
          const folder = segments[segments.length - 2];
          const publicId = `${folder}/${filenameWithExt.split(".")[0]}`;
          await cloudinary.uploader.destroy(publicId);
        } catch (e) {
          console.error("Cloudinary delete failed (non-fatal):", e.message);
        }
      }

      // Remove deleted URLs from the listing's images array.
      listing.images = listing.images.filter(
        (img) => !deleteImages.includes(img)
      );
    }

    await listing.save();

    req.flash("success", "Property updated successfully!");
    res.redirect(`/listings/${listing._id}`);
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// DELETE /listings/:id — Safe soft-delete / deactivate a listing
// ---------------------------------------------------------------------------
module.exports.destroy = async (req, res, next) => {
  try {
    const listing = req.listing; // attached by isListingOwner middleware

    // Soft deletion: Deactivate property so it is hidden from public search while preserving historical bookings, reviews, and payments.
    listing.isDeleted = true;
    listing.status = "archived";
    await listing.save();

    req.flash("success", "Property deactivated successfully. Existing reservations and guest history remain preserved.");
    res.redirect("/listings/my");
  } catch (err) {
    next(err);
  }
};
