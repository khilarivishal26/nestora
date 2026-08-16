// Nestora client-side JS.

// Auto-dismiss flash messages after a few seconds. Each message fades
// out and is then removed from the DOM so it doesn't take up space.
document.addEventListener("DOMContentLoaded", () => {
  const flashMessages = document.querySelectorAll(".flash-message");

  flashMessages.forEach((message) => {
    setTimeout(() => {
      message.classList.add("flash-hide");
      // Wait for the CSS fade transition (0.5s) to finish before removing
      // the element, otherwise it would just disappear instantly.
      setTimeout(() => message.remove(), 500);
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