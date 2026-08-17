// Nestora client-side JS.

// Auto-dismiss flash messages after a few seconds. Each message fades
// out and is then removed from the DOM so it doesn't take up space.
document.addEventListener("DOMContentLoaded", () => {
  const flashMessages = document.querySelectorAll(".flash-message");

  flashMessages.forEach((message) => {
    setTimeout(() => {
      message.classList.add("flash-hide");
      setTimeout(() => {
        const container = message.parentElement;
        message.remove();
        if (container && container.classList.contains("flash-container") && !container.children.length) {
          container.remove();
        }
      }, 300);
    }, 3000);
  });

  // --- Image preview for the listing create/edit forms ---
  // When the user selects files in the image input, read each file
  // and show a thumbnail preview so they can see what they picked.
  const imageInput = document.getElementById("images");
  const previewContainer = document.getElementById("image-preview");

  if (imageInput && previewContainer) {
    imageInput.addEventListener("change", () => {
      previewContainer.innerHTML = "";

      Array.from(imageInput.files).forEach((file) => {
        if (!file.type.startsWith("image/")) return;

        const reader = new FileReader();
        reader.onload = (e) => {
          const img = document.createElement("img");
          img.src = e.target.result;
          img.alt = "Preview";
          previewContainer.appendChild(img);
        };
        reader.readAsDataURL(file);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Global Wishlist Toggle Handler (AJAX)
// ---------------------------------------------------------------------------
async function toggleWishlist(event, listingId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  if (!listingId) return;

  const buttons = document.querySelectorAll(`[data-listing-id="${listingId}"]`);
  buttons.forEach((btn) => {
    btn.style.pointerEvents = "none";
    btn.style.opacity = "0.7";
  });

  try {
    const res = await fetch(`/wishlist/toggle/${listingId}`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (res.status === 401) {
      // User is not logged in -> redirect to login page
      window.location.href = "/login";
      return;
    }

    const data = await res.json();

    if (data.success) {
      buttons.forEach((btn) => {
        if (data.isWishlisted) {
          btn.classList.add("active");
          btn.setAttribute("aria-label", "Remove from wishlist");
          btn.setAttribute("title", "Remove from wishlist");
          const label = btn.querySelector(".wishlist-label");
          if (label) label.textContent = "Saved in Wishlist";
        } else {
          btn.classList.remove("active");
          btn.setAttribute("aria-label", "Save to wishlist");
          btn.setAttribute("title", "Save to wishlist");
          const label = btn.querySelector(".wishlist-label");
          if (label) label.textContent = "Save to Wishlist";
        }
      });

      // If we are currently on the dedicated /wishlist page and removed an item, animate removal
      const wishlistGridCard = document.getElementById(`wishlist-item-${listingId}`);
      if (wishlistGridCard && !data.isWishlisted) {
        wishlistGridCard.style.transition = "opacity 0.25s ease, transform 0.25s ease";
        wishlistGridCard.style.opacity = "0";
        wishlistGridCard.style.transform = "scale(0.95)";
        setTimeout(() => {
          wishlistGridCard.remove();
          const remainingItems = document.querySelectorAll(".wishlist-grid-item");
          if (remainingItems.length === 0) {
            window.location.reload();
          }
        }, 250);
      }
    }
  } catch (err) {
    console.error("Wishlist toggle error:", err);
  } finally {
    buttons.forEach((btn) => {
      btn.style.pointerEvents = "";
      btn.style.opacity = "";
    });
  }
}