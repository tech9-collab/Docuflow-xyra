import axios from 'axios';
try {
    const res = await axios.post('http://localhost:3001/api/auth/login', {
        email: "test_login_1775113720628@example.com",
        password: "password123"
    });
    console.log(JSON.stringify(res.data, null, 2));
} catch (err) {
    console.error("Error:", err.response?.status, JSON.stringify(err.response?.data, null, 2));
}
process.exit(0);
