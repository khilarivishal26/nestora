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

  // --- Wishlist Toggle Handling ---
  const wishlistButtons = document.querySelectorAll(".wishlist-toggle-btn");
  wishlistButtons.forEach(btn => {
    btn.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const listingId = btn.getAttribute("data-listing-id");
      if (!listingId) return;

      const buttons = document.querySelectorAll(`[data-listing-id="${listingId}"]`);
      buttons.forEach((b) => {
        b.style.pointerEvents = "none";
        b.style.opacity = "0.7";
      });

      try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") || "";

        const res = await fetch(`/wishlist/toggle/${listingId}`, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-Token": csrfToken,
          },
        });

        if (res.status === 401) {
          window.location.href = "/login";
          return;
        }

        if (res.status === 403) {
          showWishlistToast("Session expired. Please refresh the page and try again.");
          return;
        }

        const data = await res.json();

        if (!data.success) {
          showWishlistToast(data.message || "Could not update wishlist.");
          return;
        }

        buttons.forEach((b) => {
          if (data.isWishlisted) {
            b.classList.add("active");
            b.setAttribute("aria-label", "Remove from wishlist");
            b.setAttribute("title", "Remove from wishlist");
            const label = b.querySelector(".wishlist-label");
            if (label) label.textContent = "Saved in Wishlist";
          } else {
            b.classList.remove("active");
            b.setAttribute("aria-label", "Save to wishlist");
            b.setAttribute("title", "Save to wishlist");
            const label = b.querySelector(".wishlist-label");
            if (label) label.textContent = "Save to Wishlist";
          }
        });

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
      } catch (err) {
        console.error("Wishlist toggle error:", err);
        showWishlistToast("Network error. Please check your connection.");
      } finally {
        buttons.forEach((b) => {
          b.style.pointerEvents = "";
          b.style.opacity = "";
        });
      }
    });
  });

  // --- Password Visibility Toggle ---
  const eyeOpenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
  const eyeClosedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

  document.querySelectorAll(".password-toggle").forEach((btn) => {
    btn.addEventListener("click", function() {
      const input = this.previousElementSibling;
      if (input && input.tagName === 'INPUT') {
        if (input.type === 'password') {
          input.type = 'text';
          this.innerHTML = eyeClosedSvg;
        } else {
          input.type = 'password';
          this.innerHTML = eyeOpenSvg;
        }
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Temporary toast notification for wishlist errors
// ---------------------------------------------------------------------------
function showWishlistToast(message) {
  // Remove any existing toast
  const existing = document.getElementById("wishlist-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "wishlist-toast";
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 12px 24px; border-radius: 8px;
    font-size: 0.92rem; z-index: 10000; box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    opacity: 0; transition: opacity 0.3s ease;
  `;
  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => { toast.style.opacity = "1"; });

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}