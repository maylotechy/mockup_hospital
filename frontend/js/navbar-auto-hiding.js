let lastScroll = 0;
const navbar = document.getElementById("navbar");
const threshold = 100;

window.addEventListener("scroll", () => {
    const currentScroll = window.pageYOffset;

    // Always show near the top of the page
    if (currentScroll <= threshold) {
        navbar.classList.remove("-translate-y-full");
        lastScroll = currentScroll;
        return;
    }

    // Hide when scrolling down
    if (currentScroll > lastScroll) {
        navbar.classList.add("-translate-y-full");
    }
    // Show when scrolling up
    else {
        navbar.classList.remove("-translate-y-full");
    }

    lastScroll = currentScroll;
});