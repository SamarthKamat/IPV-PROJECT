require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Move CORS and other middleware configurations to the top
app.use(cors({
  origin: '*', // Allow all origins for testing
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  preflightContinue: true
}));

// Increase payload limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// MongoDB Connection with retry mechanism
const connectWithRetry = async (retries = 5, interval = 5000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/image-caption-db';
      await mongoose.connect(mongoURI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4, // Force IPv4
        connectTimeoutMS: 10000
      });
      console.log('MongoDB Connected Successfully');
      return;
    } catch (err) {
      console.log(`MongoDB Connection Attempt ${i + 1} Failed:`, err.message);
      if (i < retries - 1) {
        console.log(`Retrying in ${interval/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, interval));
      } else {
        console.error('Failed to connect to MongoDB after multiple attempts');
        process.exit(1);
      }
    }
  }
};

connectWithRetry();

// Configure multer for image upload
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function(req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function(req, file, cb) {
    const filetypes = /jpeg|jpg|png|bmp/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Error: Images Only!'));
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Import ImageProcessor
const ImageProcessor = require('./utils/imageProcessor');

// fs is already required above
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Routes
// Update CORS configuration with more specific options
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5000'], // Add your frontend URL
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Increase payload size limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Add these routes before your upload route
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working' });
});

app.post('/api/test-upload', (req, res) => {
  res.json({ message: 'Upload endpoint is reachable' });
});

// Update your upload route with more logging
app.post('/api/upload', upload.array('images', 5), async (req, res) => {
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  console.log('File:', req.file);
  
  try {
    // Add request logging
    console.log('Received upload request:', req.file ? 'File included' : 'No file');

    if (!req.files || req.files.length === 0) {
      console.log('No files uploaded');
      return res.status(400).json({ 
        success: false,
        message: 'No image files uploaded',
        error: 'Please select at least one image file to upload'
      });
    }

    const results = [];
    for (const file of req.files) {
      console.log('Processing file:', file.originalname);
      try {
        const result = await ImageProcessor.processImage(
          file.path,
          file.originalname
        );
        results.push(result);
      } catch (err) {
        console.error(`Error processing ${file.originalname}:`, err);
        results.push({
          success: false,
          error: `Failed to process ${file.originalname}: ${err.message}`
        });
      }
    }

    const successfulResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    if (successfulResults.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'All image processing failed',
        errors: failedResults.map(r => r.error)
      });
    }

    // Success response with potential partial failures
    console.log(`Successfully processed ${successfulResults.length} images`);
    res.json({
      success: true,
      message: `Processed ${successfulResults.length} out of ${results.length} images successfully`,
      data: {
        results: successfulResults.map(r => ({
          extractedText: r.data.extractedText,
          imageId: r.data.imageId,
          confidence: r.data.confidence || null
        })),
        failedFiles: failedResults.map(r => r.error)
      }
    });
  } catch (error) {
    console.error('Error in upload endpoint:', error);
    const statusCode = error.statusCode || 500;
    const errorMessage = error.message || 'An unexpected error occurred while processing the image';
    
    res.status(statusCode).json({
      success: false,
      message: 'Image processing failed',
      error: errorMessage
    });
  }
});

// Add a basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something broke!', error: err.message });
});

const PORT = process.env.PORT || 5000;

const startServer = (port) => {
  const server = app.listen(port)
    .on('listening', () => {
      console.log(`Server running on port ${port}`);
    })
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is busy, trying port ${port + 1}`);
        server.close();
        startServer(port + 1);
      } else {
        console.error('Server error:', err);
      }
    });
};

startServer(PORT);