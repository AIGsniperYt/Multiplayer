const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS at the very top - BEFORE any other middleware
app.use(cors({
  origin: function (origin, callback) {
    // 1. Allow requests with no origin (like from mobile apps, Postman, or same-origin requests)
    if (!origin) {
      console.log('CORS: No origin header (likely same-origin request). Allowing.');
      return callback(null, true);
    }

    // 2. List of allowed origins
    const allowedOrigins = [
      "https://aigsniperyt.github.io", // Your GitHub Pages site
      "http://localhost:3000",         // Local React dev server
      "http://127.0.0.1:5500",         // Local Live Server (VS Code)
      "http://localhost:5500",         // Another common Live Server port
      "https://aigsniperyt.github.io"  // Duplicate but explicit
    ];

    // 3. Check if the origin is in the allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 4. Log the blocked origin for debugging
      console.log('🚫 CORS: BLOCKING request from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Handle preflight OPTIONS requests for ALL routes
app.options('*', cors());

// JSON middleware - AFTER CORS
app.use(express.json());

// Security headers middleware
app.use((req, res, next) => {
  // 1. Set Cache-Control for all responses
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  
  // 2. Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // 3. Remove the X-Powered-By header (often done by Helmet.js)
  res.removeHeader('X-Powered-By');
  
  // 4. (Bonus) Other very important security headers
  // This defines which features and APIs can be used in the browser (e.g., prevent misuse of microphone/camera)
  res.setHeader('Permissions-Policy', 'interest-cohort=()');
  // This helps prevent clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');
  
  next();
});

// Static files AFTER CORS and other middleware
app.use(express.static(path.join(__dirname, '..')));
