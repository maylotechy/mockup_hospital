const passwordInput = document.getElementById("loginPassword");
const togglePassword = document.getElementById("togglePassword");
const togglePasswordIcon = document.getElementById("togglePasswordIcon");

togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";

    passwordInput.type = isPassword ? "text" : "password";

    togglePasswordIcon.classList.toggle("bi-eye");
    togglePasswordIcon.classList.toggle("bi-eye-slash");
});