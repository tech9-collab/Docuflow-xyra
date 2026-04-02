import axios from 'axios';
try {
    const res = await axios.post('http://localhost:3001/api/auth/register', {
        name: "JohnDoe",
        email: "john" + Date.now() + "@example.com",
        password: "password123",
        business_name: "Acme Corp"
    });
    console.log("Success:", JSON.stringify(res.data));
} catch (err) {
    console.error("Error:", err.response?.status, JSON.stringify(err.response?.data));
}
process.exit(0);
