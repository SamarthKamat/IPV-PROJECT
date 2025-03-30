const Tesseract = require('tesseract.js');
const Image = require('../models/Image');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

class ImageProcessor {
  static async processImage(imagePath, originalName) {
    try {
      // Initialize Gemini AI
      const genAI = new GoogleGenerativeAI('AIzaSyC570tkEuoF-xDvpKmITVRWbmI1hH-EzK4');
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

      // Check if image file exists
      try {
        await fs.promises.access(imagePath, fs.constants.F_OK);
      } catch (err) {
        throw new Error('Image file not found or inaccessible');
      }

      // Validate file size (max 10MB)
      const stats = await fs.promises.stat(imagePath);
      if (stats.size > 10 * 1024 * 1024) {
        throw new Error('Image file size exceeds maximum limit of 10MB');
      }
      // Advanced image preprocessing pipeline
      const preprocessedPath = path.join(path.dirname(imagePath), 'preprocessed_' + path.basename(imagePath));
      await sharp(imagePath)
        // Resize while maintaining aspect ratio and quality
        .resize(3000, 3000, { 
          fit: 'inside', 
          withoutEnlargement: true,
          kernel: 'lanczos3'
        })
        // Convert to grayscale for better text recognition
        .grayscale()
        // Enhance contrast and sharpness
        .normalize()
        .linear(1.3, -0.1)  // Increased contrast adaptation
        .modulate({ 
          brightness: 1.2,   // Slightly brighter
          contrast: 1.8,     // More contrast
          saturation: 0.8    // Reduced saturation for clearer text
        })
        .sharpen({ 
          sigma: 1.5,        // Increased sharpness
          m1: 1.5,
          m2: 0.7,
          x1: 2,
          y2: 10,
          y3: 20
        })
        // Noise reduction and edge enhancement
        .median(3)
        .gamma(1.4)
        // Advanced thresholding for better text separation
        .normalise({ lower: 30, upper: 220 })
        .threshold(140)
        .negate()
        .threshold(90)
        .negate()
        .toFile(preprocessedPath);

      // Configure Tesseract worker with advanced settings
      const worker = await Tesseract.createWorker({
        logger: info => console.log(info),
        errorHandler: err => console.error('Tesseract Error:', err)
      });

      // Initialize worker with optimized parameters
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      await worker.setParameters({
        // Character whitelist for better accuracy
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?-_@#$%&*()[]{}/<>"\' ',
        // Page segmentation mode: Assume uniform text block
        tessedit_pageseg_mode: '6',
        // Text ordering and spacing settings
        preserve_interword_spaces: '1',
        textord_force_make_prop_words: '1',
        // OCR engine mode: Neural nets LSTM only
        tessedit_ocr_engine_mode: '1',
        // Dictionary and language model settings
        tessedit_enable_doc_dict: '1',
        textord_min_linesize: '2.5',
        language_model_penalty_non_freq_dict_word: '0.15',
        language_model_penalty_non_dict_word: '0.25',
        // Image processing settings
        tessedit_do_invert: '0',
        textord_heavy_nr: '1',
        tessedit_pageseg_mode: '1',
        tessedit_write_images: '0',
        // Confidence level threshold
        tessedit_reject_poor_qual: '1',
        tessedit_min_orientation_margin: '4',
        // Disable unnecessary output formats
        tessjs_create_pdf: '0',
        tessjs_create_hocr: '0',
        tessjs_create_tsv: '0',
        tessjs_create_box: '0',
        tessjs_create_unlv: '0',
        tessjs_create_osd: '0'
      });

      // Perform OCR with enhanced settings on preprocessed image
      const result = await worker.recognize(preprocessedPath);
      
      await worker.terminate();

      // Clean up preprocessed image
      try {
        await fs.promises.unlink(preprocessedPath);
      } catch (cleanupError) {
        console.error('Error cleaning up preprocessed image:', cleanupError);
      }

      // Extract and clean text from the result with advanced processing
      let extractedText = result.data.text;
      
      // Advanced text cleaning pipeline
      extractedText = extractedText
        // Basic normalization
        .replace(/[\r\n]+/g, '\n')  // Normalize line breaks
        .replace(/[\t\f\v]/g, ' ')   // Replace other whitespace with spaces
        
        // Advanced character handling
        .replace(/[\u200B-\u200D\uFEFF]/g, '')  // Remove zero-width spaces
        .replace(/[\u2018\u2019]/g, "'")  // Smart quotes to regular quotes
        .replace(/[\u201C\u201D]/g, '"')  // Smart double quotes to regular quotes
        .replace(/[\u2013\u2014]/g, '-')  // Em/en dashes to hyphens
        
        // Layout cleaning
        .replace(/\s*\n\s*/g, '\n')  // Clean up spaces around line breaks
        .replace(/[^\S\n]+/g, ' ')  // Replace multiple spaces with single space
        .replace(/^\s*[\-•]\s*/gm, '')  // Remove list markers
        
        // Structure processing
        .split('\n')
        .map(line => {
          let trimmed = line.trim();
          // Remove lines that are just punctuation or special characters
          if (/^[\p{P}\s]+$/u.test(trimmed)) return '';
          // Remove lines that are too short and look like noise
          if (trimmed.length < 3 && !/\d+/.test(trimmed)) return '';
          return trimmed;
        })
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
        
      // Additional validation and cleaning
      if (extractedText) {
        // Remove repeated phrases that might be artifacts
        const phrases = extractedText.split('\n');
        extractedText = [...new Set(phrases)].join('\n');
        
        // Final cleanup
        extractedText = extractedText
          .replace(/[^\w\s\n.,!?@#$%&*()[\]{}/<>"'\-_]/g, '') // Keep only valid characters
          .replace(/\s+/g, ' ') // Final space normalization
          .trim();
      }

      // Validate extracted text quality
      if (extractedText.length < 3) {
        throw new Error('Extracted text is too short or unclear - please ensure image contains readable text');
      }

      // Remove any remaining problematic characters
      extractedText = extractedText
        .replace(/[^\w\s\n.,!?@#$%&*()[\]{}/<>"'\-_]/g, '')  // Keep only valid characters
        .replace(/\s+/g, ' ')  // Final space normalization
        .trim();

      if (!extractedText) {
        throw new Error('No text could be extracted from the image');
      }

      // Create a new image document
      const image = new Image({
        filename: imagePath.split('/').pop(),
        originalName: originalName,
        path: imagePath,
        extractedText: extractedText,
        originalExtractedText: extractedText, // Store both versions
        confidence: result.data.confidence
      });

      // Save to database
      await image.save();

      return {
        success: true,
        data: {
          extractedText: extractedText,
          originalExtractedText: extractedText,
          confidence: result.data.confidence,
          imageId: image._id
        }
      };

    } catch (error) {
      console.error('Error processing image:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ImageProcessor;