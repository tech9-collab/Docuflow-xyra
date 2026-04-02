import axios from 'axios';
try {
    const email = "test_login_" + Date.now() + "@example.com";
    const regRes = await axios.post('http://localhost:3001/api/auth/register', {
        name: "Test User",
        email: email,
        password: "password123",
        business_name: "Test Corp"
    });
    console.log("Register response:", JSON.stringify(regRes.data, null, 2));

    const logRes = await axios.post('http://localhost:3001/api/auth/login', {
        email: email,
        password: "password123"
    });
    console.log("Login response:", JSON.stringify(logRes.data, null, 2));
} catch (err) {
    console.error("Error:", err.response?.status, JSON.stringify(err.response?.data, null, 2));
}
process.exit(0);
