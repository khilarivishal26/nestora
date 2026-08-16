// Nestora listing controller.
// Handles every listing CRUD operation: index (browse), show (detail),
// create, update, and delete.  Also includes a "my listings" page so
// hosts can see all their properties regardless of approval status.
//
// KEY RULE (from Listing model): public-facing queries (index) must
// filter by status: "approved".  Pending/rejected listings are only
// visible to their owner and to admins.

const Listing = require("../models/Listing");
const { cloudinary } = require("../config/cloudinary");

// ---------------------------------------------------------------------------
// GET /listings — Public listing index (approved only)
// ---------------------------------------------------------------------------
module.exports.index = async (req, res, next) => {
  try {
    const listings = await Listing.find({ status: "approved" })
      .sort({ createdAt: -1 });

    res.render("listings/index", { title: "Explore", listings });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// GET /listings/my — A host's own listings (all statuses)
// ---------------------------------------------------------------------------
module.exports.myListings = async (req, res, next) => {
  try {
    const listings = await Listing.find({ owner: req.user._id })
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
    const {
      title, description, price, location, country,
      propertyType, category, maxGuests, bedrooms, bathrooms, amenities,
    } = req.body;

    // --- Backend validation (mirrors Mongoose but gives friendly flashes) ---
    if (!title || !title.trim()) {
      req.flash("error", "Title is required.");
      return res.redirect("/listings/new");
    }
    if (!description || !description.trim()) {
      req.flash("error", "Description is required.");
      return res.redirect("/listings/new");
    }
    if (price === undefined || price === "" || Number(price) < 0) {
      req.flash("error", "Price must be a non-negative number.");
      return res.redirect("/listings/new");
    }
    if (!location || !location.trim()) {
      req.flash("error", "Location is required.");
      return res.redirect("/listings/new");
    }
    if (!country || !country.trim()) {
      req.flash("error", "Country is required.");
      return res.redirect("/listings/new");
    }
    if (!propertyType) {
      req.flash("error", "Property type is required.");
      return res.redirect("/listings/new");
    }
    if (!maxGuests || Number(maxGuests) < 1) {
      req.flash("error", "Maximum guests must be at least 1.");
      return res.redirect("/listings/new");
    }

    // Map uploaded files (Cloudinary URLs from multer-storage-cloudinary).
    const images = req.files ? req.files.map((f) => f.path) : [];

    // Amenities arrive as a comma-separated string from the form.
    const amenitiesList = amenities
      ? amenities.split(",").map((a) => a.trim()).filter(Boolean)
      : [];

    const newListing = new Listing({
      title: title.trim(),
      description: description.trim(),
      price: Number(price),
      location: location.trim(),
      country: country.trim(),
      propertyType,
      category: category ? category.trim() : "",
      maxGuests: Number(maxGuests),
      bedrooms: Number(bedrooms) || 0,
      bathrooms: Number(bathrooms) || 0,
      amenities: amenitiesList,
      images,
      owner: req.user._id,
      // status defaults to "pending" (defined in Listing schema)
    });

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
      .populate("owner", "username");

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

    res.render("listings/show", {
      title: listing.title,
      listing,
      isOwner,
      isAdmin,
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

    const {
      title, description, price, location, country,
      propertyType, category, maxGuests, bedrooms, bathrooms,
      amenities, deleteImages,
    } = req.body;

    // --- Backend validation ---
    if (!title || !title.trim()) {
      req.flash("error", "Title is required.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }
    if (!description || !description.trim()) {
      req.flash("error", "Description is required.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }
    if (price === undefined || price === "" || Number(price) < 0) {
      req.flash("error", "Price must be a non-negative number.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }
    if (!location || !location.trim()) {
      req.flash("error", "Location is required.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }
    if (!country || !country.trim()) {
      req.flash("error", "Country is required.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }
    if (!propertyType) {
      req.flash("error", "Property type is required.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }
    if (!maxGuests || Number(maxGuests) < 1) {
      req.flash("error", "Maximum guests must be at least 1.");
      return res.redirect(`/listings/${listing._id}/edit`);
    }

    // Update scalar fields.
    listing.title = title.trim();
    listing.description = description.trim();
    listing.price = Number(price);
    listing.location = location.trim();
    listing.country = country.trim();
    listing.propertyType = propertyType;
    listing.category = category ? category.trim() : "";
    listing.maxGuests = Number(maxGuests);
    listing.bedrooms = Number(bedrooms) || 0;
    listing.bathrooms = Number(bathrooms) || 0;

    // Amenities: comma-separated string → array.
    listing.amenities = amenities
      ? amenities.split(",").map((a) => a.trim()).filter(Boolean)
      : [];

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
// DELETE /listings/:id — Delete a listing
// ---------------------------------------------------------------------------
module.exports.destroy = async (req, res, next) => {
  try {
    const listing = req.listing; // attached by isListingOwner middleware

    // Best-effort cleanup of Cloudinary images.
    for (const imgUrl of listing.images) {
      try {
        const segments = imgUrl.split("/");
        const filenameWithExt = segments[segments.length - 1];
        const folder = segments[segments.length - 2];
        const publicId = `${folder}/${filenameWithExt.split(".")[0]}`;
        await cloudinary.uploader.destroy(publicId);
      } catch (e) {
        console.error("Cloudinary delete failed (non-fatal):", e.message);
      }
    }

    await Listing.findByIdAndDelete(listing._id);

    req.flash("success", "Property deleted successfully.");
    res.redirect("/listings");
  } catch (err) {
    next(err);
  }
};
