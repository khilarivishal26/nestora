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
});